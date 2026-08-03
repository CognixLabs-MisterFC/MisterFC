/**
 * O2-8b — ESCRITURA de la ALINEACIÓN (cuerpo técnico), framework-agnóstica.
 * Extraído de `apps/web/.../convocatorias/[eventId]/alineacion/actions.ts`
 * (`upsertLineupPosition` + `setLineupFormation`). La web pasa a DELEGAR aquí (misma
 * lógica → comportamiento idéntico) y solo añade su `revalidatePath`; la app nativa
 * la llama directamente detrás del write-guard (editar exige red, sin cola).
 *
 * INCREMENTAL (réplica del modelo web): cada drop persiste con UN upsert manual por
 * jugador cambiado (SELECT → UPDATE|INSERT), NO un batch ni upsert de PostgREST. Un
 * SWAP = dos upserts (primero el desplazado a banquillo, luego el nuevo titular), de
 * modo que un intercambio legítimo no choca con el tope de titulares.
 *
 * ESCRITURA DIRECTA RLS: editar la alineación NO dispara fan-out (a diferencia de
 * publicar convocatoria), así que NO hay route handler — el cliente del usuario
 * escribe y la RLS es el GATE. `user_can_manage_lineup` autoriza; un rechazo llega
 * como 42501 → `forbidden`. NO se reimplementa el gate en cliente.
 *
 * BUG 2 (propagación → convocatoria): colocar a un jugador en campo/banquillo lo deja
 * CONVOCADO (called_up) en borrador; regla 6.6 (publicada → no auto-sync). F13B: un
 * partido de torneo maneja la plantilla solo en la cabecera → NO escribe convocatoria.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import {
  setLineupFormationSchema,
  upsertLineupPositionSchema,
} from '../schemas/lineup';
import { getFormation, defaultFormation } from './formations';
import { remapToFormation } from './geometry';
import { roleFromPosition } from './geometry';
import { exceedsStarters } from './rules';
import { calledUpOnPlace } from './callup-sync';
import { lineupWritesCallup } from '../events/aggregation';
import { getCurrentUserFromClient } from '../auth/current-user';
import type { PlayerPositionMain } from './geometry';
import type { CallupDecision } from './callup-sync';
import type { TeamFormat } from './types';

type DbClient = SupabaseClient<Database>;

export type LineupWriteError =
  | 'invalid'
  | 'not_found'
  | 'forbidden'
  | 'too_many_starters'
  | 'event_not_match'
  | 'event_without_team'
  | 'player_not_in_team_at_event'
  | 'position_code_coherence'
  | 'coords_only_field'
  | 'callup_not_published'
  | 'generic';

export type LineupWriteOutcome =
  | { ok: true; eventId: string }
  | { ok: false; error: LineupWriteError };

/** Réplica exacta de `mapPgErr` de la web (mismos strings de error). */
export function mapLineupPgErr(
  message: string | undefined,
  code: string | undefined,
): LineupWriteError {
  if (code === '42501') return 'forbidden';
  if (!message) return 'generic';
  if (message.includes('event_not_match')) return 'event_not_match';
  if (message.includes('event_without_team')) return 'event_without_team';
  if (message.includes('player_not_in_team_at_event'))
    return 'player_not_in_team_at_event';
  if (message.includes('lineup_positions_field_has_position'))
    return 'position_code_coherence';
  if (message.includes('lineup_positions_coords_only_field'))
    return 'coords_only_field';
  if (message.includes('callup_not_published')) return 'callup_not_published';
  return 'generic';
}

async function eventIdOfLineup(
  supabase: DbClient,
  lineupId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('lineups')
    .select('event_id')
    .eq('id', lineupId)
    .maybeSingle();
  return (data?.event_id as string | undefined) ?? null;
}

/** Modalidad del equipo del evento (para topar titulares por modalidad). */
async function teamFormatOfEvent(
  supabase: DbClient,
  eventId: string,
): Promise<TeamFormat | null> {
  const { data } = await supabase
    .from('events')
    .select('teams!inner(format)')
    .eq('id', eventId)
    .maybeSingle();
  const fmt = (data as unknown as { teams?: { format?: string } } | null)?.teams
    ?.format;
  return (fmt as TeamFormat | undefined) ?? null;
}

async function eventTournamentId(
  supabase: DbClient,
  eventId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('events')
    .select('tournament_id')
    .eq('id', eventId)
    .maybeSingle();
  return (data?.tournament_id as string | null | undefined) ?? null;
}

async function isCallupPublished(
  supabase: DbClient,
  eventId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('match_callup_meta')
    .select('published_at')
    .eq('event_id', eventId)
    .maybeSingle();
  return (data?.published_at as string | null | undefined) != null;
}

/**
 * BUG 2 — marca called_up al colocar en campo/banquillo (solo en borrador). No pisa
 * un descarte existente (el descarte manda hasta reincluir). Réplica de la web.
 */
