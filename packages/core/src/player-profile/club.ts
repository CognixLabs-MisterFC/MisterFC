/**
 * F10.0 — Agregación CLUB-WIDE para el dashboard ejecutivo (PURO, sin red ni
 * DOM). Spec [10.0](../../../../docs/specs/10.0-dashboard-ejecutivo.md).
 *
 * Estos helpers reciben las filas YA LEÍDAS por el loader de 10.1 (queries con
 * `IN (teamIds)`/`IN (eventIds)`, RLS heredada) y devuelven agregados. Aquí NO
 * hay acceso a BD ni lógica de RLS: solo se agrupa/cuenta/suma/deriva, así se
 * testea con Vitest sin Supabase. Se reutilizan los helpers existentes
 * (`attendanceBreakdown`) donde aplica; no se reinventa la matemática.
 *
 * Decisiones cerradas en la spec 10.0:
 *  - **DT1/DT2** — agregación por query directa + helpers puros (patrón D9-C de
 *    F9); el cálculo vive aquí, el loader solo lee y delega.
 *  - **D2** — un "resultado" solo cuenta si el partido tiene
 *    `match_state.status='closed'`; `goals_for`/`goals_against` `null` aun en
 *    closed se tratan como "cerrado sin marcador" (NO como 0) y se reportan
 *    aparte (`closedWithoutScore`) sin contaminar W-D-L ni GF/GA.
 *  - **D5** — los rankings son POR CATEGORÍA, no un único ranking global.
 *
 * Los umbrales de ALERTA (D3 baja asistencia, D4 inactivo) NO se aplican aquí:
 * son 10.5. 10.0 entrega los agregados crudos (p.ej. `presentPct` por jugador)
 * que 10.5 filtrará.
 */

import { attendanceBreakdown, type AttendanceRow, type AttendanceBreakdown } from './derived';
import { BADGE_THRESHOLDS } from './badges';

// ─────────────────────────────────────────────────────────────────────────────
// 1. aggregateClubStats — censo del club (total + distribución)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Un equipo de la temporada con su categoría. Lo aporta el loader desde `teams`
 * (+ `categories`). `categoryOrder` = `categories.order_idx` (para ordenar la
 * distribución como en el resto de la app); opcional.
 */
export interface ClubTeam {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  categoryOrder?: number | null;
}

/**
 * Una membresía jugador↔equipo de la temporada (de `team_members`, season-scoped
 * vía `teams.season`). El loader pasa el roster ACTIVO que quiera contar; el
 * helper no decide qué es "activo".
 */
export interface ClubMember {
  playerId: string;
  teamId: string;
}

/** Conteo de jugadores de una categoría (distinct dentro de la categoría). */
export interface CategoryCount {
  categoryId: string;
  categoryName: string;
  /** nº de equipos de la categoría en la temporada. */
  teamCount: number;
  /** nº de jugadores DISTINTOS en la categoría (un jugador en 2 equipos de la
   * misma categoría cuenta una vez). */
  playerCount: number;
}

/** Conteo de jugadores de un equipo. */
export interface TeamCount {
  teamId: string;
  teamName: string;
  categoryId: string;
  categoryName: string;
  /** nº de jugadores del equipo. */
  playerCount: number;
}

export interface ClubCensus {
  /** Jugadores DISTINTOS en todo el club en la temporada. */
  totalPlayers: number;
  /** Distribución por categoría, ordenada por (order_idx, nombre). */
  byCategory: CategoryCount[];
  /** Distribución por equipo, ordenada por (order_idx de su categoría, nombre
   * de categoría, nombre de equipo). */
  byTeam: TeamCount[];
}

/** Comparador estable es-ES sensitivity base para nombres. */
function byName(a: string, b: string): number {
  return a.localeCompare(b, 'es', { sensitivity: 'base' });
}

/**
 * Censo del club: total de jugadores distintos + distribución por categoría y
 * por equipo. Las membresías cuyo `teamId` no esté en `teams` se ignoran
 * (defensivo; no debería ocurrir si el loader lee ambos del mismo conjunto).
 *
 * Nota de no-aditividad (documentada): un jugador en varios equipos cuenta en
 * cada equipo, así que `Σ byTeam.playerCount ≥ totalPlayers`. Igual entre
 * categorías si está en dos categorías distintas. `totalPlayers` y cada
 * `playerCount` por categoría son DISTINCT, nunca dobles.
 */
