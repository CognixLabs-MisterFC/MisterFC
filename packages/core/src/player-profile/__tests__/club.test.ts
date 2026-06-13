import { describe, it, expect } from 'vitest';
import {
  aggregateClubStats,
  aggregateTeamResults,
  clubAttendanceAgg,
  clubRankings,
  type ClubTeam,
  type ClubMember,
  type MatchResultRow,
  type ClubAttendanceRow,
  type CategoryStatRow,
  type CategoryEvalRow,
} from '../club';
import { BADGE_THRESHOLDS } from '../badges';
import type { AttendanceCode } from '../../schemas/attendance';

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

function team(id: string, over: Partial<ClubTeam> = {}): ClubTeam {
  return {
    id,
    name: id.toUpperCase(),
    categoryId: 'cat',
    categoryName: 'Categoría',
    categoryOrder: 0,
    ...over,
  };
}

function member(playerId: string, teamId: string): ClubMember {
  return { playerId, teamId };
}

function result(
  teamId: string,
  status: MatchResultRow['status'],
  goalsFor: number | null,
  goalsAgainst: number | null,
): MatchResultRow {
  return { teamId, status, goalsFor, goalsAgainst };
}

function att(over: Partial<ClubAttendanceRow> & { code: AttendanceCode }): ClubAttendanceRow {
  return {
    eventId: 'e1',
    eventDate: '2026-01-01T10:00:00.000Z',
    teamId: 't1',
    playerId: 'p1',
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. aggregateClubStats
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateClubStats', () => {
  it('cuenta jugadores distintos del club, por equipo y por categoría', () => {
    const teams = [
      team('t1', { name: 'Alevín A', categoryId: 'c1', categoryName: 'Alevín', categoryOrder: 1 }),
      team('t2', { name: 'Alevín B', categoryId: 'c1', categoryName: 'Alevín', categoryOrder: 1 }),
      team('t3', {
        name: 'Juvenil A',
        categoryId: 'c2',
        categoryName: 'Juvenil',
        categoryOrder: 2,
      }),
    ];
    const members = [
      member('p1', 't1'),
      member('p2', 't1'),
      member('p3', 't2'),
      member('p4', 't3'),
    ];

    const census = aggregateClubStats(teams, members);

    expect(census.totalPlayers).toBe(4);
    expect(census.byTeam.find((t) => t.teamId === 't1')!.playerCount).toBe(2);
    expect(census.byTeam.find((t) => t.teamId === 't2')!.playerCount).toBe(1);
    expect(census.byTeam.find((t) => t.teamId === 't3')!.playerCount).toBe(1);

    const alevin = census.byCategory.find((c) => c.categoryId === 'c1')!;
    expect(alevin.teamCount).toBe(2);
    expect(alevin.playerCount).toBe(3); // p1,p2,p3
  });

  it('un jugador en dos equipos cuenta en cada equipo pero una vez en el total', () => {
    const teams = [team('t1'), team('t2')];
    const members = [member('p1', 't1'), member('p1', 't2'), member('p2', 't1')];

    const census = aggregateClubStats(teams, members);

    expect(census.totalPlayers).toBe(2); // p1, p2 distinct
    expect(census.byTeam.find((t) => t.teamId === 't1')!.playerCount).toBe(2);
    expect(census.byTeam.find((t) => t.teamId === 't2')!.playerCount).toBe(1);
  });

  it('un jugador en dos equipos de la MISMA categoría cuenta una vez en la categoría', () => {
    const teams = [
      team('t1', { categoryId: 'c1', categoryName: 'Alevín' }),
      team('t2', { categoryId: 'c1', categoryName: 'Alevín' }),
    ];
    const members = [member('p1', 't1'), member('p1', 't2')];

    const census = aggregateClubStats(teams, members);
    expect(census.byCategory.find((c) => c.categoryId === 'c1')!.playerCount).toBe(1);
  });

  it('un jugador en dos categorías distintas cuenta en cada categoría', () => {
    const teams = [
      team('t1', { categoryId: 'c1', categoryName: 'Alevín' }),
      team('t2', { categoryId: 'c2', categoryName: 'Juvenil' }),
    ];
    const members = [member('p1', 't1'), member('p1', 't2')];

    const census = aggregateClubStats(teams, members);
    expect(census.byCategory.find((c) => c.categoryId === 'c1')!.playerCount).toBe(1);
    expect(census.byCategory.find((c) => c.categoryId === 'c2')!.playerCount).toBe(1);
    expect(census.totalPlayers).toBe(1);
  });

  it('incluye equipos sin jugadores con playerCount 0', () => {
    const teams = [team('t1'), team('t2')];
    const members = [member('p1', 't1')];
    const census = aggregateClubStats(teams, members);
    expect(census.byTeam.find((t) => t.teamId === 't2')!.playerCount).toBe(0);
  });

  it('ignora membresías huérfanas (teamId no listado)', () => {
    const teams = [team('t1')];
    const members = [member('p1', 't1'), member('p2', 'desconocido')];
    const census = aggregateClubStats(teams, members);
    expect(census.totalPlayers).toBe(1);
  });

  it('ordena categorías por order_idx y luego nombre; equipos por (orden cat, nombre cat, nombre equipo)', () => {
    const teams = [
      team('t3', { name: 'Zebra', categoryId: 'c2', categoryName: 'Juvenil', categoryOrder: 2 }),
      team('t1', { name: 'Beta', categoryId: 'c1', categoryName: 'Alevín', categoryOrder: 1 }),
      team('t2', { name: 'Alfa', categoryId: 'c1', categoryName: 'Alevín', categoryOrder: 1 }),
    ];
    const census = aggregateClubStats(teams, []);
    expect(census.byCategory.map((c) => c.categoryId)).toEqual(['c1', 'c2']);
    expect(census.byTeam.map((t) => t.teamId)).toEqual(['t2', 't1', 't3']); // Alfa<Beta dentro de c1
  });

  it('club vacío → ceros', () => {
    const census = aggregateClubStats([], []);
    expect(census).toEqual({ totalPlayers: 0, byCategory: [], byTeam: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. aggregateTeamResults
// ─────────────────────────────────────────────────────────────────────────────

describe('aggregateTeamResults', () => {
  it('cuenta W-D-L y GF/GA solo de partidos cerrados con marcador completo', () => {
    const rows = [
      result('t1', 'closed', 3, 1), // W
      result('t1', 'closed', 2, 2), // D
      result('t1', 'closed', 0, 1), // L
    ];
    const [t1] = aggregateTeamResults(['t1'], rows);
    expect(t1).toMatchObject({
      played: 3,
      wins: 1,
      draws: 1,
      losses: 1,
      goalsFor: 5,
      goalsAgainst: 4,
      goalDifference: 1,
      closedWithoutScore: 0,
    });
  });

  it('D2: descarta not_started y live', () => {
    const rows = [
      result('t1', 'not_started', 5, 0),
      result('t1', 'live', 1, 0),
      result('t1', 'closed', 1, 0),
    ];
    const [t1] = aggregateTeamResults(['t1'], rows);
    expect(t1!.played).toBe(1);
    expect(t1!.wins).toBe(1);
  });

  it('cerrado sin marcador (null GF/GA) NO suma: va a closedWithoutScore, null != 0', () => {
    const rows = [
      result('t1', 'closed', null, null),
      result('t1', 'closed', 2, null), // parcial → incompleto
      result('t1', 'closed', null, 3), // parcial → incompleto
    ];
    const [t1] = aggregateTeamResults(['t1'], rows);
    expect(t1).toMatchObject({
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      closedWithoutScore: 3,
    });
  });

  it('marcador 0-0 cuenta como empate (no se confunde con null)', () => {
    const [t1] = aggregateTeamResults(['t1'], [result('t1', 'closed', 0, 0)]);
    expect(t1).toMatchObject({ played: 1, draws: 1, goalsFor: 0, goalsAgainst: 0 });
  });

  it('teamIds dirige la salida: equipo sin partidos → entrada a ceros, en orden', () => {
    const results = aggregateTeamResults(['t1', 't2'], [result('t1', 'closed', 1, 0)]);
    expect(results.map((r) => r.teamId)).toEqual(['t1', 't2']);
    expect(results[1]).toMatchObject({ played: 0, wins: 0, closedWithoutScore: 0 });
  });

  it('ignora filas de equipos no listados', () => {
    const results = aggregateTeamResults(['t1'], [result('tX', 'closed', 9, 0)]);
    expect(results[0]!.played).toBe(0);
  });

  it('sin equipos → array vacío', () => {
    expect(aggregateTeamResults([], [])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. clubAttendanceAgg
// ─────────────────────────────────────────────────────────────────────────────

describe('clubAttendanceAgg', () => {
  it('desglose de club reutiliza attendanceBreakdown (presentPct global)', () => {
    const rows = [
      att({ code: 'presente' }),
      att({ code: 'presente' }),
      att({ code: 'ausente' }),
      att({ code: 'lesionado' }),
    ];
    const agg = clubAttendanceAgg(rows);
    expect(agg.club.total).toBe(4);
    expect(agg.club.presentPct).toBeCloseTo(0.5);
    expect(agg.club.perBucket.justified).toBe(1); // lesionado
    expect(agg.club.perBucket.unjustified).toBe(1); // ausente
  });

  it('media por equipo', () => {
    const rows = [
      att({ teamId: 't1', code: 'presente' }),
      att({ teamId: 't1', code: 'ausente' }),
      att({ teamId: 't2', code: 'presente' }),
      att({ teamId: 't2', code: 'presente' }),
    ];
    const agg = clubAttendanceAgg(rows);
    expect(agg.byTeam.find((t) => t.teamId === 't1')!.breakdown.presentPct).toBeCloseTo(0.5);
    expect(agg.byTeam.find((t) => t.teamId === 't2')!.breakdown.presentPct).toBeCloseTo(1);
  });

  it('ranking de jugadores por % presencia desc, desempate por muestra y luego id', () => {
    const rows = [
      // p1: 1/1 = 100%
      att({ playerId: 'p1', eventId: 'e1', code: 'presente' }),
      // p2: 2/2 = 100% (empata en %, más muestra → va antes)
      att({ playerId: 'p2', eventId: 'e1', code: 'presente' }),
      att({ playerId: 'p2', eventId: 'e2', code: 'presente' }),
      // p3: 1/2 = 50%
      att({ playerId: 'p3', eventId: 'e1', code: 'presente' }),
      att({ playerId: 'p3', eventId: 'e2', code: 'ausente' }),
    ];
    const agg = clubAttendanceAgg(rows);
    expect(agg.playerRanking.map((p) => p.playerId)).toEqual(['p2', 'p1', 'p3']);
  });

  it('tendencia por evento ordenada cronológicamente', () => {
    const rows = [
      att({ eventId: 'eB', eventDate: '2026-02-01T10:00:00Z', code: 'presente' }),
      att({ eventId: 'eA', eventDate: '2026-01-01T10:00:00Z', code: 'presente' }),
      att({ eventId: 'eA', eventDate: '2026-01-01T10:00:00Z', code: 'ausente' }),
    ];
    const agg = clubAttendanceAgg(rows);
    expect(agg.trendByEvent.map((p) => p.key)).toEqual(['eA', 'eB']);
    expect(agg.trendByEvent[0]).toMatchObject({ present: 1, total: 2, presentPct: 0.5 });
    expect(agg.trendByEvent[1]).toMatchObject({ present: 1, total: 1, presentPct: 1 });
  });

  it('tendencia por semana ISO: agrupa eventos de la misma semana y ordena', () => {
    const rows = [
      // 2026-01-01 (jueves) → 2026-W01
      att({ eventId: 'e1', eventDate: '2026-01-01T10:00:00Z', code: 'presente' }),
      // 2026-01-02 (viernes) → misma semana 2026-W01
      att({ eventId: 'e2', eventDate: '2026-01-02T10:00:00Z', code: 'ausente' }),
      // 2026-01-08 (jueves) → 2026-W02
      att({ eventId: 'e3', eventDate: '2026-01-08T10:00:00Z', code: 'presente' }),
    ];
    const agg = clubAttendanceAgg(rows);
    expect(agg.trendByWeek.map((p) => p.key)).toEqual(['2026-W01', '2026-W02']);
    expect(agg.trendByWeek[0]).toMatchObject({ total: 2, present: 1 }); // e1+e2
    expect(agg.trendByWeek[0]!.date).toBe('2026-01-01T10:00:00Z'); // la más temprana
    expect(agg.trendByWeek[1]!.total).toBe(1);
  });

  it('sin filas → estructuras vacías y club a cero', () => {
    const agg = clubAttendanceAgg([]);
    expect(agg.club.total).toBe(0);
    expect(agg.club.presentPct).toBeNull();
    expect(agg.byTeam).toEqual([]);
    expect(agg.playerRanking).toEqual([]);
    expect(agg.trendByEvent).toEqual([]);
    expect(agg.trendByWeek).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. clubRankings
// ─────────────────────────────────────────────────────────────────────────────

function stat(
  categoryId: string,
  playerId: string,
  goals: number,
  categoryName = categoryId,
): CategoryStatRow {
  return { categoryId, categoryName, playerId, goals };
}
function evalRow(
  categoryId: string,
  playerId: string,
  over: Partial<CategoryEvalRow> = {},
): CategoryEvalRow {
  return {
    categoryId,
    categoryName: categoryId,
    playerId,
    rating: null,
    isMvp: false,
    ...over,
  };
}

describe('clubRankings', () => {
  it('goleadores por categoría: suma goles, excluye 0, top-N con empates', () => {
    const stats = [
      stat('c1', 'p1', 2),
      stat('c1', 'p1', 1), // p1 = 3
      stat('c1', 'p2', 3), // empata con p1 a 3
      stat('c1', 'p3', 1),
      stat('c1', 'p4', 0), // 0 goles → excluido
    ];
    const [c1] = clubRankings(stats, [], { topN: 2 });
    const scorers = c1!.topScorers;
    // top 2 valores distintos: 3 y 1 → p1,p2 (rank 1), p3 (rank 3)
    expect(scorers.map((s) => [s.playerId, s.value, s.rank])).toEqual([
      ['p1', 3, 1],
      ['p2', 3, 1],
      ['p3', 1, 3],
    ]);
    expect(scorers.some((s) => s.playerId === 'p4')).toBe(false);
  });

  it('separa rankings por categoría (D5): los goles no se mezclan entre categorías', () => {
    const stats = [stat('c1', 'p1', 5, 'Alevín'), stat('c2', 'p2', 9, 'Juvenil')];
    const ranks = clubRankings(stats, []);
    expect(ranks.map((r) => r.categoryName)).toEqual(['Alevín', 'Juvenil']);
    expect(ranks.find((r) => r.categoryId === 'c1')!.topScorers[0]!.playerId).toBe('p1');
    expect(ranks.find((r) => r.categoryId === 'c2')!.topScorers[0]!.playerId).toBe('p2');
  });

  it('MVPs: cuenta is_mvp por jugador, excluye 0', () => {
    const evals = [
      evalRow('c1', 'p1', { isMvp: true }),
      evalRow('c1', 'p1', { isMvp: true }),
      evalRow('c1', 'p2', { isMvp: true }),
      evalRow('c1', 'p3', { isMvp: false }),
    ];
    const [c1] = clubRankings([], evals);
    expect(c1!.topMvps.map((m) => [m.playerId, m.value])).toEqual([
      ['p1', 2],
      ['p2', 1],
    ]);
  });

  it('mejor media: promedia ratings no-null y aplica suelo de muestras (HIGH_RATING_MIN_SAMPLE)', () => {
    const floor = BADGE_THRESHOLDS.HIGH_RATING_MIN_SAMPLE; // 5
    const evals: CategoryEvalRow[] = [];
    // p1: 5 valoraciones de 8 → media 8, alcanza el suelo
    for (let i = 0; i < floor; i++) evals.push(evalRow('c1', 'p1', { rating: 8 }));
    // p2: 1 valoración de 10 → NO alcanza el suelo, excluido
    evals.push(evalRow('c1', 'p2', { rating: 10 }));
    // p3: ratings null no cuentan
    evals.push(evalRow('c1', 'p3', { rating: null, isMvp: true }));

    const [c1] = clubRankings([], evals);
    expect(c1!.bestAvgRating).toHaveLength(1);
    expect(c1!.bestAvgRating[0]).toMatchObject({
      playerId: 'p1',
      value: 8,
      sample: floor,
      rank: 1,
    });
  });

  it('suelo de muestras configurable por opción', () => {
    const evals = [evalRow('c1', 'p1', { rating: 7 }), evalRow('c1', 'p1', { rating: 9 })];
    const [c1] = clubRankings([], evals, { ratingMinSample: 2 });
    expect(c1!.bestAvgRating[0]).toMatchObject({ playerId: 'p1', value: 8, sample: 2 });
  });

  it('categoría que solo aparece en evaluaciones sale con topScorers vacío', () => {
    const [c1] = clubRankings([], [evalRow('c1', 'p1', { isMvp: true })]);
    expect(c1!.topScorers).toEqual([]);
    expect(c1!.topMvps).toHaveLength(1);
  });

  it('entradas vacías → array vacío', () => {
    expect(clubRankings([], [])).toEqual([]);
  });

  it('default topN = 5 posiciones distintas con empates', () => {
    const stats = [
      stat('c1', 'a', 6),
      stat('c1', 'b', 5),
      stat('c1', 'c', 4),
      stat('c1', 'd', 3),
      stat('c1', 'e', 2),
      stat('c1', 'f', 1), // 6ª posición → fuera
    ];
    const [c1] = clubRankings(stats, []);
    expect(c1!.topScorers.map((s) => s.playerId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
