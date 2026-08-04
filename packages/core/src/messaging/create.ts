/**
 * O2-10b-1a — Crear/abrir conversación (staff INICIA) + selectores de destinatario,
 * framework-agnósticos.
 *
 * A diferencia de la familia (E2a, que solo LEE y responde dentro de un hilo
 * existente), el cuerpo técnico SÍ inicia conversaciones: 1:1 con una familia y
 * chats de equipo. Estas funciones son la EXTRACCIÓN de las Server Actions web
 * `startConversation` / `createTeamConversation` / `listMessageablePlayers` /
 * `listMessageableTeams` (apps/web/.../mensajes/actions.ts) para compartirlas con la
 * app nativa. La web pasa a delegar (wrapper con el gate UX + Sentry), comportamiento
 * idéntico.
 *
 * GATE = RLS, NO service-role: el INSERT se hace con el cliente del usuario. La RLS
 * `conversations_insert_coach` / `team_conversations_insert_staff_or_director` decide
 * quién puede crear; un no autorizado → 42501 → 'forbidden'. Nunca se usa el admin
 * client aquí (crear un hilo no dispara fan-out; el envío posterior sí, vía F3).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getActiveSeasonLabelFromClient } from '../season/active-season';

type Sb = SupabaseClient<Database>;

/** Sumidero de errores para el caller (web: Sentry). Core no importa Sentry. */
export type CreateConversationLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

const noopLog: CreateConversationLogger = () => {};

// ─────────────────────────────────────────────────────────────────────────────
// 1:1 — abrir (o reusar) la conversación coach ↔ jugador.
// ─────────────────────────────────────────────────────────────────────────────

export type StartConversationOutcome =
  | { ok: { conversationId: string } }
  | { error: 'forbidden' | 'player_not_in_club' | 'generic' };

/**
 * Abre (o reusa) la conversación 1:1 entre el coach (`coachProfileId` = auth.uid())
 * y un jugador del club. Idempotente por UNIQUE(coach_profile_id, player_id): si ya
 * existe, devuelve la misma. La RLS `conversations_insert_coach` es el gate final;
 * el trigger `conversations_same_club_trg` fija/verifica el club. El chequeo de club
 * previo es defensa en profundidad (misma comprobación que hacía la web).
 */
