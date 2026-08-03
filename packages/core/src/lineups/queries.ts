/**
 * O2-8a — Lectura de la ALINEACIÓN de un partido (staff), framework-agnóstica y
 * READ-ONLY. Pensada para la app nativa (pintar la alineación actual: titulares en
 * sus slots + banquillo), reutilizando el modelo de core (`getFormation`,
 * `coachFormationToFormation`, `PositionAssignment`) igual que D2 reutilizó
 * `diagram/*` + `PlayField`.
 *
 * A DIFERENCIA de `apps/web/.../alineacion/queries.ts::loadLineupEditor`, esta función
 * NO tiene efectos: no auto-crea el borrador "Plan A" ni firma fotos. Por eso NO se
 * comparte con la web (una lectura cacheable/offline no puede escribir). El gate de
 * LECTURA es la RLS (staff del equipo ve `lineups`/`lineup_positions`); `canManage`
 * se devuelve para el gate de EDICIÓN de 8b, pero la lectura NO se gatea con él.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { isManageableMatchType } from '../events/types';
import { callupEventIdFor } from '../events/aggregation';
import { getFormation } from './formations';
import type { PositionAssignment, LineupLocation, TeamFormat } from './types';
import type { CoachFormation, CoachFormationPosition } from './coach-formations';
import type { PlayerPositionMain } from './geometry';

type DbClient = SupabaseClient<Database>;

/** Jugador del roster (para nombres/dorsales de las fichas y el banquillo). */
export type LineupRosterPlayer = {
  playerId: string;
  firstName: string;
  lastName: string;
  dorsal: number | null;
  positionMain: PlayerPositionMain;
  isPromoted: boolean;
};

export type LineupView = {
  event: {
    id: string;
    teamId: string;
    title: string;
    opponentName: string | null;
    startsAt: string;
    teamName: string;
    teamColor: string;
    categoryName: string;
    format: TeamFormat;
  };
  /** Alineación seleccionada (oficial → primera). null si aún no hay ninguna. */
  lineupId: string | null;
  lineupName: string | null;
  isOfficial: boolean;
  /** Nº de alineaciones del evento (Plan A/B…). */
  lineupCount: number;
  formationCode: string | null;
  /** Si `formationCode` es una plantilla del coach (uuid), su definición para
   * resolver los slots (getFormation solo conoce el catálogo). null si es catálogo. */
  coachFormation: CoachFormation | null;
  positions: PositionAssignment[];
  roster: LineupRosterPlayer[];
  /** Autoridad de EDICIÓN (helper SQL user_can_manage_lineup) — para 8b. La
   * LECTURA no se gatea con esto (el candado es la RLS). */
  canManage: boolean;
};