async function propagateCalledUp(
  supabase: DbClient,
  eventId: string,
  playerId: string,
): Promise<void> {
  // F13B (T-2) — la alineación de un partido de torneo NO escribe convocatoria.
  if (
    !lineupWritesCallup({
      tournament_id: await eventTournamentId(supabase, eventId),
    })
  ) {
    return;
  }
  const published = await isCallupPublished(supabase, eventId);
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return;
  const { data: existing } = await supabase
    .from('callup_decisions')
    .select('decision')
    .eq('event_id', eventId)
    .eq('player_id', playerId)
    .maybeSingle();
  const op = calledUpOnPlace(
    (existing?.decision as CallupDecision | undefined) ?? null,
    published,
  );
  if (op !== 'insert_called_up') return;
  await supabase.from('callup_decisions').insert({
    event_id: eventId,
    player_id: playerId,
    decision: 'called_up',
    decided_by: user.id,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// upsertLineupPositionFromClient — coloca/mueve un jugador (field/bench).
//
// Réplica exacta de `upsertLineupPosition` (web) menos el `revalidatePath` (que la
// web añade en su wrapper). Cada drop del editor persiste los jugadores CAMBIADOS
// (uno normal, dos en un swap) con una llamada por jugador; el orden lo fija el
// llamador (desplazado→banquillo primero, luego nuevo titular).
// ─────────────────────────────────────────────────────────────────────────────

export async function upsertLineupPositionFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<LineupWriteOutcome> {
  const parsed = upsertLineupPositionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: (parsed.error.issues[0]?.message as LineupWriteError) ?? 'invalid',
    };
  }
  const v = parsed.data;

  const eventId = await eventIdOfLineup(supabase, v.lineup_id);
  if (!eventId) return { ok: false, error: 'not_found' };

  // Tope de titulares por modalidad (solo al colocar/mover a campo).
  if (v.location === 'field') {
    const format = await teamFormatOfEvent(supabase, eventId);
    if (format) {
      const { data: fieldRows } = await supabase
        .from('lineup_positions')
        .select('player_id')
        .eq('lineup_id', v.lineup_id)
        .eq('location', 'field');
      const fieldOthers = (fieldRows ?? [])
        .map((r) => r.player_id as string)
        .filter((pid) => pid !== v.player_id);
      if (exceedsStarters(fieldOthers.length + 1, format)) {
        return { ok: false, error: 'too_many_starters' };
      }
    }
  }

  const { data: existing } = await supabase
    .from('lineup_positions')
    .select('id')
    .eq('lineup_id', v.lineup_id)
    .eq('player_id', v.player_id)
    .maybeSingle();

  const row = {
    location: v.location,
    position_code: v.position_code,
    x_pct: v.x_pct,
    y_pct: v.y_pct,
  };

  if (existing) {
    const { error } = await supabase
      .from('lineup_positions')
      .update(row)
      .eq('id', existing.id as string);
    if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };
  } else {
    const { error } = await supabase
      .from('lineup_positions')
      .insert({ lineup_id: v.lineup_id, player_id: v.player_id, ...row });
    if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };
  }

  // BUG 2 — en campo o banquillo → convocado (borrador; respeta 6.6).
  await propagateCalledUp(supabase, eventId, v.player_id);

  return { ok: true, eventId };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupFormationFromClient — cambia la formación y reubica los titulares.
//
// Réplica exacta de `setLineupFormation` (web) menos el `revalidatePath`. Nota: en la
// UI (Fix #8) el editor vacía el campo al cambiar de formación persistiendo cada
// titular a banquillo DESPUÉS; esta función mantiene la semántica del server action
// original (remap por rol), sobre la que el llamador aplica su política de UI.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupFormationFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<LineupWriteOutcome> {
  const parsed = setLineupFormationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { lineup_id, formation_code } = parsed.data;

  const eventId = await eventIdOfLineup(supabase, lineup_id);
  if (!eventId) return { ok: false, error: 'not_found' };

  const next = getFormation(formation_code) ?? defaultFormation('F11');

  // Titulares actuales + su rol de ficha para reasignar conservando posición.
  const { data: fieldRows } = await supabase
    .from('lineup_positions')
    .select('player_id, players!inner(position_main)')
    .eq('lineup_id', lineup_id)
    .eq('location', 'field');
  type FieldShape = {
    player_id: string;
    players: { position_main: PlayerPositionMain };
  };
  const fieldPlayers = (fieldRows ?? []).map((r) => {
    const f = r as unknown as FieldShape;
    return { playerId: f.player_id, role: roleFromPosition(f.players.position_main) };
  });

  const { assignments, benched } = remapToFormation(fieldPlayers, next);

  // Actualiza la cabecera.
  {
    const { error } = await supabase
      .from('lineups')
      .update({ formation_code })
      .eq('id', lineup_id);
    if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };
  }

  // Reubica titulares en los slots de la nueva formación.
  for (const a of assignments) {
    const { error } = await supabase
      .from('lineup_positions')
      .update({
        location: 'field',
        position_code: a.positionCode,
        x_pct: a.xPct,
        y_pct: a.yPct,
      })
      .eq('lineup_id', lineup_id)
      .eq('player_id', a.playerId);
    if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };
  }
  // Los que ya no caben → banquillo.
  for (const playerId of benched) {
    const { error } = await supabase
      .from('lineup_positions')
      .update({
        location: 'bench',
        position_code: null,
        x_pct: null,
        y_pct: null,
      })
      .eq('lineup_id', lineup_id)
      .eq('player_id', playerId);
    if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };
  }

  return { ok: true, eventId };
}