export async function startConversationFromClient(
  supabase: Sb,
  params: { clubId: string; playerId: string; coachProfileId: string },
  logError: CreateConversationLogger = noopLog,
): Promise<StartConversationOutcome> {
  const { clubId, playerId, coachProfileId } = params;

  // Defensa en profundidad: el jugador debe pertenecer al club activo.
  const { data: player } = await supabase
    .from('players')
    .select('id, club_id')
    .eq('id', playerId)
    .maybeSingle();
  if (!player || player.club_id !== clubId) {
    return { error: 'player_not_in_club' };
  }

  // Idempotencia por (coach_profile_id, player_id). La RLS SELECT solo devuelve la
  // fila si el user es participante.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('coach_profile_id', coachProfileId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (existing?.id) return { ok: { conversationId: existing.id } };

  const { data: created, error: insErr } = await supabase
    .from('conversations')
    .insert({ club_id: clubId, player_id: playerId, coach_profile_id: coachProfileId })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    logError(insErr ?? new Error('insert returned null'), 'start_conversation', {
      player_id: playerId,
      club_id: clubId,
    });
    return { error: 'generic' };
  }

  return { ok: { conversationId: created.id } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Equipo — abrir (o crear) el hilo de grupo del equipo.
// ─────────────────────────────────────────────────────────────────────────────

export type CreateTeamConversationOutcome =
  | { ok: { conversationId: string } }
  | { error: 'forbidden' | 'team_not_in_club' | 'generic' };

/**
 * Abre (o crea) el hilo de grupo del equipo. Idempotente por UNIQUE(team_id). Crear
 * lo permite la RLS `team_conversations_insert_staff_or_director` solo a staff del
 * equipo o admin/director → un no autorizado obtiene 42501 → 'forbidden'. El club_id
 * lo fija el trigger; lo pasamos por coherencia de tipos.
 */
export async function createTeamConversationFromClient(
  supabase: Sb,
  params: { clubId: string; teamId: string },
  logError: CreateConversationLogger = noopLog,
): Promise<CreateTeamConversationOutcome> {
  const { clubId, teamId } = params;

  const { data: existing } = await supabase
    .from('team_conversations')
    .select('id')
    .eq('team_id', teamId)
    .maybeSingle();
  if (existing?.id) return { ok: { conversationId: existing.id } };

  const { data: created, error: insErr } = await supabase
    .from('team_conversations')
    .insert({ club_id: clubId, team_id: teamId })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    if (insErr?.message?.includes('team_conversation_team_not_found')) {
      return { error: 'team_not_in_club' };
    }
    logError(insErr ?? new Error('insert returned null'), 'create_team_conversation', {
      team_id: teamId,
      club_id: clubId,
    });
    return { error: 'generic' };
  }

  return { ok: { conversationId: created.id } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Selectores de destinatario (para el flujo "Nueva conversación").
// ─────────────────────────────────────────────────────────────────────────────

export type MessageablePlayer = {
  id: string;
  first_name: string;
  last_name: string | null;
};

export type ListMessageablePlayersResult =
  | { players: MessageablePlayer[] }
  | { error: 'generic' };

/**
 * Jugadores ACTIVOS del club (sin baja, sin supresión RGPD) para el selector 1:1,
 * ordenados por nombre. Solo lectura; la RLS `players_select_member` limita a los
 * visibles. NO crea nada — la conversación se abre después con
 * `startConversationFromClient` (idempotente). Cap 500 (clubs de la beta pequeños).
 */
export async function listMessageablePlayersFromClient(
  supabase: Sb,
  clubId: string,
  logError: CreateConversationLogger = noopLog,
): Promise<ListMessageablePlayersResult> {
  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name')
    .eq('club_id', clubId)
    .is('left_club_at', null)
    .is('erased_at', null)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })
    .limit(500);

  if (error) {
    logError(error, 'list_messageable_players', { club_id: clubId });
    return { error: 'generic' };
  }
  return { players: (data ?? []) as MessageablePlayer[] };
}

export type MessageableTeam = { id: string; name: string };

export type ListMessageableTeamsResult =
  | { teams: MessageableTeam[] }
  | { error: 'generic' };

/**
 * Equipos del club (temporada activa) para el selector "Chat de equipo". Ramifica
 * por scope alineado con la RLS de F5B-2: admin/director ven todos los equipos de la
 * activa; el resto (coordinador y entrenadores), solo los que ENTRENA (team_staff
 * activo) — ofrecer más los llevaría a un hilo que la RLS no les deja abrir. La fila
 * `teams` es una por temporada (unique club_id,name,season), por eso se acota a la
 * temporada activa para no duplicar el mismo equipo.
 */
export async function listMessageableTeamsFromClient(
  supabase: Sb,
  params: { clubId: string; isAdminDir: boolean; membershipId: string },
  logError: CreateConversationLogger = noopLog,
): Promise<ListMessageableTeamsResult> {
  const { clubId, isAdminDir, membershipId } = params;
  const activeSeason = await getActiveSeasonLabelFromClient(supabase, clubId);

  let query = supabase
    .from('teams')
    .select('id, name')
    .eq('club_id', clubId)
    .eq('season', activeSeason);

  if (!isAdminDir) {
    const { data: staffRows, error: staffError } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('membership_id', membershipId)
      .is('left_at', null);

    if (staffError) {
      logError(staffError, 'list_messageable_teams_staff', { club_id: clubId });
      return { error: 'generic' };
    }

    const teamIds = (staffRows ?? []).map((r) => r.team_id as string);
    if (teamIds.length === 0) return { teams: [] };
    query = query.in('id', teamIds);
  }

  const { data, error } = await query
    .order('name', { ascending: true })
    .limit(500);

  if (error) {
    logError(error, 'list_messageable_teams', { club_id: clubId });
    return { error: 'generic' };
  }

  const teams = ((data ?? []) as Array<{ id: string; name: string }>).map((t) => ({
    id: t.id,
    name: t.name,
  }));
  return { teams };
}
