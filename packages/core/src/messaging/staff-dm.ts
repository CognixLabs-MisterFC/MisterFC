/**
 * O2-12 (paso 2, CORE) — Mensajería privada entre STAFF (1:1 perfil↔perfil).
 * Framework-agnóstica (la consumen app y web). Canal NUEVO y AISLADO: NO toca
 * conversations / messages / team_* ni sus loaders (getInboxFromClient, InboxItem…
 * quedan INTACTOS). Las familias no se enteran de nada.
 *
 * Autorización = RLS (migración 20261048000000): SELECT/INSERT solo participantes;
 * crear un hilo exige que AMBOS perfiles sean staff del club (profile_is_staff_of_club).
 * Aquí NO se reimplementa el gate; el 42501 se traduce a 'forbidden'.
 *
 * Piezas:
 *  · Directorio de staff (destinatarios del selector) — agrupa por rol, busca por nombre.
 *  · Crear/abrir hilo (par canónico, idempotente), cargar mensajes, enviar (+ fan-out).
 *  · Inbox HERMANO (getStaffInboxFromClient) con forma paralela a InboxItem para que la
 *    UI pueda fusionar y ordenar por fecha sin traducir campos. No-leídos por diferencia
 *    con last_read_at (no hay read_at por mensaje: staff_messages es append-only).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { sendMessageSchema, MESSAGE_RATE_LIMIT } from '../schemas/messaging';
import type { MessageFanOut } from './send';

type Sb = SupabaseClient<Database>;

/** Sumidero de errores del caller (web: Sentry). Core no importa Sentry. */
export type StaffDmLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

const noopLog: StaffDmLogger = () => {};

// ─────────────────────────────────────────────────────────────────────────────
// Directorio de staff (selector de destinatario).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Prioridad de rol para AGRUPAR una persona con varios roles (elige el más alto).
 * Cubre los dos orígenes del conjunto staff: roles de club de gestión (memberships,
 * distinto de 'jugador') y roles de team_staff (incluidos preparador_fisico y
 * delegado, que NO son roles de club). Mismo criterio que profile_is_staff_of_club.
 */
const STAFF_ROLE_PRIORITY = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'preparador_fisico',
  'delegado',
] as const;

export type StaffDirectoryRole = (typeof STAFF_ROLE_PRIORITY)[number];

/** Roles de club (memberships.role) que cuentan como staff (todos menos 'jugador'). */
const MANAGEMENT_ROLES = new Set<string>([
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
]);

export type StaffDirectoryEntry = {
  profileId: string;
  fullName: string;
  /** Rol canónico para agrupar (el de mayor prioridad entre todos los suyos). */
  role: StaffDirectoryRole;
};

export type ListStaffDirectoryResult =
  | { staff: StaffDirectoryEntry[] }
  | { error: 'generic' };

function primaryRole(roles: Set<string>): StaffDirectoryRole {
  for (const r of STAFF_ROLE_PRIORITY) if (roles.has(r)) return r;
  return 'delegado'; // inalcanzable: todo rol del conjunto está en la prioridad.
}

/**
 * Staff del club para el selector, derivado de los DOS sitios (memberships de gestión
 * ∪ team_staff activo), como el helper de RLS. Excluye al propio usuario. Devuelve
 * nombre + rol canónico (para agrupar) — el buscador por nombre lo hace el front. La
 * RLS ya permite a cualquier miembro leer memberships/team_staff/profiles club-wide.
 */
