'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  getConversationMessagesFromClient,
  getTeamMessagesFromClient,
  sendMessageSchema,
  startConversationSchema,
  startConversationFromClient,
  createTeamConversationFromClient,
  listMessageablePlayersFromClient,
  listMessageableTeamsFromClient,
  startStaffConversationFromClient,
  listStaffDirectoryFromClient,
  getStaffConversationMessagesFromClient,
  markStaffConversationReadFromClient,
  type StaffDirectoryEntry,
  type StaffThreadMessage as CoreStaffThreadMessage,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import {
  sendDirectMessage,
  sendTeamMessage as sendTeamMessageWrapped,
  sendStaffMessage as sendStaffMessageWrapped,
} from '@/lib/send-message';
import { userCanMessageInClub } from '@/lib/messaging-permissions';

/** Sumidero de errores → Sentry, inyectado en los orquestadores de core. */
const sentryLog = (error: unknown, step: string, extra: Record<string, unknown>) =>
  Sentry.captureException(error, { tags: { feature: 'messaging', step }, extra });

export type StartConversationResult = {
  ok?: { conversation_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'player_not_in_club'
    | 'no_active_club'
    | 'generic';
};

/**
 * Abre (o reusa) una conversación 1:1 entre el coach (auth.uid()) y un
 * jugador del club activo. Idempotente por UNIQUE (coach_profile_id,
 * player_id) — si ya existe, devuelve la misma.
 *
 * Permisos: admin/coord/principal por rol; ayudante con cap on, O
 * ayudante con team_staff.staff_role='entrenador_principal' (caso F2.6 —
 * ver `userCanMessageInClub`). RLS es la autoridad final.
 */
export async function startConversation(
  locale: string,
  input: { player_id: string },
): Promise<StartConversationResult> {
  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  // O2-10b-1a — la creación/idempotencia + chequeo de club se extrajo a core
  // (`startConversationFromClient`, INSERT RLS-gated como el usuario) para compartirla
  // con la app nativa. El gate UX (userCanMessageInClub) y el revalidate siguen aquí.
  const res = await startConversationFromClient(
    supabase,
    { clubId, playerId: parsed.data.player_id, coachProfileId: ctx.user.id },
    sentryLog,
  );
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/jugadores/${parsed.data.player_id}`);
  return { ok: { conversation_id: res.ok.conversationId } };
}

export type SendMessageResult = {
  ok?: { message_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'rate_limited'
    | 'conversation_not_found'
    | 'generic';
};

/**
 * Envía un mensaje a una conversación existente. El sender se fuerza a
 * auth.uid() vía trigger BD; aquí también lo hacemos por explicitud. Rate
 * limit: 30 / 5 min por sender (ADR D7 del spec 5.0). Tras inserto válido,
 * crea fila en notifications para la otra parte (Lote B la enviará por push).
 */
export async function sendMessage(
  locale: string,
  input: { conversation_id: string; body: string },
): Promise<SendMessageResult> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Orquestación compartida con el route handler nativo (O2-5 F3): insert como el
  // usuario (RLS = gate) + fan-out DESPUÉS. El wrapper inyecta el fan-out real
  // (service-role) y Sentry. Comportamiento web idéntico.
  const res = await sendDirectMessage(supabase, {
    conversationId: parsed.data.conversation_id,
    body: parsed.data.body,
    senderId: ctx.user.id,
    senderName: ctx.profile.full_name ?? null,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/${parsed.data.conversation_id}`);
  return { ok: { message_id: res.ok.message.id } };
}

export type MarkReadResult = { ok?: true; error?: 'forbidden' | 'generic' };

/**
 * Marca como leídos todos los mensajes de la conversación que NO ha enviado
 * el user actual (es decir, los recibidos por él/ella). Idempotente: si ya
 * están leídos, el UPDATE no afecta filas.
 */
