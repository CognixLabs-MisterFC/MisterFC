import { describe, it, expect } from 'vitest';
import { emptyAggregatedStats, type AggregatedStats } from '../aggregate';
import {
  evaluateSeasonBadges,
  evaluateCareerBadges,
  BADGE_THRESHOLDS,
  type SeasonBadgeInput,
  type BadgeKind,
  type Badge,
} from '../badges';

function stats(over: Partial<AggregatedStats> = {}): AggregatedStats {
  return { ...emptyAggregatedStats(), ...over };
}

function player(
  playerId: string,
  over: Partial<SeasonBadgeInput> = {}
): SeasonBadgeInput {
  return { playerId, stats: stats(), ...over };
}

const ON = { showRating: true };
const OFF = { showRating: false };

function kinds(map: Map<string, Badge[]>, id: string): BadgeKind[] {
  return (map.get(id) ?? []).map((b) => b.kind);
}

describe('evaluateSeasonBadges — relativas (roster)', () => {
  it('da pichichi/top asistente al líder del roster', () => {
    const roster = [
      player('a', { stats: stats({ matches: 3, goals: 5, assists: 1 }) }),
      player('b', { stats: stats({ matches: 3, goals: 2, assists: 7 }) }),
    ];
    const m = evaluateSeasonBadges(roster, OFF);
    expect(kinds(m, 'a')).toContain('top_scorer_team');
    expect(kinds(m, 'a')).not.toContain('top_assister_team');
    expect(kinds(m, 'b')).toContain('top_assister_team');
    expect(kinds(m, 'b')).not.toContain('top_scorer_team');
  });

  it('empate: TODOS los líderes empatados reciben la badge', () => {
    const roster = [
      player('a', { stats: stats({ goals: 4 }) }),
      player('b', { stats: stats({ goals: 4 }) }),
      player('c', { stats: stats({ goals: 1 }) }),
    ];
    const m = evaluateSeasonBadges(roster, OFF);
    expect(kinds(m, 'a')).toContain('top_scorer_team');
    expect(kinds(m, 'b')).toContain('top_scorer_team');
    expect(kinds(m, 'c')).not.toContain('top_scorer_team');
  });

  it('no da pichichi si el máximo del roster es 0', () => {
    const roster = [player('a'), player('b')];
    const m = evaluateSeasonBadges(roster, OFF);
    expect(m.size).toBe(0);
  });
});

