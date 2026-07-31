/**
 * O2-5 E2a — Queries de LECTURA de mensajería, framework-agnósticas.
 *
 * Extraídas de `apps/web/.../mensajes/*` (inbox, hilos 1:1 y de equipo, marcar
 * leído) para que la app nativa de FAMILIA las consuma. La web pasa a delegar
 * (wrapper, comportamiento idéntico). NADA de envío/iniciar hilo (eso es E2b y
 * necesita el fan-out con service-role). La autorización la impone la RLS
 * (participante 1:1, pertenencia derivada del chat de equipo); aquí NO se
 * reimplementa. Solo texto, sin adjuntos.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { formatPlayerName } from '../utils/name';

type Sb = SupabaseClient<Database>;

/** Ítem unificado del inbox (1:1 o equipo), ordenado por actividad reciente. */
export type InboxItem =
  | {
      kind: 'direct';
      /** id de la conversación 1:1. */
      conversationId: string;
      playerId: string;
      /** Nombre del jugador (ya formateado). */
      title: string;
      lastMessageAt: string;
      unread: number;
    }
  | {
      kind: 'group';
      /** id de la team_conversation (para mensajes/lectura). */
      teamConversationId: string;
      /** id del equipo (para navegación/rótulo). */
      teamId: string;
      /** Nombre del equipo (crudo; cada front decora el rótulo de grupo). */
      title: string;
      lastMessageAt: string;
      unread: number;
    };

export type ConversationMessage = {
  id: string;
  sender_profile_id: string;
  body: string;
  sent_at: string;
  read_at: string | null;
};

export type TeamThreadMessage = {
  id: string;
  sender_profile_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

/**
 * Inbox del usuario: conversaciones 1:1 (RLS filtra a las suyas) + chats de
 * equipo (RLS filtra a los de su pertenencia), con no-leídos, fusionados y
 * ordenados por `lastMessageAt` desc. Réplica EXACTA de `mensajes/page.tsx`.
 */
export async function getInboxFromClient(
  supabase: Sb,
  userId: string,
): Promise<InboxItem[]> {
  // 1:1 — RLS conversations_select_participants ya filtra a las del user.
  const { data: conversationRows } = await supabase
    .from('conversations')
    .select(
      'id, last_message_at, coach_profile_id, players!inner(id, first_name, last_name)',
    )
    .order('last_message_at', { ascending: false });
  type ConversationRow = {
    id: string;
    last_message_at: string;
    coach_profile_id: string;
    players: { id: string; first_name: string; last_name: string | null };
  };
  const conversations = (conversationRows ?? []) as unknown as ConversationRow[];

  // No-leídos 1:1 por conversación (mensajes recibidos, no propios, sin read_at).
  const ids = conversations.map((c) => c.id);
  const unreadByConvId = new Map<string, number>();
  if (ids.length > 0) {
    const { data: unreadRows } = await supabase
      .from('messages')
      .select('conversation_id')
      .in('conversation_id', ids)
      .is('read_at', null)
      .neq('sender_profile_id', userId);
    for (const m of unreadRows ?? []) {
      const id = (m as { conversation_id: string }).conversation_id;
      unreadByConvId.set(id, (unreadByConvId.get(id) ?? 0) + 1);
    }
  }

  // Chats de equipo — RLS team_conversations filtra a los de su pertenencia.
  const { data: teamConvRows } = await supabase
    .from('team_conversations')
    .select('id, team_id, last_message_at, teams!inner(name)')
    .order('last_message_at', { ascending: false });
  type TeamConvRow = {
    id: string;
    team_id: string;
    last_message_at: string;
    teams: { name: string };
  };
  const teamConversations = (teamConvRows ?? []) as unknown as TeamConvRow[];

  // No-leídos por grupo (RPC SECURITY DEFINER acotado a auth.uid()).
  const unreadByTeamConvId = new Map<string, number>();
  const { data: teamUnreadRows } = await supabase.rpc('team_chat_unread_counts');
  for (const r of (teamUnreadRows ?? []) as {
    team_conversation_id: string;
    unread: number;
  }[]) {
    unreadByTeamConvId.set(r.team_conversation_id, r.unread);
  }

  const items: InboxItem[] = [
    ...conversations.map(
      (c): InboxItem => ({
        kind: 'direct',
        conversationId: c.id,
        playerId: c.players.id,
        title: formatPlayerName(c.players.first_name, c.players.last_name),
        lastMessageAt: c.last_message_at,
        unread: unreadByConvId.get(c.id) ?? 0,
      }),
    ),
    ...teamConversations.map(
      (tc): InboxItem => ({
        kind: 'group',
        teamConversationId: tc.id,
        teamId: tc.team_id,
        title: tc.teams?.name ?? '',
        lastMessageAt: tc.last_message_at,
        unread: unreadByTeamConvId.get(tc.id) ?? 0,
      }),
    ),
  ].sort((a, b) =>
    a.lastMessageAt < b.lastMessageAt
      ? 1
      : a.lastMessageAt > b.lastMessageAt
        ? -1
        : 0,
  );

  return items;
}

/** Mensajes del hilo 1:1 (ascendente). RLS bloquea si no es participante. */
export async function getConversationMessagesFromClient(
  supabase: Sb,
  conversationId: string,
): Promise<ConversationMessage[]> {
  const { data } = await supabase
    .from('messages')
    .select('id, sender_profile_id, body, sent_at, read_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });
  return (data ?? []) as ConversationMessage[];
}

/** Mensajes del hilo de equipo (ascendente), con nombre del emisor. */
export async function getTeamMessagesFromClient(
  supabase: Sb,
  teamConversationId: string,
): Promise<TeamThreadMessage[]> {
  const { data } = await supabase
    .from('team_messages')
    .select('id, sender_profile_id, body, created_at, profiles!inner(full_name)')
    .eq('team_conversation_id', teamConversationId)
    .order('created_at', { ascending: true });
  type Row = {
    id: string;
    sender_profile_id: string;
    body: string;
    created_at: string;
    profiles: { full_name: string | null };
  };
  return ((data ?? []) as unknown as Row[]).map((m) => ({
    id: m.id,
    sender_profile_id: m.sender_profile_id,
    sender_name: m.profiles?.full_name ?? '',
    body: m.body,
    created_at: m.created_at,
  }));
}

/**
 * Marca leídos los mensajes 1:1 recibidos por el user (read_at NULL→ahora).
 * Escritura de bajo riesgo permitida por RLS (messages_update_participant).
 * Idempotente. `nowIso` explícito para determinismo/tests.
 */
export async function markConversationReadFromClient(
  supabase: Sb,
  conversationId: string,
  userId: string,
  nowIso: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: nowIso })
    .eq('conversation_id', conversationId)
    .is('read_at', null)
    .neq('sender_profile_id', userId);
  return { ok: !error };
}

/**
 * Marca leído el chat de equipo (upsert de la marca del user a `nowIso`).
 * Permitido por RLS (team_conversation_reads_*_own).
 */
export async function markTeamConversationReadFromClient(
  supabase: Sb,
  teamConversationId: string,
  userId: string,
  nowIso: string,
): Promise<{ ok: boolean }> {
  const { error } = await supabase.from('team_conversation_reads').upsert(
    {
      profile_id: userId,
      team_conversation_id: teamConversationId,
      last_read_at: nowIso,
    },
    { onConflict: 'profile_id,team_conversation_id' },
  );
  return { ok: !error };
}