export async function markConversationRead(
  locale: string,
  conversationId: string,
): Promise<MarkReadResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error: updErr } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .is('read_at', null)
    .neq('sender_profile_id', ctx.user.id);

  if (updErr) {
    if (updErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(updErr, {
      tags: { feature: 'messaging', step: 'mark_read' },
      extra: { conversation_id: conversationId },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/${conversationId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// listMessageablePlayers (F5B-1) — jugadores del club con los que el user puede
// iniciar un chat 1:1, para el selector con buscador de /mensajes.
// ─────────────────────────────────────────────────────────────────────────────

export type MessageablePlayer = {
  id: string;
  first_name: string;
  last_name: string | null;
};

export type ListMessageablePlayersResult = {
  players?: MessageablePlayer[];
  error?: 'forbidden' | 'generic';
};

/**
 * Devuelve los jugadores ACTIVOS del club activo (baja `left_club_at IS NULL`),
 * ordenados por nombre, para el selector "Nueva conversación". Solo lectura.
 *
 * Alcance: se gatea con `userCanMessageInClub` (mismo criterio que el botón de
 * la ficha del jugador) y se lee con el cliente del user → la RLS
 * `players_select_member` limita a los jugadores visibles del club. NO crea
 * nada; la conversación se abre después con `startConversation` (idempotente).
 *
 * El buscador filtra en cliente sobre esta lista (los clubs de la beta son
 * pequeños; se cap­a a 500 para acotar el payload). Si un club creciera mucho,
 * migrar a búsqueda por término en servidor.
 */
export async function listMessageablePlayers(): Promise<ListMessageablePlayersResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  // O2-10b-1a — la query se extrajo a core (`listMessageablePlayersFromClient`,
  // RLS players_select_member). El gate UX sigue aquí.
  const res = await listMessageablePlayersFromClient(supabase, clubId, sentryLog);
  if ('error' in res) return { error: res.error };
  return { players: res.players as MessageablePlayer[] };
}

// ─────────────────────────────────────────────────────────────────────────────
// F5B-3 — Chat de EQUIPO (grupo). Modelo team_conversations/team_messages (F5B-2).
// ─────────────────────────────────────────────────────────────────────────────

export type OpenTeamConversationResult = {
  ok?: { conversation_id: string };
  error?: 'forbidden' | 'no_active_club' | 'team_not_in_club' | 'generic';
};

/**
 * Abre (o crea si no existe) el hilo de grupo del equipo. Idempotente por
 * UNIQUE(team_id): si ya existe, devuelve el existente. Crear el hilo lo permite
 * la RLS solo a staff del equipo o admin/director (para jugadores/familia sin
 * hilo aún → 'forbidden'). El club_id lo fija el trigger; lo pasamos por
 * coherencia de tipos.
 */
export async function createTeamConversation(
  locale: string,
  teamId: string,
): Promise<OpenTeamConversationResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // O2-10b-1a — abrir/crear el hilo de grupo se extrajo a core
  // (`createTeamConversationFromClient`, idempotente + RLS-gated). El gate real de
  // crear lo impone la RLS `team_conversations_insert_staff_or_director`.
  const res = await createTeamConversationFromClient(
    supabase,
    { clubId, teamId },
    sentryLog,
  );
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/equipo/${teamId}`);
  return { ok: { conversation_id: res.ok.conversationId } };
}

export type SendTeamMessageResult = {
  ok?: { message_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'rate_limited'
    | 'conversation_not_found'
    | 'generic';
};

/**
 * Envía un mensaje al hilo de grupo. La RLS de team_messages valida la
 * pertenencia (bidireccional — todo miembro escribe); el trigger fuerza sender =
 * auth.uid(). Tras insertar, notifica al resto de miembros derivados vía
 * team_chat_member_profile_ids (fan-out), respetando notification_preferences.
 *
 * NOTA F5B-4: aquí el director recibe como cualquiera. El filtrado observer
 * (excluir directores que solo vigilan) se añadirá filtrando `recipients` antes
 * del fan-out; el punto de extensión ya está aislado abajo.
 */
export async function sendTeamMessage(
  locale: string,
  input: { team_conversation_id: string; body: string },
): Promise<SendTeamMessageResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Orquestación compartida (O2-5 F3): insert como el usuario (RLS = gate) +
  // fan-out a los miembros derivados DESPUÉS. Wrapper inyecta fan-out + Sentry.
  const res = await sendTeamMessageWrapped(supabase, {
    teamConversationId: input.team_conversation_id,
    body: input.body,
    senderId: ctx.user.id,
    senderName: ctx.profile.full_name ?? null,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/equipo/${res.ok.teamId}`);
  return { ok: { message_id: res.ok.message.id } };
}

export type MessageableTeam = { id: string; name: string };
export type ListMessageableTeamsResult = {
  teams?: MessageableTeam[];
  error?: 'forbidden' | 'generic';
};

/**
 * Equipos del club para el selector "Chat de equipo" de /mensajes (P2b). Gated
 * por userCanMessageInClub (staff/dirección — a los jugadores/familia les basta
 * el listado de /mensajes, que ya muestra sus grupos). El gate real de crear/abrir
 * lo impone la RLS de team_conversations + la página del hilo; esto solo decide
 * QUÉ ofrecer para no acabar en callejones sin salida.
 *
 * Bug 1 (temporada): `teams` es una fila POR TEMPORADA desde Rework A
 * (unique(club_id, name, season)), así que sin filtrar por temporada el mismo
 * equipo aparece repetido una vez por temporada. Se acota a la temporada ACTIVA
 * del club (seasons.status='active'), igual que el hub de Equipos.
 *
 * Bug 2 (scope por rol): quien tiene chat de TODOS los equipos del club es, por
 * la RLS de F5B-2 (user_is_admin_or_director), solo admin_club/director. El resto
 * (coordinador y entrenadores) solo es miembro del chat de los equipos que
 * ENTRENA (team_staff). Por eso se ramifica: admin/director ven todos los equipos
 * de la temporada activa; los demás, solo los que entrenan en esa temporada —
 * ofrecer más los llevaría a un hilo que la RLS no les deja abrir.
 */
export async function listMessageableTeams(): Promise<ListMessageableTeamsResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  // El rol del user en el club activo ya viene resuelto (ctx.activeClub.role).
  // Alineamos "ve todos" con la RLS: admin_club/director.
  const isAdminDir =
    ctx.activeClub.role === 'admin_club' || ctx.activeClub.role === 'director';

  // O2-10b-1a — la resolución (temporada activa + ramificación por scope) se extrajo
  // a core (`listMessageableTeamsFromClient`). El gate UX sigue aquí.
  const res = await listMessageableTeamsFromClient(
    supabase,
    { clubId, isAdminDir, membershipId: ctx.activeClub.membershipId },
    sentryLog,
  );
  if ('error' in res) return { error: res.error };
  return { teams: res.teams };
}

// ─────────────────────────────────────────────────────────────────────────────
// F5B-3b — Refetch ligero de mensajes para el auto-refresco por polling (~5s).
// Solo lectura; la RLS filtra por pertenencia (1:1 participant / grupo miembro).
// No revalida ni marca leídos: el hilo abierto solo REPINTA lo nuevo.
// ─────────────────────────────────────────────────────────────────────────────

export type ConversationMessage = {
  id: string;
  sender_profile_id: string;
  body: string;
  sent_at: string;
  read_at: string | null;
};

/** Mensajes del hilo 1:1 (para el polling del MessageThread). */
export async function fetchConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const ctx = await loadShellContext();
  if (!ctx) return [];
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // O2-5 E2a — el fetch se extrajo a core (misma query + RLS) para compartirlo
  // con la app nativa. Comportamiento idéntico.
  return getConversationMessagesFromClient(supabase, conversationId);
}