describe('evaluateSeasonBadges — absolutas en el borde del umbral', () => {
  it('goleador: goles == umbral sí, umbral-1 no', () => {
    const g = BADGE_THRESHOLDS.TOP_SCORER_GOALS;
    const m = evaluateSeasonBadges(
      [
        player('hit', { stats: stats({ goals: g }) }),
        player('miss', { stats: stats({ goals: g - 1 }) }),
      ],
      OFF
    );
    expect(kinds(m, 'hit')).toContain('top_scorer');
    expect(kinds(m, 'miss')).not.toContain('top_scorer');
  });

  it('hombre de hierro: partidos == umbral sí, umbral-1 no', () => {
    const n = BADGE_THRESHOLDS.IRON_MAN_MATCHES;
    const m = evaluateSeasonBadges(
      [
        player('hit', { stats: stats({ matches: n }) }),
        player('miss', { stats: stats({ matches: n - 1 }) }),
      ],
      OFF
    );
    expect(kinds(m, 'hit')).toContain('iron_man');
    expect(kinds(m, 'miss')).not.toContain('iron_man');
  });

  it('juego limpio: 0 rojas y amarillas/partido en el límite; falla con roja o exceso de amarillas', () => {
    // 5 partidos, 1 amarilla → 0.2 ≤ 0.25 ✓
    const ok = player('ok', { stats: stats({ matches: 5, yellowCards: 1, redCards: 0 }) });
    // 5 partidos, 2 amarillas → 0.4 > 0.25 ✗
    const tooYellow = player('y', { stats: stats({ matches: 5, yellowCards: 2 }) });
    // roja presente ✗
    const red = player('r', { stats: stats({ matches: 5, yellowCards: 0, redCards: 1 }) });
    // pocas apariciones ✗
    const few = player('f', { stats: stats({ matches: 4, yellowCards: 0 }) });
    const m = evaluateSeasonBadges([ok, tooYellow, red, few], OFF);
    expect(kinds(m, 'ok')).toContain('clean_play');
    expect(kinds(m, 'y')).not.toContain('clean_play');
    expect(kinds(m, 'r')).not.toContain('clean_play');
    expect(kinds(m, 'f')).not.toContain('clean_play');
  });

  it('killer de penaltis: ≥3 intentos y ≥80% acierto', () => {
    const perfect = player('p', { stats: stats({ penaltiesScored: 3, penaltiesMissed: 0 }) });
    // 4/5 = 0.8 ✓
    const edge = player('e', { stats: stats({ penaltiesScored: 4, penaltiesMissed: 1 }) });
    // 3/5 = 0.6 ✗
    const low = player('l', { stats: stats({ penaltiesScored: 3, penaltiesMissed: 2 }) });
    // 2 intentos < 3 ✗
    const fewAtt = player('a', { stats: stats({ penaltiesScored: 2, penaltiesMissed: 0 }) });
    const m = evaluateSeasonBadges([perfect, edge, low, fewAtt], OFF);
    expect(kinds(m, 'p')).toContain('penalty_killer');
    expect(kinds(m, 'e')).toContain('penalty_killer');
    expect(kinds(m, 'l')).not.toContain('penalty_killer');
    expect(kinds(m, 'a')).not.toContain('penalty_killer');
  });
});

describe('evaluateSeasonBadges — racha de titular (serie ordenada)', () => {
  it('da la badge con racha consecutiva ≥ umbral y reporta el valor', () => {
    const min = BADGE_THRESHOLDS.STARTER_STREAK_MIN;
    const timeline = Array.from({ length: min }, () => true);
    const m = evaluateSeasonBadges(
      [player('a', { stats: stats({ matches: min, starts: min }), startedTimeline: timeline })],
      OFF
    );
    const badge = (m.get('a') ?? []).find((b) => b.kind === 'starter_streak');
    expect(badge?.value).toBe(min);
  });

  it('no cuenta titularidades NO consecutivas', () => {
    // 6 titularidades pero cortadas → racha máxima 3 < 5
    const timeline = [true, true, true, false, true, true, true];
    const m = evaluateSeasonBadges(
      [player('a', { stats: stats({ matches: 7 }), startedTimeline: timeline })],
      OFF
    );
    expect(kinds(m, 'a')).not.toContain('starter_streak');
  });

  it('toma la racha MÁS LARGA del historial', () => {
    const timeline = [true, true, false, true, true, true, true, true]; // run de 5 al final
    const m = evaluateSeasonBadges(
      [player('a', { stats: stats({ matches: 8 }), startedTimeline: timeline })],
      OFF
    );
    const badge = (m.get('a') ?? []).find((b) => b.kind === 'starter_streak');
    expect(badge?.value).toBe(5);
  });

  it('sin serie no evalúa la racha', () => {
    const m = evaluateSeasonBadges([player('a', { stats: stats({ matches: 10, starts: 10 }) })], OFF);
    expect(kinds(m, 'a')).not.toContain('starter_streak');
  });
});

describe('evaluateSeasonBadges — asistencia perfecta', () => {
  it('100% con sesiones ≥ mínimo', () => {
    const n = BADGE_THRESHOLDS.PERFECT_ATTENDANCE_MIN_SESSIONS;
    const m = evaluateSeasonBadges(
      [player('a', { attendancePct: 1, attendanceSessions: n })],
      OFF
    );
    expect(kinds(m, 'a')).toContain('perfect_attendance');
  });

  it('100% pero pocas sesiones → no', () => {
    const n = BADGE_THRESHOLDS.PERFECT_ATTENDANCE_MIN_SESSIONS;
    const m = evaluateSeasonBadges(
      [player('a', { attendancePct: 1, attendanceSessions: n - 1 })],
      OFF
    );
    expect(kinds(m, 'a')).not.toContain('perfect_attendance');
  });

  it('presencia < 100% → no; sin dato → no', () => {
    const m = evaluateSeasonBadges(
      [
        player('a', { attendancePct: 0.9, attendanceSessions: 20 }),
        player('b'),
      ],
      OFF
    );
    expect(kinds(m, 'a')).not.toContain('perfect_attendance');
    expect(m.has('b')).toBe(false);
  });
});

