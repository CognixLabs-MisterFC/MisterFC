/**
 * F13.10b-1 — Lecturas del INFORME DE DESARROLLO. O2-5 C1: extraído verbatim de
 * `apps/web/.../jugadores/[playerId]/informes/queries.ts` (las funciones ya tomaban
 * el `SupabaseClient`, así que eran `getXFromClient` de facto). apps/web re-exporta
 * estas funciones (staff + /mi-informe sin cambios); la app nativa las consume
 * directamente. Reutiliza el cálculo puro de core; solo el fetch se movió.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { derivedRatios, attendanceBreakdown, type AttendanceRow } from '../player-profile/derived';
import {
  splitMatchStatsByType,
  type MatchStatsByType,
  type MatchStatRowTyped,
} from '../player-profile/by-type';
import type { AggregatedStats, MatchStatRow } from '../player-profile/aggregate';
import { callupRatioForPlayer } from '../lineups/callup-sync';
import {
  computeGroupAverages,
  DEVELOPMENT_PERIODS,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  reportStatus,
} from './development-report';
import { formatPlayerName } from '../utils/name';

type Supa = SupabaseClient<Database>;

export type ClubSeason = { id: string; label: string; status: string };

/** 19-B — Estado del informe de un jugador del equipo en un periodo (SOLO estado). */
export type TeamReportPlayerStatus = {
  playerId: string;
  name: string;
  completed: boolean;
};

/**
 * 19-B — Estado POR JUGADOR del informe de desarrollo de un equipo en un periodo: el
 * roster activo (`team_members` con `left_at` null) con si su informe está COMPLETADO,
 * usando el MISMO criterio que el nivel-1 D2-2 (`reportStatus === 'completed'`, todos
 * los ítems del catálogo puntuados). Así el recuento cuadra: nº de `completed=true` ==
 * el `done` de `listTeamsReportProgressFromClient`, y el total == el tamaño del roster.
 *
 * Solo estado (no trae scores ni abre nada). NO atado al scope de dirección: recibe
 * `teamId` + `period` y nada de team_staff/membership → lo reutiliza el entrenador (19-C).
 * Un `team_id` vive en una sola temporada, así que filtrar por team_id+period basta (no
 * hace falta season_id). RLS: `development_reports_select` da lectura a admin/director
 * club-wide y a `user_is_team_staff` del equipo.
 */