export type TeamThreadMessage = {
  id: string;
  sender_profile_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

/** Mensajes del hilo de grupo (para el polling del TeamMessageThread). */
export async function fetchTeamMessages(
  teamConversationId: string,
): Promise<TeamThreadMessage[]> {
  const ctx = await loadShellContext();
  if (!ctx) return [];
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  // O2-5 E2a — el fetch se extrajo a core (misma query + RLS). Idéntico.
  return getTeamMessagesFromClient(supabase, teamConversationId);
}

// ─────────────────────────────────────────────────────────────────────────────
// F5B-4 — Supervisión: el director activa/desactiva su participación en un chat.
// ─────────────────────────────────────────────────────────────────────────────

export type TeamChatMode = 'observer' | 'active';
export type SetTeamChatParticipationResult = {
  ok?: { mode: TeamChatMode };
  error?: 'forbidden' | 'invalid_payload' | 'generic';
};

/**
 * Fija el modo de participación del director/admin en el chat de un equipo:
 * 'active' (escribe + recibe notificaciones) u 'observer' (solo lee). Upsert en
 * team_chat_participation. SOLO para admin/director (staff/jugadores participan
 * por pertenencia derivada y no usan esta tabla). La RLS de la tabla es la
 * autoridad final; aquí filtramos por rol para no intentar escrituras que la RLS
 * rechazaría.
 */
export async function setTeamChatParticipation(
  locale: string,
  input: { team_id: string; mode: TeamChatMode },
): Promise<SetTeamChatParticipationResult> {
  if (
    !input.team_id ||
    (input.mode !== 'observer' && input.mode !== 'active')
  ) {
    return { error: 'invalid_payload' };
  }

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const isAdminDir =
    ctx.activeClub.role === 'admin_club' || ctx.activeClub.role === 'director';
  if (!isAdminDir) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('team_chat_participation')
    .upsert(
      {
        profile_id: ctx.user.id,
        team_id: input.team_id,
        mode: input.mode,
      },
      { onConflict: 'profile_id,team_id' },
    );

  if (error) {
    if (error.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(error, {
      tags: { feature: 'messaging', step: 'set_team_chat_participation' },
      extra: { team_id: input.team_id },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/mensajes/equipo/${input.team_id}`);
  return { ok: { mode: input.mode } };
}

// ─────────────────────────────────────────────────────────────────────────────
// O2-12 — Mensajería privada entre STAFF (1:1 perfil↔perfil). Mismo patrón que las
// de familia/equipo: server actions que envuelven core con el gate UX
// (userCanMessageInClub) + revalidatePath. Envío por el wrapper `sendStaffMessage`
// de #520 (service-role fan-out), NO por el endpoint nativo. RLS es la autoridad.
// ─────────────────────────────────────────────────────────────────────────────

export type StaffDirectoryResult = {
  staff?: StaffDirectoryEntry[];
  error?: 'forbidden' | 'generic';
};

/** Directorio de staff del club (destinatarios), agrupado por rol en el cliente. */
export async function listStaffDirectory(): Promise<StaffDirectoryResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  const res = await listStaffDirectoryFromClient(
    supabase,
    { clubId, currentProfileId: ctx.user.id },
    sentryLog,
  );
  if ('error' in res) return { error: res.error };
  return { staff: res.staff };
}

export type StartStaffConversationResult = {
  ok?: { conversation_id: string };
  error?: 'forbidden' | 'self' | 'generic';
};

/**
 * Abre (o reusa) el hilo 1:1 entre el usuario y otro perfil de staff. Idempotente
 * (par canónico); la RLS `staff_conversations_insert_staff` exige que AMBOS sean
 * staff del club → 42501 = forbidden.
 */
export async function startStaffConversation(
  locale: string,
  otherProfileId: string,
): Promise<StartStaffConversationResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  const res = await startStaffConversationFromClient(
    supabase,
    { clubId, currentProfileId: ctx.user.id, otherProfileId },
    sentryLog,
  );
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  return { ok: { conversation_id: res.ok.conversationId } };
}

export type SendStaffMessageResult = {
  ok?: { message_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'rate_limited'
    | 'conversation_not_found'
    | 'generic';
};

/** Envía un mensaje al hilo de staff. Reusa el wrapper de #520 (fan-out al otro). */
export async function sendStaffMessage(
  locale: string,
  input: { conversation_id: string; body: string },
): Promise<SendStaffMessageResult> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await sendStaffMessageWrapped(supabase, {
    conversationId: parsed.data.conversation_id,
    body: parsed.data.body,
    senderId: ctx.user.id,
    senderName: ctx.profile.full_name ?? null,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/staff/${parsed.data.conversation_id}`);
  return { ok: { message_id: res.ok.message.id } };
}

/**
 * Marca leído el hilo de staff (upsert de la marca del user). Idempotente. Los
 * no-leídos del inbox se derivan por diferencia con last_read_at.
 */
export async function markStaffConversationRead(
  locale: string,
  conversationId: string,
): Promise<MarkReadResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await markStaffConversationReadFromClient(
    supabase,
    conversationId,
    ctx.user.id,
    new Date().toISOString(),
  );
  if (!res.ok) return { error: 'generic' };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/staff/${conversationId}`);
  return { ok: true };
}

export type StaffThreadMessage = CoreStaffThreadMessage;

/** Mensajes del hilo de staff (para el polling del StaffMessageThread). */
export async function fetchStaffMessages(
  conversationId: string,
): Promise<StaffThreadMessage[]> {
  const ctx = await loadShellContext();
  if (!ctx) return [];
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getStaffConversationMessagesFromClient(supabase, conversationId);
}
