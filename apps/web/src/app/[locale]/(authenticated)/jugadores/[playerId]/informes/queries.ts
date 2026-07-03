/**
 * F13.10b-1 — Lecturas del editor de Informes de desarrollo (zona staff).
 *
 * El informe se ata a season_id (FK seasons) y al equipo del jugador EN esa
 * temporada (team_members → teams.season = label). El selector de temporada usa
 * la tabla canónica `seasons`; el team_id se resuelve por la pertenencia del
 * jugador en esa temporada.
 */

import {
  createSupabaseServerClient,
  sumMatchStats,
  derivedRatios,
  attendanceBreakdown,
  computeGroupAverages,
  callupRatioForPlayer,
  DEVELOPMENT_PERIODS,
  DEVELOPMENT_REPORT_CATALOG,
  TEAM_REPORT_CATALOG,
  type MatchStatRow,
  type AttendanceRow,
} from '@misterfc/core';

type Supa = ReturnType<typeof createSupabaseServerClient>;

export type ClubSeason = { id: string; label: string; status: string };

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

/** Subconjunto de stats ya disponibles en player-profile, para la cabecera. */
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

export type FichaStats = {
  matches: number;
  minutes: number;
  goals: number;
  assists: number;
  yellow: number;
  red: number;
  startRate: number | null;
  attendancePresentPct: number | null;
  attendanceTotal: number;
  /** F13.10h-4 — ratios del equipo en la temporada (numerador/denominador). */
  calledUp: number; // partidos OFICIALES jugados (pertenecía) en los que fue convocado (canónico: roster − descartados)
  totalMatches: number; // partidos OFICIALES ya jugados en los que el jugador pertenecía al equipo
  trainingsAttended: number; // entrenos a los que asistió (bucket 'present')
  totalTrainings: number; // total de entrenos del equipo en la temporada
  /** D3 — subidas a equipos superiores (seguimiento). Vacío si no hay. */
  promotions: FichaPromotions;
};

/**
 * Stats de la temporada (por team.season label), reusando los agregadores de core.
 *
 * F13.10h-4 — añade los ratios de convocatorias y asistencia: los NUMERADORES
 * salen de datos del jugador (callup_decisions / training_attendance bucket
 * present); los DENOMINADORES son el total de eventos del EQUIPO en la temporada,
 * contados sobre la tabla `events` (sin tabla nueva ni migración). RLS: `events` y
 * `callup_decisions` son legibles por cualquier miembro del club (incluida la
 * familia), así que los ratios se computan igual en staff y familia.
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
      'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, teams!inner(season)',
    )
    .eq('player_id', playerId)
    .eq('teams.season', seasonLabel);
  const agg = sumMatchStats((statRows ?? []) as unknown as MatchStatRow[]);
  const ratios = derivedRatios(agg);

  const { data: attRows } = await supabase
    .from('training_attendance')
    .select('code, events!inner(type, teams!inner(season))')
    .eq('player_id', playerId)
    .eq('events.type', 'training')
    .eq('events.teams.season', seasonLabel);
  const att = attendanceBreakdown((attRows ?? []) as unknown as AttendanceRow[]);

  // Ratio de convocatorias (X/Y) + denominador de entrenos. Solo si conocemos el
  // equipo de la temporada.
  //
  // Fix ratio canónico: el numerador ya NO cuenta filas `called_up` explícitas
  // (infravaloraba al banquillo: sin fila = convocado). Ahora numerador y
  // denominador comparten el MISMO universo y criterio de pertenencia, así que
  // nunca X>Y. Decisiones de producto cerradas:
  //  (i)   universo = partidos YA JUGADOS (starts_at <= now); futuros NO cuentan.
  //  (ii)  solo OFICIALES: type='match' AND tournament_id IS NULL (excluye
  //        amistosos y torneos → su desglose es F9B).
  //  (iii) el jugador cuenta en un partido solo si pertenecía al equipo a esa
  //        fecha (team_members joined/left). El cálculo canónico lo hace
  //        `callupRatioForPlayer` en memoria (reusa groupRosterByCallup).
  let calledUp = 0;
  let totalMatches = 0;
  let totalTrainings = 0;
  if (teamId) {
    const nowIso = new Date().toISOString();
    const [officialRes, trainingsRes, membershipRes, discardedRes] =
      await Promise.all([
        // Universo (denominador): partidos oficiales YA JUGADOS del equipo.
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
          .eq('type', 'training'),
        // Pertenencia histórica del jugador a ESTE equipo (puede tener varias filas).
        supabase
          .from('team_members')
          .select('joined_at, left_at')
          .eq('player_id', playerId)
          .eq('team_id', teamId),
        // Descartes del jugador en ESE universo (oficiales ya jugados del equipo).
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

  // D3 — subidas del jugador a equipos SUPERIORES en la temporada (player_promotions
  // → events → teams filtrado por season). RLS de D1: la familia ve las de su
  // jugador (siempre), el staff base/superior y admin/coord también.
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
    matches: agg.matches,
    minutes: agg.minutesPlayed,
    goals: agg.goals,
    assists: agg.assists,
    yellow: agg.yellowCards,
    red: agg.redCards,
    startRate: ratios.startRate,
    attendancePresentPct: att.presentPct,
    attendanceTotal: att.total,
    calledUp,
    totalMatches,
    trainingsAttended: att.perBucket.present,
    totalTrainings,
    promotions,
  };
}

/** Bloque de stats de partido (para segregar oficial/amistoso en el PDF, PDF-3). */
export type PdfMatchStats = {
  matches: number;
  minutes: number;
  goals: number;
  assists: number;
  cards: number;
};
export type PdfMatchStatsSplit = { oficial: PdfMatchStats; amistoso: PdfMatchStats };