export async function listTeamReportPlayerStatusFromClient(
  supabase: Supa,
  teamId: string,
  period: string,
): Promise<TeamReportPlayerStatus[]> {
  // Roster activo con nombre (mismo origen que la web F13.10: team_members × players).
  const { data: rosterData } = await supabase
    .from('team_members')
    .select('players!inner(id, first_name, last_name)')
    .eq('team_id', teamId)
    .is('left_at', null);
  const roster = ((rosterData ?? []) as unknown as Array<{
    players: { id: string; first_name: string; last_name: string | null };
  }>).map((r) => ({
    playerId: r.players.id,
    name: formatPlayerName(r.players.first_name, r.players.last_name),
  }));

  // Informes del equipo en el periodo → set de jugadores con informe COMPLETO.
  const { data: reportData } = await supabase
    .from('development_reports')
    .select('player_id, scores')
    .eq('team_id', teamId)
    .eq('period', period);
  const completed = new Set<string>();
  for (const r of (reportData ?? []) as Array<{
    player_id: string;
    scores: Record<string, number>;
  }>) {
    if (reportStatus(r.scores ?? {}, DEVELOPMENT_REPORT_CATALOG) === 'completed') {
      completed.add(r.player_id);
    }
  }

  return roster
    .map((p) => ({ ...p, completed: completed.has(p.playerId) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

/**
 * 19-C — Periodo de la campaña de evaluación LANZADA del club en su temporada activa, o
 * `null` si no hay ninguna. Con 19-A (índice único parcial `one_launched_per_season`) hay
 * como mucho UNA campaña `launched` por temporada → un solo periodo. La usa el entrenador
 * para saber de qué campaña se trata (y mostrar "no hay campaña" si no la hay). RLS:
 * `seasons` y `assessment_campaigns_select` son legibles por cualquier rol del club.
 */
export async function getLaunchedCampaignPeriodFromClient(
  supabase: Supa,
  clubId: string,
): Promise<string | null> {
  const { data: season } = await supabase
    .from('seasons')
    .select('id')
    .eq('club_id', clubId)
    .eq('status', 'active')
    .order('label', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!season) return null;
  const { data: campaign } = await supabase
    .from('assessment_campaigns')
    .select('period')
    .eq('season_id', season.id as string)
    .eq('status', 'launched')
    .limit(1)
    .maybeSingle();
  return (campaign?.period as string | undefined) ?? null;
}

export type DevelopmentReportRow = {
  id: string;
  period: string;
  visibility: string;
  scores: Record<string, number>;
  comment_overall: string | null;
};

/** Informe individual de un jugador en un periodo concreto (para el editor). */
export type IndividualReport = {
  id: string;
  scores: Record<string, number>;
  comment_overall: string | null;
  visibility: string;
  team_report_id: string | null;
};

/** Valoración de equipo de un periodo concreto (para el editor / bloque fijo). */
export type TeamReport = {
  id: string;
  scores: Record<string, number>;
  comment: string | null;
  visibility: string;
};

/** Temporadas del club (tabla canónica), más recientes primero. */
export async function loadClubSeasons(supabase: Supa, clubId: string): Promise<ClubSeason[]> {
  const { data } = await supabase
    .from('seasons')
    .select('id, label, status')
    .eq('club_id', clubId);
  return ((data ?? []) as ClubSeason[]).sort((a, b) => b.label.localeCompare(a.label));
}

/** Equipo del jugador EN una temporada (por teams.season = label). Prefiere la
 *  pertenencia activa (left_at null); si no, la más reciente de esa temporada. */
export async function resolvePlayerTeamForSeason(
  supabase: Supa,
  playerId: string,
  seasonLabel: string,
): Promise<{ teamId: string; teamName: string } | null> {
  const { data } = await supabase
    .from('team_members')
    .select('team_id, left_at, joined_at, teams!inner(name, season)')
    .eq('player_id', playerId)
    .eq('teams.season', seasonLabel)
    .order('joined_at', { ascending: false });
  const rows = (data ?? []) as Array<{
    team_id: string;
    left_at: string | null;
    teams: { name: string; season: string } | null;
  }>;
  if (rows.length === 0) return null;
  const active = rows.find((r) => r.left_at === null) ?? rows[0]!;
  return { teamId: active.team_id, teamName: active.teams?.name ?? '' };
}

export type ObjectiveRow = {
  id: string;
  title: string;
  description: string | null;
  review_comment: string | null;
  status: string;
  created_period?: string;
};

/** Objetivos INDIVIDUALES del jugador en una temporada. */
export async function loadPlayerObjectives(
  supabase: Supa,
  playerId: string,
  seasonId: string,
): Promise<ObjectiveRow[]> {
  const { data } = await supabase
    .from('player_objectives')
    .select('id, title, description, review_comment, status, created_period')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ObjectiveRow[];
}

/** Objetivos GRUPALES del equipo en una temporada (compartidos por el equipo). */
export async function loadTeamObjectives(
  supabase: Supa,
  teamId: string,
  seasonId: string,
): Promise<ObjectiveRow[]> {
  const { data } = await supabase
    .from('team_objectives')
    .select('id, title, description, review_comment, status, created_period')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .order('created_at', { ascending: true });
  return (data ?? []) as ObjectiveRow[];
}

/** Informe individual de un jugador en un periodo (para el editor). */
export async function loadIndividualReport(
  supabase: Supa,
  playerId: string,
  seasonId: string,
  period: string,
): Promise<IndividualReport | null> {
  const { data } = await supabase
    .from('development_reports')
    .select('id, scores, comment_overall, visibility, team_report_id')
    .eq('player_id', playerId)
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  return (data as unknown as IndividualReport | null) ?? null;
}

/** Valoración de equipo de un periodo (para el editor de equipo y el bloque fijo). */
export async function loadTeamReport(
  supabase: Supa,
  teamId: string,
  seasonId: string,
  period: string,
): Promise<TeamReport | null> {
  const { data } = await supabase
    .from('team_development_reports')
    .select('id, scores, comment, visibility')
    .eq('team_id', teamId)
    .eq('season_id', seasonId)
    .eq('period', period)
    .maybeSingle();
  return (data as unknown as TeamReport | null) ?? null;
}

/** Informes del jugador en una temporada, indexados por periodo. */
export async function loadReportsByPeriod(
  supabase: Supa,
  playerId: string,
  seasonId: string,
): Promise<Map<string, DevelopmentReportRow>> {
  const { data } = await supabase
    .from('development_reports')
    .select('id, period, visibility, scores, comment_overall')
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
  const map = new Map<string, DevelopmentReportRow>();
  for (const r of (data ?? []) as unknown as DevelopmentReportRow[]) map.set(r.period, r);
  return map;
}

// ── Ficha (F13.10 rediseño): stats agregadas de temporada + evolución ───────────

/** D3 — una subida concreta (detalle de la lista de promociones). */
export type FichaPromotionItem = {
  eventId: string;
  startsAt: string;
  kind: 'train' | 'match';
  teamName: string;
};

/** D3 — agregado por equipo superior (para el highlight legible). */
export type FichaPromotionGroup = {
  teamName: string;
  train: number;
  match: number;
};

/** D3 — seguimiento de subidas a equipos superiores en la temporada. */
export type FichaPromotions = {
  trainCount: number;
  matchCount: number;
  byTeam: FichaPromotionGroup[];
  items: FichaPromotionItem[];
};

/**
 * F9B — una línea de métricas de partido (por columna: Total/Oficial/Amistoso/
 * Torneo). `startRate` es derivada (titularidades/partidos de esa columna).
 */
export type FichaMatchLine = {
  matches: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  startRate: number | null;
};

export type FichaMatchStatsByType = {
  total: FichaMatchLine;
  oficial: FichaMatchLine;
  amistoso: FichaMatchLine;
  torneo: FichaMatchLine;
};

export type FichaStats = {
  matchStats: FichaMatchStatsByType;
  attendancePresentPct: number | null;
  attendanceTotal: number;
  calledUp: number;
  totalMatches: number;
  trainingsAttended: number;
  totalTrainings: number;
  promotions: FichaPromotions;
};

/** F9B — `AggregatedStats` (core) → línea de la ficha (con `startRate` derivada). */
function toFichaMatchLine(a: AggregatedStats): FichaMatchLine {
  return {
    matches: a.matches,
    minutes: a.minutesPlayed,
    goals: a.goals,
    assists: a.assists,
    yellow: a.yellowCards,
    red: a.redCards,
    startRate: derivedRatios(a).startRate,
  };
}

/** F9B — el desglose de core (4× `AggregatedStats`) → shape de la ficha. */
function toFichaMatchStats(s: MatchStatsByType): FichaMatchStatsByType {
  return {
    total: toFichaMatchLine(s.total),
    oficial: toFichaMatchLine(s.oficial),
    amistoso: toFichaMatchLine(s.amistoso),
    torneo: toFichaMatchLine(s.torneo),
  };
}

/**
 * Stats de la temporada (por team.season label), reusando los agregadores de core.
 */
export async function loadFichaStats(
  supabase: Supa,
  playerId: string,
  seasonLabel: string,
  teamId: string | null,
): Promise<FichaStats> {
  const { data: statRows } = await supabase
    .from('match_player_stats')
    .select(
      'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, events!inner(type, tournament_id), teams!inner(season)',
    )
    .eq('player_id', playerId)
    .eq('teams.season', seasonLabel);
  type StatRowRaw = MatchStatRow & {
    events: { type: string; tournament_id: string | null };
  };
  const typedRows: MatchStatRowTyped[] = (
    (statRows ?? []) as unknown as StatRowRaw[]
  ).map((r) => ({
    ...r,
    eventType: r.events?.type ?? '',
    tournamentId: r.events?.tournament_id ?? null,
  }));
  const matchStats = toFichaMatchStats(splitMatchStatsByType(typedRows));

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('code, events!inner(type, teams!inner(season))')
    .eq('player_id', playerId)
    .eq('events.type', 'training')
    .is('events.cancelled_at', null)
    .eq('events.teams.season', seasonLabel);
  const att = attendanceBreakdown((attRows ?? []) as unknown as AttendanceRow[]);

  let calledUp = 0;
  let totalMatches = 0;
  let totalTrainings = 0;
  if (teamId) {
    const nowIso = new Date().toISOString();
    const [officialRes, trainingsRes, membershipRes, discardedRes] =
      await Promise.all([
        supabase
          .from('events')
          .select('id, starts_at')
          .eq('team_id', teamId)
          .eq('type', 'match')
          .is('tournament_id', null)
          .lte('starts_at', nowIso),
        supabase
          .from('events')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', teamId)
          .eq('type', 'training')
          .is('cancelled_at', null)
          .or('approval_status.is.null,approval_status.eq.approved'),
        supabase
          .from('team_members')
          .select('joined_at, left_at')
          .eq('player_id', playerId)
          .eq('team_id', teamId),
        supabase
          .from('callup_decisions')
          .select('event_id, events!inner(team_id, type, tournament_id, starts_at)')
          .eq('player_id', playerId)
          .eq('decision', 'discarded')
          .eq('events.team_id', teamId)
          .eq('events.type', 'match')
          .is('events.tournament_id', null)
          .lte('events.starts_at', nowIso),
      ]);

    totalTrainings = trainingsRes.count ?? 0;

    type EvRow = { id: string; starts_at: string };
    type TmRow = { joined_at: string; left_at: string | null };
    type DecRow = { event_id: string };
    const discardedEventIds = new Set(
      ((discardedRes.data ?? []) as unknown as DecRow[]).map((d) => d.event_id),
    );
    const ratio = callupRatioForPlayer({
      events: (officialRes.data ?? []) as unknown as EvRow[],
      memberships: (membershipRes.data ?? []) as unknown as TmRow[],
      discardedEventIds,
    });
    calledUp = ratio.calledUp;
    totalMatches = ratio.totalMatches;
  }

  const { data: promoRows } = await supabase
    .from('player_promotions')
    .select('event_id, kind, events!inner(starts_at, teams!inner(name, season))')
    .eq('player_id', playerId)
    .eq('events.teams.season', seasonLabel);
  type PromoRow = {
    event_id: string;
    kind: string;
    events: { starts_at: string; teams: { name: string } };
  };
  const promoItems: FichaPromotionItem[] = ((promoRows ?? []) as unknown as PromoRow[])
    .map((r) => ({
      eventId: r.event_id,
      startsAt: r.events.starts_at,
      kind: (r.kind === 'train' ? 'train' : 'match') as 'train' | 'match',
      teamName: r.events.teams.name,
    }))
    .sort((a, b) => (a.startsAt < b.startsAt ? 1 : a.startsAt > b.startsAt ? -1 : 0));

  const byTeamMap = new Map<string, FichaPromotionGroup>();
  for (const it of promoItems) {
    const g = byTeamMap.get(it.teamName) ?? { teamName: it.teamName, train: 0, match: 0 };
    if (it.kind === 'train') g.train += 1;
    else g.match += 1;
    byTeamMap.set(it.teamName, g);
  }
  const promotions: FichaPromotions = {
    trainCount: promoItems.filter((i) => i.kind === 'train').length,
    matchCount: promoItems.filter((i) => i.kind === 'match').length,
    byTeam: Array.from(byTeamMap.values()).sort((a, b) =>
      a.teamName.localeCompare(b.teamName, 'es', { sensitivity: 'base' }),
    ),
    items: promoItems,
  };

  return {
    matchStats,
    attendancePresentPct: att.presentPct,
    attendanceTotal: att.total,
    calledUp,
    totalMatches,
    trainingsAttended: att.perBucket.present,
    totalTrainings,
    promotions,
  };
}

/** Medias de grupo por periodo (los 4 periodos; null donde no hay informe). */
export type PeriodAverages = {
  period: string;
  tecnico: number | null;
  tactico: number | null;
  fisico: number | null;
  actitud: number | null;
};

/** Evolución INDIVIDUAL: medias de los 4 grupos del jugador en cada periodo. */
export async function loadPlayerEvolution(
  supabase: Supa,
  playerId: string,
  seasonId: string,
): Promise<PeriodAverages[]> {
  const { data } = await supabase
    .from('development_reports')
    .select('period, scores')
    .eq('player_id', playerId)
    .eq('season_id', seasonId);
  const byPeriod = new Map<string, Record<string, number>>();
  for (const r of (data ?? []) as Array<{ period: string; scores: Record<string, number> }>) {
    byPeriod.set(r.period, r.scores ?? {});
  }
  return DEVELOPMENT_PERIODS.map((p) => {
    const scores = byPeriod.get(p);
    if (!scores) return { period: p, tecnico: null, tactico: null, fisico: null, actitud: null };
    const { perGroup } = computeGroupAverages(DEVELOPMENT_REPORT_CATALOG, scores);
    return {
      period: p,
      tecnico: perGroup.tecnico ?? null,
      tactico: perGroup.tactico ?? null,
      fisico: perGroup.fisico ?? null,
      actitud: perGroup.actitud ?? null,
    };
  });
}

/** Medias de los 3 grupos del catálogo de EQUIPO por periodo (null si no hay). */
export type TeamPeriodAverages = {
  period: string;
  rendimiento_colectivo: number | null;
  dinamica_grupo: number | null;
  evolucion_equipo: number | null;
};

/** F13.10h-3 — Evolución del EQUIPO por periodo (progresión, no comparativa). */
export async function loadTeamEvolution(
  supabase: Supa,
  teamId: string,
  seasonId: string,
): Promise<TeamPeriodAverages[]> {
  const { data } = await supabase
    .from('team_development_reports')
    .select('period, scores')
    .eq('team_id', teamId)
    .eq('season_id', seasonId);
  const byPeriod = new Map<string, Record<string, number>>();
  for (const r of (data ?? []) as Array<{ period: string; scores: Record<string, number> }>) {
    byPeriod.set(r.period, r.scores ?? {});
  }
  return DEVELOPMENT_PERIODS.map((p) => {
    const scores = byPeriod.get(p);
    if (!scores) {
      return { period: p, rendimiento_colectivo: null, dinamica_grupo: null, evolucion_equipo: null };
    }
    const { perGroup } = computeGroupAverages(TEAM_REPORT_CATALOG, scores);
    return {
      period: p,
      rendimiento_colectivo: perGroup.rendimiento_colectivo ?? null,
      dinamica_grupo: perGroup.dinamica_grupo ?? null,
      evolucion_equipo: perGroup.evolucion_equipo ?? null,
    };
  });
}
