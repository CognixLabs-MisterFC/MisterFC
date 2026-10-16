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
  createLineupFromClientSchema,
  setLineupFormationSchema,
  setLineupOfficialSchema,
  setLineupVisibilitySchema,
  upsertLineupPositionSchema,
} from '../schemas/lineup';
import { defaultLineupDraft, getFormation, defaultFormation } from './formations';
import { remapToFormation } from './geometry';
import { roleFromPosition } from './geometry';
import { exceedsStarters } from './rules';
import { calledUpOnPlace } from './callup-sync';
import { callupEventIdFor, lineupWritesCallup } from '../events/aggregation';
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
// setLineupOfficialFromClient — marca oficial (desmarca las demás del evento).
//
// Réplica exacta de `setLineupOfficial` (web) menos el `revalidatePath`. La web pasa
// a DELEGAR aquí; la app nativa la llama tras el write-guard. GUARDIA (Jose): para
// marcar oficial, la convocatoria debe estar PUBLICADA (así el jugador no ve la
// alineación antes que la citación). Antes de tocar nada se desmarca cualquier otra
// oficial del evento (índice parcial único `lineups_one_official_per_event`). El
// trigger `lineups_validate` es la barrera real; aquí el gate de UX + RLS.
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupOfficialFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<LineupWriteOutcome> {
  const parsed = setLineupOfficialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { lineup_id, is_official } = parsed.data;

  const eventId = await eventIdOfLineup(supabase, lineup_id);
  if (!eventId) return { ok: false, error: 'not_found' };

  if (is_official) {
    // Guard de UX ANTES de tocar nada — así no se ejecuta el "desmarca las demás"
    // (que si no dejaría el partido sin ninguna oficial y luego fallaría en el trigger).
    if (!(await isCallupPublished(supabase, eventId))) {
      return { ok: false, error: 'callup_not_published' };
    }
    // Desmarca cualquier otra oficial del evento antes (índice parcial único).
    const { error: clearErr } = await supabase
      .from('lineups')
      .update({ is_official: false })
      .eq('event_id', eventId)
      .neq('id', lineup_id);
    if (clearErr) {
      return { ok: false, error: mapLineupPgErr(clearErr.message, clearErr.code) };
    }
  }

  const { error } = await supabase
    .from('lineups')
    .update({ is_official })
    .eq('id', lineup_id);
  if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };

  return { ok: true, eventId };
}

// ─────────────────────────────────────────────────────────────────────────────
// setLineupVisibilityFromClient — compartir con equipo/familias (staff|team).
//
// Réplica exacta de `setLineupVisibility` (web) menos el `revalidatePath`. Solo la
// alineación OFICIAL con visibility='team' la ve el jugador/familia (RLS); ambas
// condiciones se marcan por acciones separadas (esta y `setLineupOfficial`).
// ─────────────────────────────────────────────────────────────────────────────

export async function setLineupVisibilityFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<LineupWriteOutcome> {
  const parsed = setLineupVisibilitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };

  const eventId = await eventIdOfLineup(supabase, parsed.data.lineup_id);
  if (!eventId) return { ok: false, error: 'not_found' };

  const { error } = await supabase
    .from('lineups')
    .update({ visibility: parsed.data.visibility })
    .eq('id', parsed.data.lineup_id);
  if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };

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

// ─────────────────────────────────────────────────────────────────────────────
// createLineupFromClient — CREAR la alineación: cabecera + banquillo sembrado.
//
// POR QUÉ EXISTE. La regla «sembrar el banquillo con los convocados» estaba
// escrita DOS VECES en web y CERO en core, así que la app nativa no podía crear
// nada: sus cuatro escrituras de alineación (colocar, formación, oficial,
// visibilidad) exigen una fila que ya exista. Las dos copias de web eran:
//
//   · `createLineup` (server action) — el camino explícito, para una segunda
//     alineación (Plan B). Lee `team_members` a la fecha del evento.
//   · el auto-crear de `loadLineupEditor` (queries.ts, «Bug BB») — el camino que
//     de verdad se usa: abrir la pantalla CREA el borrador. Siembra con el roster
//     que ya tenía cargado, que incluye a los SUBIDOS (`player_promotions`, D2.1).
//
// Y no decían lo mismo: la acción explícita NO sembraba a los jugadores subidos
// (es anterior a D2.1), así que un Plan B dejaba al subido fuera del banquillo. Al
// unificar aquí gana la versión del auto-crear —roster a la fecha ∪ subidos al
// evento− descartados—, que es la que ve un entrenador al abrir la alineación y la
// que la BD acepta desde D2.1 (`player_promoted_to_event` en el trigger).
//
// LA SIEMBRA ES BEST-EFFORT, Y ESO SE DEVUELVE. No hay transacción sobre PostgREST:
// la cabecera ya está escrita cuando se intenta el banquillo, así que un fallo ahí
// NO puede devolverse como «no se ha creado» —sería mentira, y el llamador volvería
// a crear otra—. Se devuelve `ok: true` con `seedError`, y el llamador decide qué
// avisa. La web hoy ignora ese error en los dos sitios; la nativa lo necesita,
// porque su banquillo se pinta SOLO desde `lineup_positions`: sin siembra no hay
// ficha que arrastrar.
//
// Lo que NO entra aquí: la propagación a la convocatoria (BUG 2, marcar called_up a
// los sembrados). Eso lo hace solo la acción explícita de web y NO el auto-crear, o
// sea que no está duplicado y no es de esta pieza. Se queda en su llamador, con
// `seeded` como entrada, y la divergencia queda anotada en vez de resuelta a
// escondidas: alinear los dos caminos cambia lo que ve un entrenador (abrir la
// pantalla le llenaría la convocatoria) y eso es una decisión, no un refactor.
// ─────────────────────────────────────────────────────────────────────────────