export async function listStaffDirectoryFromClient(
  supabase: Sb,
  params: { clubId: string; currentProfileId: string },
  logError: StaffDmLogger = noopLog,
): Promise<ListStaffDirectoryResult> {
  const { clubId, currentProfileId } = params;

  // (1) Memberships de gestión del club.
  const { data: mRows, error: mErr } = await supabase
    .from('memberships')
    .select('profile_id, role')
    .eq('club_id', clubId)
    .neq('role', 'jugador');
  if (mErr) {
    logError(mErr, 'staff_directory_memberships', { club_id: clubId });
    return { error: 'generic' };
  }

  // (2) team_staff ACTIVO cuyo membership pertenece al club (capta delegado/pf).
  const { data: tsRows, error: tsErr } = await supabase
    .from('team_staff')
    .select('staff_role, memberships!inner(profile_id, club_id)')
    .is('left_at', null)
    .eq('memberships.club_id', clubId);
  if (tsErr) {
    logError(tsErr, 'staff_directory_team_staff', { club_id: clubId });
    return { error: 'generic' };
  }

  // Unión: profileId → conjunto de roles.
  const rolesByProfile = new Map<string, Set<string>>();
  const add = (profileId: string, role: string) => {
    const set = rolesByProfile.get(profileId) ?? new Set<string>();
    set.add(role);
    rolesByProfile.set(profileId, set);
  };
  for (const m of (mRows ?? []) as Array<{ profile_id: string; role: string }>) {
    if (MANAGEMENT_ROLES.has(m.role)) add(m.profile_id, m.role);
  }
  for (const ts of (tsRows ?? []) as unknown as Array<{
    staff_role: string;
    memberships: { profile_id: string; club_id: string };
  }>) {
    add(ts.memberships.profile_id, ts.staff_role);
  }

  const ids = [...rolesByProfile.keys()].filter((id) => id !== currentProfileId);
  if (ids.length === 0) return { staff: [] };

  // Nombres.
  const { data: pRows, error: pErr } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', ids);
  if (pErr) {
    logError(pErr, 'staff_directory_profiles', { club_id: clubId });
    return { error: 'generic' };
  }
  const nameById = new Map(
    ((pRows ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
      p.id,
      p.full_name ?? '',
    ]),
  );

  const staff = ids
    .map((id) => ({
      profileId: id,
      fullName: nameById.get(id) ?? '',
      role: primaryRole(rolesByProfile.get(id) ?? new Set<string>()),
    }))
    .sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'es', { sensitivity: 'base' }),
    );

  return { staff };
}

// ─────────────────────────────────────────────────────────────────────────────
// Crear / abrir hilo (par canónico, idempotente).
// ─────────────────────────────────────────────────────────────────────────────

export type StartStaffConversationOutcome =
  | { ok: { conversationId: string } }
  | { error: 'self' | 'forbidden' | 'generic' };

/** Ordena el par de forma canónica (a < b) — igual que el CHECK de la tabla. */
function canonicalPair(x: string, y: string): [string, string] {
  return x < y ? [x, y] : [y, x];
}

/**
 * Abre (o reusa) el hilo 1:1 entre el usuario actual y otro perfil de staff. Par
 * canónico + idempotencia por UNIQUE(club_id, profile_a, profile_b): si ya existe,
 * devuelve el mismo (nunca duplica). La RLS `staff_conversations_insert_staff` es el
 * gate final (ambos deben ser staff del club) → 42501 = 'forbidden'. Ante una carrera
 * (23505) reintenta el SELECT y devuelve el existente.
 */
