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

/** Visibilidad de una alineación: solo staff o compartida con el equipo/familias. */
export type LineupVisibility = 'staff' | 'team';

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
  /** Compartida con el equipo ('team') o solo staff ('staff'). El interruptor
   * "Compartir con equipo" del editor la conmuta; junto con `isOfficial` decide
   * si el jugador/familia la ve (RLS: is_official AND visibility='team'). */
  visibility: LineupVisibility;
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
    .select('id, name, formation_code, is_official, visibility, created_at')
    .eq('event_id', eventId)
    .order('is_official', { ascending: false })
    .order('created_at', { ascending: true });
  type LineupShape = {
    id: string;
    name: string;
    formation_code: string;
    is_official: boolean;
    visibility: LineupVisibility;
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
    visibility: selected?.visibility ?? 'staff',
    lineupCount: lineups.length,
    formationCode,
    coachFormation,
    positions,
    roster,
    canManage,
  };
}

/** Jugador de la alineación compartida (nombre/dorsal para las fichas y banquillo). */
export type SharedLineupPlayer = {
  playerId: string;
  label: string;
  dorsal: number | null;
};

export type SharedLineupView = {
  lineupId: string;
  formationCode: string | null;
  /** Si `formationCode` es una plantilla del coach (uuid), su definición para
   * resolver los slots (getFormation solo conoce el catálogo). null si es catálogo. */
  coachFormation: CoachFormation | null;
  /** Titulares (location='field') + banquillo (location='bench'). */
  positions: PositionAssignment[];
  players: SharedLineupPlayer[];
};

/**
 * O2 — Lectura de la ALINEACIÓN OFICIAL COMPARTIDA para el JUGADOR/FAMILIA
 * (READ-ONLY, estática). Equivalente nativo del query de la web
 * `apps/web/.../match/shared-lineup-section.tsx`: solo la alineación oficial, con
 * titulares (campo) + banquillo. El GATE es la RLS (`lineups_select` /
 * `lineup_positions_select`): el jugador/familia solo recibe la fila si es
 * `is_official = true AND visibility = 'team'`. Por eso aquí basta con filtrar
 * `is_official = true`: si no está compartida, la RLS la oculta y devolvemos null.
 *
 * Las notas tácticas NUNCA se piden (tabla `lineup_tactical_notes`, solo-staff). El
 * viewer es un MIEMBRO (familia vía player_accounts), que sí lee `players` por RLS
 * (a diferencia del seguidor club-wide del directo, que va por `players_sporting`).
 */
export async function getSharedLineupForEventFromClient(
  supabase: DbClient,
  eventId: string,
): Promise<SharedLineupView | null> {
  const { data: lu } = await supabase
    .from('lineups')
    .select('id, formation_code')
    .eq('event_id', eventId)
    .eq('is_official', true)
    .maybeSingle();
  if (!lu) return null;

  const lineupId = lu.id as string;
  let formationCode: string | null = (lu.formation_code as string | null) ?? null;

  const { data: posRows } = await supabase
    .from('lineup_positions')
    .select(
      'player_id, location, position_code, x_pct, y_pct, players!inner(first_name, last_name, dorsal)',
    )
    .eq('lineup_id', lineupId);
  type PosShape = {
    player_id: string;
    location: LineupLocation;
    position_code: string | null;
    x_pct: number | string | null;
    y_pct: number | string | null;
    players: { first_name: string; last_name: string | null; dorsal: number | null } | null;
  };
  const posArr = (posRows ?? []).map((p) => p as unknown as PosShape);

  const positions: PositionAssignment[] = posArr.map((p) => ({
    playerId: p.player_id,
    location: p.location,
    positionCode: p.position_code,
    xPct: p.x_pct == null ? null : Number(p.x_pct),
    yPct: p.y_pct == null ? null : Number(p.y_pct),
  }));

  // Etiqueta = apellido || nombre (idéntico a la web y al campo del directo).
  const players: SharedLineupPlayer[] = posArr.map((p) => ({
    playerId: p.player_id,
    label:
      p.players?.last_name || p.players?.first_name || p.player_id.slice(0, 4),
    dorsal: p.players?.dorsal ?? null,
  }));

  // Formación del coach (uuid) → su definición para resolver slots en cliente.
  let coachFormation: CoachFormation | null = null;
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
    } else {
      formationCode = null;
    }
  }

  return { lineupId, formationCode, coachFormation, positions, players };
}