export function aggregateClubStats(
  teams: readonly ClubTeam[],
  members: readonly ClubMember[],
): ClubCensus {
  const teamById = new Map<string, ClubTeam>();
  for (const t of teams) teamById.set(t.id, t);

  // playerIds por equipo y por categoría (Set = distinct), y global.
  const playersByTeam = new Map<string, Set<string>>();
  const playersByCategory = new Map<string, Set<string>>();
  const allPlayers = new Set<string>();

  for (const t of teams) {
    if (!playersByTeam.has(t.id)) playersByTeam.set(t.id, new Set());
    if (!playersByCategory.has(t.categoryId)) playersByCategory.set(t.categoryId, new Set());
  }

  for (const m of members) {
    const team = teamById.get(m.teamId);
    if (!team) continue; // membresía huérfana → ignorar
    playersByTeam.get(team.id)!.add(m.playerId);
    playersByCategory.get(team.categoryId)!.add(m.playerId);
    allPlayers.add(m.playerId);
  }

  // Categorías presentes (de los equipos), con su metadato.
  const categoryMeta = new Map<string, { name: string; order: number; teamCount: number }>();
  for (const t of teams) {
    const prev = categoryMeta.get(t.categoryId);
    if (prev) prev.teamCount += 1;
    else
      categoryMeta.set(t.categoryId, {
        name: t.categoryName,
        order: t.categoryOrder ?? 0,
        teamCount: 1,
      });
  }

  const byCategory: CategoryCount[] = Array.from(categoryMeta.entries())
    .map(([categoryId, meta]) => ({
      categoryId,
      categoryName: meta.name,
      teamCount: meta.teamCount,
      playerCount: playersByCategory.get(categoryId)?.size ?? 0,
    }))
    .sort((a, b) => {
      const oa = categoryMeta.get(a.categoryId)!.order;
      const ob = categoryMeta.get(b.categoryId)!.order;
      return oa - ob || byName(a.categoryName, b.categoryName);
    });

  const byTeam: TeamCount[] = teams
    .map((t) => ({
      teamId: t.id,
      teamName: t.name,
      categoryId: t.categoryId,
      categoryName: t.categoryName,
      playerCount: playersByTeam.get(t.id)?.size ?? 0,
    }))
    .sort((a, b) => {
      const oa = teamById.get(a.teamId)!.categoryOrder ?? 0;
      const ob = teamById.get(b.teamId)!.categoryOrder ?? 0;
      return oa - ob || byName(a.categoryName, b.categoryName) || byName(a.teamName, b.teamName);
    });

  return { totalPlayers: allPlayers.size, byCategory, byTeam };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. aggregateTeamResults — récord W-D-L + GF/GA por equipo (D2)
// ─────────────────────────────────────────────────────────────────────────────

/** Status de la sesión de captura (`match_state.status`). */
export type MatchStateStatus = 'not_started' | 'live' | 'closed';

/**
 * Un partido del equipo con el estado de su captura. Lo aporta el loader uniendo
 * `events` (type ∈ match/friendly/tournament, team_id) con `match_state`
 * (`status`, `goals_for`, `goals_against`). `goalsFor`/`goalsAgainst` son
 * `smallint` NULLABLE aun cuando el partido está cerrado.
 */
export interface MatchResultRow {
  teamId: string;
  status: MatchStateStatus;
  goalsFor: number | null;
  goalsAgainst: number | null;
}

export interface TeamResults {
  teamId: string;
  /** Partidos contabilizados = cerrados CON marcador completo (GF y GA no-null). */
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  /** GF − GA sobre los contabilizados. */
  goalDifference: number;
  /**
   * Partidos cerrados SIN marcador completo (GF/GA null o solo uno informado):
   * D2 — no suman a W-D-L ni a GF/GA; se reportan aparte para honestidad del
   * dato. La UI puede avisar "N cerrados sin marcador".
   */
  closedWithoutScore: number;
}

function emptyTeamResults(teamId: string): TeamResults {
  return {
    teamId,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    closedWithoutScore: 0,
  };
}

/**
 * Récord acumulado por equipo. `teamIds` dirige la salida: una entrada por
 * equipo (a ceros si no tiene partidos), en su orden. Las filas de equipos no
 * listados se ignoran (defensivo). Solo cuentan partidos `status='closed'`
 * (D2): los `not_started`/`live` se descartan; los cerrados sin marcador
 * completo van a `closedWithoutScore` y no contaminan los totales.
 */
export function aggregateTeamResults(
  teamIds: readonly string[],
  rows: readonly MatchResultRow[],
): TeamResults[] {
  const byTeam = new Map<string, TeamResults>();
  for (const id of teamIds) byTeam.set(id, emptyTeamResults(id));

  for (const r of rows) {
    if (r.status !== 'closed') continue; // D2: solo cerrados
    const acc = byTeam.get(r.teamId);
    if (!acc) continue; // equipo no listado → ignorar

    // null NO es 0: marcador incompleto → fuera de W-D-L/GF-GA.
    if (r.goalsFor == null || r.goalsAgainst == null) {
      acc.closedWithoutScore += 1;
      continue;
    }

    acc.played += 1;
    acc.goalsFor += r.goalsFor;
    acc.goalsAgainst += r.goalsAgainst;
    if (r.goalsFor > r.goalsAgainst) acc.wins += 1;
    else if (r.goalsFor === r.goalsAgainst) acc.draws += 1;
    else acc.losses += 1;
  }

  for (const acc of byTeam.values()) {
    acc.goalDifference = acc.goalsFor - acc.goalsAgainst;
  }

  return teamIds.map((id) => byTeam.get(id)!);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. clubAttendanceAgg — media + ranking + tendencia de asistencia
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Una fila de `training_attendance` enriquecida con el equipo, el jugador y la
 * fecha del evento (de `events.starts_at`, ISO). El loader la arma uniendo
 * `training_attendance` (code) con `events` (team_id, starts_at).
 */
export interface ClubAttendanceRow extends AttendanceRow {
  eventId: string;
  /** `events.starts_at` en ISO-8601; se usa para ordenar la tendencia. */
  eventDate: string;
  teamId: string;
  playerId: string;
}

export interface TeamAttendance {
  teamId: string;
  breakdown: AttendanceBreakdown;
}

export interface PlayerAttendance {
  playerId: string;
  breakdown: AttendanceBreakdown;
}

/** Un punto de la serie de tendencia (por evento o por semana ISO). */
export interface AttendanceTrendPoint {
  /** `eventId` (tendencia por evento) o clave de semana ISO `YYYY-Www`. */
  key: string;
  /** Fecha ISO representativa del bucket (la más temprana) — para etiqueta/orden. */
  date: string;
  present: number;
  total: number;
  /** present / total en 0..1; `null` si el bucket no tuvo filas (no ocurre). */
  presentPct: number | null;
}

export interface ClubAttendanceAgg {
  /** Desglose agregado de TODO el club (reusa `attendanceBreakdown`). */
  club: AttendanceBreakdown;
  /** Media/desglose por equipo (ordenado por teamId, estable). */
  byTeam: TeamAttendance[];
  /** Ranking de jugadores por % presencia desc (desempate: total desc, id asc). */
  playerRanking: PlayerAttendance[];
  /** Tendencia: un punto por evento, orden cronológico ascendente. */
  trendByEvent: AttendanceTrendPoint[];
  /** Tendencia: un punto por semana ISO, orden cronológico ascendente. */
  trendByWeek: AttendanceTrendPoint[];
}

/** Clave de semana ISO-8601 (`YYYY-Www`) a partir de una fecha ISO. */
function isoWeekKey(iso: string): string {
  const src = new Date(iso);
  // Trabaja en UTC sobre la fecha (sin hora) para evitar saltos por zona.
  const d = new Date(Date.UTC(src.getUTCFullYear(), src.getUTCMonth(), src.getUTCDate()));
  // ISO: el jueves de la semana define el año. Lunes=0..Domingo=6.
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // mover al jueves de esa semana
  const isoYear = d.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 24 * 3600 * 1000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/** Construye un punto de tendencia a partir de las filas de un bucket. */
function trendPoint(key: string, rows: readonly ClubAttendanceRow[]): AttendanceTrendPoint {
  const breakdown = attendanceBreakdown(rows);
  const date = rows.reduce((min, r) => (r.eventDate < min ? r.eventDate : min), rows[0]!.eventDate);
  return {
    key,
    date,
    present: breakdown.perBucket.present,
    total: breakdown.total,
    presentPct: breakdown.presentPct,
  };
}

/** Agrupa filas por una clave y proyecta puntos de tendencia ordenados por fecha. */
function buildTrend(
  rows: readonly ClubAttendanceRow[],
  keyOf: (r: ClubAttendanceRow) => string,
): AttendanceTrendPoint[] {
  const groups = new Map<string, ClubAttendanceRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  return Array.from(groups.entries())
    .map(([key, group]) => trendPoint(key, group))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Agregados de asistencia para el dashboard: desglose de club, por equipo,
 * ranking de jugadores por % presencia y tendencia (por evento y por semana).
 * Reusa `attendanceBreakdown` para TODA la matemática de buckets/%; aquí solo se
 * agrupa y se ordena. 10.0 entrega los agregados CRUDOS; el filtrado por umbral
 * (D3) es 10.5.
 */
export function clubAttendanceAgg(rows: readonly ClubAttendanceRow[]): ClubAttendanceAgg {
  const byTeamRows = new Map<string, ClubAttendanceRow[]>();
  const byPlayerRows = new Map<string, ClubAttendanceRow[]>();
  for (const r of rows) {
    (byTeamRows.get(r.teamId) ?? byTeamRows.set(r.teamId, []).get(r.teamId)!).push(r);
    (byPlayerRows.get(r.playerId) ?? byPlayerRows.set(r.playerId, []).get(r.playerId)!).push(r);
  }

  const byTeam: TeamAttendance[] = Array.from(byTeamRows.entries())
    .map(([teamId, group]) => ({ teamId, breakdown: attendanceBreakdown(group) }))
    .sort((a, b) => (a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0));

  const playerRanking: PlayerAttendance[] = Array.from(byPlayerRows.entries())
    .map(([playerId, group]) => ({
      playerId,
      breakdown: attendanceBreakdown(group),
    }))
    .sort((a, b) => {
      const pa = a.breakdown.presentPct ?? -1;
      const pb = b.breakdown.presentPct ?? -1;
      if (pb !== pa) return pb - pa; // % presencia desc
      if (b.breakdown.total !== a.breakdown.total) return b.breakdown.total - a.breakdown.total; // muestra desc
      return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0;
    });

  return {
    club: attendanceBreakdown(rows),
    byTeam,
    playerRanking,
    trendByEvent: buildTrend(rows, (r) => r.eventId),
    trendByWeek: buildTrend(rows, (r) => isoWeekKey(r.eventDate)),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. clubRankings — goleadores, MVPs y mejor media POR CATEGORÍA (D5)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fila de `match_player_stats` con la categoría del equipo en que se jugó (el
 * loader resuelve team → category). Los goles se atribuyen a la categoría del
 * equipo con el que se anotaron.
 */
export interface CategoryStatRow {
  categoryId: string;
  categoryName: string;
  playerId: string;
  goals: number;
}

/**
 * Fila de `evaluations` con la categoría del equipo (D5). `rating` 1..10
 * nullable; `isMvp` = `evaluations.is_mvp` (selección real del entrenador).
 */
export interface CategoryEvalRow {
  categoryId: string;
  categoryName: string;
  playerId: string;
  rating: number | null;
  isMvp: boolean;
}

/** Una posición del ranking. Empates → mismo `rank` (ranking de competición). */
export interface RankingEntry {
  playerId: string;
  /** Valor que ordena: goles, nº de MVPs o media de valoración. */
  value: number;
  /** Posición 1-based; los empatados comparten posición (1,1,3…). */
  rank: number;
  /** Solo en "mejor media": nº de valoraciones que sostienen la media. */
  sample?: number;
}

export interface CategoryRankings {
  categoryId: string;
  categoryName: string;
  topScorers: RankingEntry[];
  topMvps: RankingEntry[];
  bestAvgRating: RankingEntry[];
}

export interface ClubRankingsOptions {
  /** Nº de POSICIONES distintas a devolver por ranking (con empates). Default 5. */
  topN?: number;
  /** Suelo de muestras para "mejor media" (reusa el de nota alta/mvp_season). */
  ratingMinSample?: number;
}

interface Scored {
  playerId: string;
  value: number;
  sample?: number;
}

/**
 * Top-N POSICIONES por valor desc con empates explícitos: se toman los N
 * valores distintos más altos y se devuelven TODOS los jugadores que los
 * alcanzan. `rank` = ranking de competición (1 + nº de jugadores con valor
 * estrictamente mayor). Desempate de orden: `playerId` asc.
 */
function topNWithTies(items: readonly Scored[], topN: number): RankingEntry[] {
  if (items.length === 0 || topN <= 0) return [];
  const sorted = [...items].sort(
    (a, b) => b.value - a.value || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0),
  );
  const distinct: number[] = [];
  for (const it of sorted) {
    if (distinct.length === 0 || distinct[distinct.length - 1] !== it.value) {
      if (distinct.length === topN) break;
      distinct.push(it.value);
    }
  }
  const cutoff = distinct[distinct.length - 1]!;
  return sorted
    .filter((it) => it.value >= cutoff)
    .map((it) => ({
      playerId: it.playerId,
      value: it.value,
      ...(it.sample != null ? { sample: it.sample } : {}),
      rank: 1 + sorted.filter((j) => j.value > it.value).length,
    }));
}

/** Agrupa un array por una clave string. */
function groupBy<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const it of items) {
    const k = keyOf(it);
    const list = out.get(k);
    if (list) list.push(it);
    else out.set(k, [it]);
  }
  return out;
}

/**
 * Rankings POR CATEGORÍA (D5): goleadores (Σ goles), MVPs (conteo de
 * `is_mvp`) y mejor media de valoración (con suelo de muestras). Cada lista es
 * top-N posiciones con empates. Se excluyen jugadores sin mérito (0 goles, 0
 * MVPs, o sin alcanzar el suelo de muestras para la media). Las categorías se
 * ordenan por nombre; las que solo aparecen en stats o solo en evaluaciones
 * salen igual (con la lista vacía que corresponda).
 */
export function clubRankings(
  statRows: readonly CategoryStatRow[],
  evalRows: readonly CategoryEvalRow[],
  options: ClubRankingsOptions = {},
): CategoryRankings[] {
  const topN = options.topN ?? 5;
  const minSample = options.ratingMinSample ?? BADGE_THRESHOLDS.HIGH_RATING_MIN_SAMPLE;

  // Conjunto de categorías presentes en cualquiera de las dos fuentes + nombre.
  const categoryName = new Map<string, string>();
  for (const r of statRows)
    if (!categoryName.has(r.categoryId)) categoryName.set(r.categoryId, r.categoryName);
  for (const r of evalRows)
    if (!categoryName.has(r.categoryId)) categoryName.set(r.categoryId, r.categoryName);

  const statsByCat = groupBy(statRows, (r) => r.categoryId);
  const evalsByCat = groupBy(evalRows, (r) => r.categoryId);

  return Array.from(categoryName.entries())
    .sort((a, b) => byName(a[1], b[1]) || (a[0] < b[0] ? -1 : 1))
    .map(([categoryId, name]) => {
      const stats = statsByCat.get(categoryId) ?? [];
      const evals = evalsByCat.get(categoryId) ?? [];

      // Goleadores: Σ goles por jugador, excluye 0.
      const goalsByPlayer = new Map<string, number>();
      for (const r of stats)
        goalsByPlayer.set(r.playerId, (goalsByPlayer.get(r.playerId) ?? 0) + r.goals);
      const scorers: Scored[] = Array.from(goalsByPlayer.entries())
        .filter(([, g]) => g > 0)
        .map(([playerId, value]) => ({ playerId, value }));

      // MVPs: conteo de is_mvp por jugador, excluye 0.
      const mvpByPlayer = new Map<string, number>();
      for (const r of evals)
        if (r.isMvp) mvpByPlayer.set(r.playerId, (mvpByPlayer.get(r.playerId) ?? 0) + 1);
      const mvps: Scored[] = Array.from(mvpByPlayer.entries()).map(([playerId, value]) => ({
        playerId,
        value,
      }));

      // Mejor media: media de ratings no-null con suelo de muestras.
      const ratingAgg = new Map<string, { sum: number; n: number }>();
      for (const r of evals) {
        if (r.rating == null) continue;
        const a = ratingAgg.get(r.playerId) ?? { sum: 0, n: 0 };
        a.sum += r.rating;
        a.n += 1;
        ratingAgg.set(r.playerId, a);
      }
      const avgs: Scored[] = Array.from(ratingAgg.entries())
        .filter(([, a]) => a.n >= minSample)
        .map(([playerId, a]) => ({
          playerId,
          value: a.sum / a.n,
          sample: a.n,
        }));

      return {
        categoryId,
        categoryName: name,
        topScorers: topNWithTies(scorers, topN),
        topMvps: topNWithTies(mvps, topN),
        bestAvgRating: topNWithTies(avgs, topN),
      };
    });
}