export async function startStaffConversationFromClient(
  supabase: Sb,
  params: { clubId: string; currentProfileId: string; otherProfileId: string },
  logError: StaffDmLogger = noopLog,
): Promise<StartStaffConversationOutcome> {
  const { clubId, currentProfileId, otherProfileId } = params;
  if (currentProfileId === otherProfileId) return { error: 'self' };
  const [a, b] = canonicalPair(currentProfileId, otherProfileId);

  const findExisting = async () =>
    supabase
      .from('staff_conversations')
      .select('id')
      .eq('club_id', clubId)
      .eq('profile_a', a)
      .eq('profile_b', b)
      .maybeSingle();

  const { data: existing } = await findExisting();
  if (existing?.id) return { ok: { conversationId: existing.id } };

  const { data: created, error: insErr } = await supabase
    .from('staff_conversations')
    .insert({ club_id: clubId, profile_a: a, profile_b: b })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    // Carrera: otro creó el mismo par entre el SELECT y el INSERT.
    if (insErr?.code === '23505') {
      const { data: raced } = await findExisting();
      if (raced?.id) return { ok: { conversationId: raced.id } };
    }
    logError(insErr ?? new Error('insert returned null'), 'start_staff_conversation', {
      club_id: clubId,
    });
    return { error: 'generic' };
  }

  return { ok: { conversationId: created.id } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cargar mensajes de un hilo.
// ─────────────────────────────────────────────────────────────────────────────

export type StaffThreadMessage = {
  id: string;
  sender_profile_id: string;
  body: string;
  created_at: string;
};

/** Mensajes del hilo de staff (ascendente). RLS bloquea si no es participante. */
export async function getStaffConversationMessagesFromClient(
  supabase: Sb,
  conversationId: string,
): Promise<StaffThreadMessage[]> {
  const { data } = await supabase
    .from('staff_messages')
    .select('id, sender_profile_id, body, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  return (data ?? []) as StaffThreadMessage[];
}

/**
 * Marca leído el hilo de staff (upsert de la marca del usuario a `nowIso`). Permitido
 * por RLS (staff_conversation_reads_*_own). Idempotente. Los no-leídos del inbox se
 * derivan por diferencia con este `last_read_at`.
 */
export async function markStaffConversationReadFromClient(
  supabase: Sb,
  conversationId: string,
  userId: string,
  nowIso: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.from('staff_conversation_reads').upsert(
    {
      profile_id: userId,
      conversation_id: conversationId,
      last_read_at: nowIso,
    },
    { onConflict: 'profile_id,conversation_id' },
  );
  return { ok: !error };
}

// ─────────────────────────────────────────────────────────────────────────────
// Enviar mensaje (+ fan-out al OTRO perfil).
// ─────────────────────────────────────────────────────────────────────────────

export type SendStaffMessageOutcome =
  | { ok: { message: StaffThreadMessage } }
  | {
      error:
        | 'invalid_payload'
        | 'conversation_not_found'
        | 'rate_limited'
        | 'forbidden'
        | 'generic';
    };

/**
 * Envía un mensaje de staff. Insert como el usuario (RLS = gate) + fan-out al OTRO
 * participante DESPUÉS del insert. Es un mensaje DIRECTO entre personas → SÍ lleva
 * push (a diferencia de las novedades in-app). Tipo `new_message` (el que ya existe).
 */
export async function sendStaffMessageFromClient(
  supabase: Sb,
  args: {
    conversationId: string;
    body: string;
    senderId: string;
    senderName: string | null;
    locale: string;
  },
  fanOut: MessageFanOut,
  logError: StaffDmLogger = noopLog,
): Promise<SendStaffMessageOutcome> {
  const parsed = sendMessageSchema.safeParse({
    conversation_id: args.conversationId,
    body: args.body,
  });
  if (!parsed.success) return { error: 'invalid_payload' };

  // La conversación (RLS: solo participante la ve). Vacío → not_found (también el
  // no-participante, oculto por RLS).
  const { data: conv } = await supabase
    .from('staff_conversations')
    .select('id, profile_a, profile_b')
    .eq('id', parsed.data.conversation_id)
    .maybeSingle();
  if (!conv) return { error: 'conversation_not_found' };

  // Rate limit por emisor (30 / 5 min), igual que 1:1 y equipo.
  const windowStartIso = new Date(
    Date.now() - MESSAGE_RATE_LIMIT.windowSeconds * 1000,
  ).toISOString();
  const { count } = await supabase
    .from('staff_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_profile_id', args.senderId)
    .gte('created_at', windowStartIso);
  if ((count ?? 0) >= MESSAGE_RATE_LIMIT.maxMessages) {
    return { error: 'rate_limited' };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('staff_messages')
    .insert({
      conversation_id: parsed.data.conversation_id,
      sender_profile_id: args.senderId,
      body: parsed.data.body,
    })
    .select('id, sender_profile_id, body, created_at')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    logError(insErr ?? new Error('insert returned null'), 'send_staff_message', {
      conversation_id: parsed.data.conversation_id,
    });
    return { error: 'generic' };
  }

  // FAN-OUT DESPUÉS del insert. Nunca frena el envío (try/catch → log).
  try {
    const other =
      conv.profile_a === args.senderId ? conv.profile_b : conv.profile_a;
    const preview = parsed.data.body.slice(0, 140);
    const deepLink = `/${args.locale}/mensajes/staff/${parsed.data.conversation_id}`;
    await fanOut([{ user_id: other }], {
      type: 'new_message',
      in_app_payload: {
        staff_conversation_id: parsed.data.conversation_id,
        message_id: inserted.id,
        sender_profile_id: args.senderId,
        deep_link: deepLink,
      },
      push_payload: {
        title: args.senderName ?? 'Mensaje nuevo',
        body: preview,
        deep_link: deepLink,
        tag: `staff_conversation:${parsed.data.conversation_id}`,
      },
      dedupe_base_prefix: `new_message:${inserted.id}`,
    });
  } catch (notifyErr) {
    logError(notifyErr, 'notify_staff', { message_id: inserted.id });
  }

  return { ok: { message: inserted as StaffThreadMessage } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbox HERMANO (forma paralela a InboxItem — la UI fusiona y ordena por fecha).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ítem del inbox de staff. Campos NOMBRADOS como los de InboxItem (kind/title/
 * lastMessageAt/unread + conversationId como el 'direct') para que la UI pueda hacer
 * `[...inbox, ...staffInbox].sort(por lastMessageAt)` sin traducir campos.
 */
export type StaffInboxItem = {
  kind: 'staff';
  conversationId: string;
  otherProfileId: string;
  /** Nombre del OTRO participante. */
  title: string;
  lastMessageAt: string;
  unread: number;
};

/**
 * Punto 11 QA (paralelo) — Nº de conversaciones de staff con mensajes sin leer.
 * Mismo criterio que countUnreadConversations: cada hilo con unread>0 cuenta como 1.
 */
export function countUnreadStaffConversations(items: StaffInboxItem[]): number {
  return items.filter((c) => c.unread > 0).length;
}

/**
 * Inbox de staff del usuario: hilos donde es participante (RLS filtra), con el nombre
 * del otro y los no-leídos DERIVADOS por diferencia con last_read_at (mensajes del
 * OTRO posteriores a mi última lectura; sin marca de lectura → todos cuentan).
 */
export async function getStaffInboxFromClient(
  supabase: Sb,
  userId: string,
): Promise<StaffInboxItem[]> {
  // Hilos del usuario (RLS staff_conversations_select_participant).
  const { data: convRows } = await supabase
    .from('staff_conversations')
    .select('id, profile_a, profile_b, last_message_at')
    .order('last_message_at', { ascending: false });
  type ConvRow = {
    id: string;
    profile_a: string;
    profile_b: string;
    last_message_at: string;
  };
  const conversations = (convRows ?? []) as ConvRow[];
  if (conversations.length === 0) return [];

  const convIds = conversations.map((c) => c.id);
  const otherIdByConv = new Map<string, string>();
  for (const c of conversations) {
    otherIdByConv.set(c.id, c.profile_a === userId ? c.profile_b : c.profile_a);
  }

  // Nombres de los "otros".
  const otherIds = [...new Set(otherIdByConv.values())];
  const { data: pRows } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', otherIds);
  const nameById = new Map(
    ((pRows ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [
      p.id,
      p.full_name ?? '',
    ]),
  );

  // Mi última lectura por hilo (RLS: solo mis marcas).
  const { data: readRows } = await supabase
    .from('staff_conversation_reads')
    .select('conversation_id, last_read_at')
    .eq('profile_id', userId);
  const lastReadByConv = new Map<string, string>();
  for (const r of (readRows ?? []) as Array<{
    conversation_id: string;
    last_read_at: string;
  }>) {
    lastReadByConv.set(r.conversation_id, r.last_read_at);
  }

  // No-leídos = mensajes del OTRO posteriores a mi last_read_at (o todos si no hay).
  const { data: msgRows } = await supabase
    .from('staff_messages')
    .select('conversation_id, created_at')
    .in('conversation_id', convIds)
    .neq('sender_profile_id', userId);
  const unreadByConv = new Map<string, number>();
  for (const m of (msgRows ?? []) as Array<{
    conversation_id: string;
    created_at: string;
  }>) {
    const readAt = lastReadByConv.get(m.conversation_id);
    if (!readAt || m.created_at > readAt) {
      unreadByConv.set(
        m.conversation_id,
        (unreadByConv.get(m.conversation_id) ?? 0) + 1,
      );
    }
  }

  return conversations
    .map(
      (c): StaffInboxItem => ({
        kind: 'staff',
        conversationId: c.id,
        otherProfileId: otherIdByConv.get(c.id) ?? '',
        title: nameById.get(otherIdByConv.get(c.id) ?? '') ?? '',
        lastMessageAt: c.last_message_at,
        unread: unreadByConv.get(c.id) ?? 0,
      }),
    )
    .sort((a, b) =>
      a.lastMessageAt < b.lastMessageAt
        ? 1
        : a.lastMessageAt > b.lastMessageAt
          ? -1
          : 0,
    );
}