export type CreatedLineup = {
  id: string;
  name: string;
  formationCode: string;
  isOfficial: boolean;
  visibility: 'staff' | 'team';
};

export type CreateLineupOutcome =
  | {
      ok: true;
      lineup: CreatedLineup;
      /** Jugadores sembrados al banquillo (los convocados), en orden de roster. */
      seeded: string[];
      /** Fallo de la siembra, con la cabecera YA creada. null = todo bien. */
      seedError: LineupWriteError | null;
    }
  | { ok: false; error: LineupWriteError };

/**
 * Los CONVOCADOS del evento: roster a la fecha del partido ∪ subidos a ese evento,
 * menos los descartados. El ancla de la convocatoria es `callupEventIdFor` (la
 * cabecera si es partido de torneo, F13B).
 */
async function calledUpForSeeding(
  supabase: DbClient,
  event: { id: string; team_id: string; starts_at: string; tournament_id: string | null },
): Promise<string[]> {
  const eventDate = event.starts_at.slice(0, 10);

  const { data: tms } = await supabase
    .from('team_members')
    .select('player_id, joined_at, left_at')
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type TM = { player_id: string; joined_at: string; left_at: string | null };
  const rosterIds = (tms ?? [])
    .map((r) => r as unknown as TM)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => r.player_id);

  // D2.1 — subidos a ESTE evento: alineables como uno más, sin estar en el roster.
  const { data: promos } = await supabase
    .from('player_promotions')
    .select('player_id')
    .eq('event_id', event.id);
  const todos = [...rosterIds];
  for (const p of promos ?? []) {
    const pid = p.player_id as string;
    if (!todos.includes(pid)) todos.push(pid);
  }

  const { data: decisions } = await supabase
    .from('callup_decisions')
    .select('player_id, decision')
    .eq('event_id', callupEventIdFor(event));
  const descartados = new Set(
    (decisions ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => d.player_id as string),
  );

  return todos.filter((pid) => !descartados.has(pid));
}

export async function createLineupFromClient(
  supabase: DbClient,
  input: unknown,
): Promise<CreateLineupOutcome> {
  const parsed = createLineupFromClientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const { event_id, name, formation_code } = parsed.data;

  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { ok: false, error: 'forbidden' };

  // El evento da la fecha (roster histórico), el equipo y la MODALIDAD (para el
  // borrador por defecto). El trigger de BD valida type='match' y team_id, pero
  // sin team_id aquí no se puede sembrar: se corta antes con el mismo error.
  const { data: evRow } = await supabase
    .from('events')
    .select('id, team_id, starts_at, tournament_id, teams!inner(format)')
    .eq('id', event_id)
    .maybeSingle();
  type EventShape = {
    id: string;
    team_id: string | null;
    starts_at: string;
    tournament_id: string | null;
    teams: { format: TeamFormat };
  };
  const ev = evRow as unknown as EventShape | null;
  if (!ev) return { ok: false, error: 'not_found' };
  if (ev.team_id == null) return { ok: false, error: 'event_without_team' };

  const draft = defaultLineupDraft(ev.teams.format);
  const { data: created, error } = await supabase
    .from('lineups')
    .insert({
      event_id,
      name: name ?? draft.name,
      formation_code: formation_code ?? draft.formationCode,
      created_by: user.id,
    })
    .select('id, name, formation_code, is_official, visibility')
    .maybeSingle();
  if (error) return { ok: false, error: mapLineupPgErr(error.message, error.code) };
  if (!created) return { ok: false, error: 'generic' };

  const lineup: CreatedLineup = {
    id: created.id as string,
    name: created.name as string,
    formationCode: created.formation_code as string,
    isOfficial: created.is_official as boolean,
    visibility: created.visibility as 'staff' | 'team',
  };

  const seeded = await calledUpForSeeding(supabase, {
    id: ev.id,
    team_id: ev.team_id,
    starts_at: ev.starts_at,
    tournament_id: ev.tournament_id,
  });
  let seedError: LineupWriteError | null = null;
  if (seeded.length > 0) {
    const { error: posErr } = await supabase.from('lineup_positions').insert(
      seeded.map((pid) => ({
        lineup_id: lineup.id,
        player_id: pid,
        location: 'bench' as const,
      })),
    );
    if (posErr) seedError = mapLineupPgErr(posErr.message, posErr.code);
  }

  return { ok: true, lineup, seeded, seedError };
}