export async function getLineupForEventFromClient(
  supabase: DbClient,
  params: { clubId: string; eventId: string; preferredLineupId?: string | null },
): Promise<LineupView | null> {
  const { clubId, eventId } = params;
  const preferredLineupId = params.preferredLineupId ?? null;

  const { data: ev } = await supabase
    .from('events')
    .select(
      `id, club_id, team_id, type, tournament_id, title, opponent_name, starts_at,
       teams!inner(name, color, format, season, categories!inner(name))`,
    )
    .eq('id', eventId)
    .maybeSingle();
  if (!ev) return null;
  if ((ev.club_id as string) !== clubId) return null;
  if (!isManageableMatchType(ev.type as string) || ev.team_id == null) return null;

  type EventShape = {
    id: string;
    team_id: string;
    tournament_id: string | null;
    title: string;
    opponent_name: string | null;
    starts_at: string;
    teams: {
      name: string;
      color: string;
      format: TeamFormat;
      categories: { name: string };
    };
  };
  const event = ev as unknown as EventShape;

  // Autoridad de edición (para 8b). NO gatea la lectura.
  const { data: canManageRaw } = await supabase.rpc('user_can_manage_lineup', {
    p_event_id: eventId,
  });
  const canManage = canManageRaw === true;

  // Descartados (nivel evento; cabecera si es partido de torneo) para no pintar
  // una fila de posición huérfana de un descartado (defensa, como la web).
  const callupEventId = callupEventIdFor(event);
  const { data: decisionRows } = await supabase
    .from('callup_decisions')
    .select('player_id, decision')
    .eq('event_id', callupEventId);
  const discardedSet = new Set(
    (decisionRows ?? [])
      .filter((d) => (d.decision as string) === 'discarded')
      .map((d) => d.player_id as string),
  );

  // Alineaciones del evento (oficial primero). READ-ONLY: no auto-crea nada.
  const { data: lineupRows } = await supabase
    .from('lineups')
    .select('id, name, formation_code, is_official, created_at')
    .eq('event_id', eventId)
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: true });
  type LineupShape = {
    id: string;
    name: string;
    formation_code: string;
    is_official: boolean;
  };
  const lineups = (lineupRows ?? []).map((l) => l as unknown as LineupShape);

  const selected =
    lineups.find((l) => l.id === preferredLineupId) ??
    lineups.find((l) => l.is_official) ??
    lineups[0] ??
    null;

  let positions: PositionAssignment[] = [];
  if (selected) {
    const { data: posRows } = await supabase
      .from('lineup_positions')
      .select('player_id, location, position_code, x_pct, y_pct')
      .eq('lineup_id', selected.id);
    type PosShape = {
      player_id: string;
      location: LineupLocation;
      position_code: string | null;
      x_pct: number | string | null;
      y_pct: number | string | null;
    };
    positions = (posRows ?? [])
      .map((p) => p as unknown as PosShape)
      .filter((p) => !discardedSet.has(p.player_id))
      .map((p) => ({
        playerId: p.player_id,
        location: p.location,
        positionCode: p.position_code,
        xPct: p.x_pct == null ? null : Number(p.x_pct),
        yPct: p.y_pct == null ? null : Number(p.y_pct),
      }));
  }

  // Roster a la fecha (nombres/dorsales) + subidos. Sin firmar fotos (8a pinta
  // dorsal/nombre; el chip con foto puede venir después).
  const eventDate = event.starts_at.slice(0, 10);
  const { data: rosterRows } = await supabase
    .from('team_members')
    .select(
      'player_id, joined_at, left_at, players!inner(id, first_name, last_name, dorsal, position_main)',
    )
    .eq('team_id', event.team_id)
    .lte('joined_at', eventDate);
  type RosterShape = {
    player_id: string;
    joined_at: string;
    left_at: string | null;
    players: {
      id: string;
      first_name: string;
      last_name: string | null;
      dorsal: number | null;
      position_main: PlayerPositionMain;
    };
  };
  const rosterBase: LineupRosterPlayer[] = (rosterRows ?? [])
    .map((r) => r as unknown as RosterShape)
    .filter((r) => r.left_at == null || r.left_at >= eventDate)
    .map((r) => ({
      playerId: r.player_id,
      firstName: r.players.first_name,
      lastName: r.players.last_name ?? '',
      dorsal: r.players.dorsal,
      positionMain: r.players.position_main,
      isPromoted: false,
    }));

  const { data: promoRows } = await supabase
    .from('player_promotions')
    .select(
      'player_id, players!inner(id, first_name, last_name, dorsal, position_main)',
    )
    .eq('event_id', event.id);
  type PromoShape = {
    player_id: string;
    players: {
      id: string;
      first_name: string;
      last_name: string | null;
      dorsal: number | null;
      position_main: PlayerPositionMain;
    };
  };
  const rosterPromoted: LineupRosterPlayer[] = (promoRows ?? [])
    .map((r) => r as unknown as PromoShape)
    .filter((r) => !rosterBase.some((rb) => rb.playerId === r.player_id))
    .map((r) => ({
      playerId: r.player_id,
      firstName: r.players.first_name,
      lastName: r.players.last_name ?? '',
      dorsal: r.players.dorsal,
      positionMain: r.players.position_main,
      isPromoted: true,
    }));
  const roster = [...rosterBase, ...rosterPromoted];

  // Si la formación seleccionada NO es del catálogo, es una plantilla del coach
  // (uuid): traer su definición para resolver los slots en cliente (igual que la
  // web). El guard con getFormation evita consultar coach_formations.id (uuid) con
  // un code de catálogo ('4-3-3').
  let coachFormation: CoachFormation | null = null;
  const formationCode = selected?.formation_code ?? null;
  if (formationCode && !getFormation(formationCode)) {
    const { data: cfRow } = await supabase
      .from('coach_formations')
      .select('id, name, format, positions')
      .eq('id', formationCode)
      .maybeSingle();
    if (cfRow) {
      coachFormation = {
        id: cfRow.id as string,
        name: cfRow.name as string,
        format: cfRow.format as TeamFormat,
        positions: (cfRow.positions as unknown as CoachFormationPosition[]) ?? [],
      };
    }
  }

  return {
    event: {
      id: event.id,
      teamId: event.team_id,
      title: event.title,
      opponentName: event.opponent_name,
      startsAt: event.starts_at,
      teamName: event.teams.name,
      teamColor: event.teams.color,
      categoryName: event.teams.categories.name,
      format: event.teams.format,
    },
    lineupId: selected?.id ?? null,
    lineupName: selected?.name ?? null,
    isOfficial: selected?.is_official ?? false,
    lineupCount: lineups.length,
    formationCode,
    coachFormation,
    positions,
    roster,
    canManage,
  };
}