describe('evaluateSeasonBadges — rating-sensibles (flag D5)', () => {
  const ratingPlayer = player('a', {
    stats: stats({ matches: 10 }),
    mvpCount: 5,
    avgRating: 9,
    ratingCount: 10,
  });

  it('flag OFF NO emite MVP ni nota alta', () => {
    const m = evaluateSeasonBadges([ratingPlayer], OFF);
    expect(kinds(m, 'a')).not.toContain('mvp');
    expect(kinds(m, 'a')).not.toContain('high_rating');
  });

  it('flag ON emite MVP y nota alta', () => {
    const m = evaluateSeasonBadges([ratingPlayer], ON);
    expect(kinds(m, 'a')).toContain('mvp');
    expect(kinds(m, 'a')).toContain('high_rating');
  });

  it('MVP escala de nivel por nº (1/3/5 → 1/2/3)', () => {
    const m = evaluateSeasonBadges(
      [
        player('one', { mvpCount: 1 }),
        player('three', { mvpCount: 3 }),
        player('five', { mvpCount: 5 }),
      ],
      ON
    );
    expect((m.get('one') ?? []).find((b) => b.kind === 'mvp')?.level).toBe(1);
    expect((m.get('three') ?? []).find((b) => b.kind === 'mvp')?.level).toBe(2);
    expect((m.get('five') ?? []).find((b) => b.kind === 'mvp')?.level).toBe(3);
  });

  it('nota alta exige muestra mínima', () => {
    const small = player('s', { avgRating: 8, ratingCount: BADGE_THRESHOLDS.HIGH_RATING_MIN_SAMPLE - 1 });
    const big = player('b', { avgRating: 8, ratingCount: BADGE_THRESHOLDS.HIGH_RATING_MIN_SAMPLE });
    const m = evaluateSeasonBadges([small, big], ON);
    expect(kinds(m, 's')).not.toContain('high_rating');
    expect(kinds(m, 'b')).toContain('high_rating');
  });

  it('nota alta en el borde del umbral', () => {
    const min = BADGE_THRESHOLDS.HIGH_RATING_MIN;
    const m = evaluateSeasonBadges(
      [
        player('hit', { avgRating: min, ratingCount: 10 }),
        player('miss', { avgRating: min - 0.1, ratingCount: 10 }),
      ],
      ON
    );
    expect(kinds(m, 'hit')).toContain('high_rating');
    expect(kinds(m, 'miss')).not.toContain('high_rating');
  });
});

describe('evaluateSeasonBadges — vacío', () => {
  it('roster vacío → mapa vacío', () => {
    expect(evaluateSeasonBadges([], ON).size).toBe(0);
  });
});

describe('evaluateCareerBadges — veterano', () => {
  it('por debajo de 50 → ninguna', () => {
    expect(evaluateCareerBadges({ careerMatches: 49 })).toHaveLength(0);
  });

  it('50/100/200 → nivel 1/2/3 y el valor son los partidos', () => {
    expect(evaluateCareerBadges({ careerMatches: 50 })[0]).toMatchObject({
      kind: 'veteran',
      scope: 'career',
      level: 1,
      value: 50,
    });
    expect(evaluateCareerBadges({ careerMatches: 100 })[0]?.level).toBe(2);
    expect(evaluateCareerBadges({ careerMatches: 200 })[0]?.level).toBe(3);
    expect(evaluateCareerBadges({ careerMatches: 250 })[0]?.level).toBe(3);
  });
});