const toPdfMatchStats = (rows: MatchStatRow[]): PdfMatchStats => {
  const a = sumMatchStats(rows);
  return {
    matches: a.matches,
    minutes: a.minutesPlayed,
    goals: a.goals,
    assists: a.assists,
    cards: a.yellowCards + a.redCards,
  };
};

/**
 * F13.10h-PDF-3 — Stats de partido del jugador SEGREGADAS por tipo de evento
 * (D-PDF-1): Oficial = events.type ∈ ('match','tournament'); Amistoso =
 * ('friendly'); se ignoran training/other. NO distingue liga/copa (eso es F13B):
 * solo parte por events.type. Solo para el PDF; la ficha usa loadFichaStats.
 */
export async function loadFichaMatchStatsByType(
  supabase: Supa,
  playerId: string,
  seasonLabel: string,
): Promise<PdfMatchStatsSplit> {
  const { data } = await supabase
    .from('match_player_stats')
    .select(
      'started, minutes_played, goals, assists, yellow_cards, red_cards, shots, fouls_committed, fouls_received, penalties_scored, penalties_missed, events!inner(type), teams!inner(season)',
    )
    .eq('player_id', playerId)
    .eq('teams.season', seasonLabel);

  const rows = (data ?? []) as unknown as Array<MatchStatRow & { events: { type: string } }>;
  const oficial = rows.filter((r) => r.events?.type === 'match' || r.events?.type === 'tournament');
  const amistoso = rows.filter((r) => r.events?.type === 'friendly');
  return { oficial: toPdfMatchStats(oficial), amistoso: toPdfMatchStats(amistoso) };
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

/**
 * F13.10h-3 — Evolución del EQUIPO: medias de los 3 grupos del TEAM_REPORT_CATALOG
 * a lo largo de los periodos, leyendo las team_development_reports del
 * equipo×temporada. Mismo patrón que loadPlayerEvolution (progresión contra uno
 * mismo, no comparativa entre equipos). La RLS decide qué periodos ve cada rol:
 * staff/coord ven todos; la familia, solo aquellos cuya valoración de equipo está
 * expuesta vía informe del hijo publicado (user_can_see_team_report_via_published).
 */
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
