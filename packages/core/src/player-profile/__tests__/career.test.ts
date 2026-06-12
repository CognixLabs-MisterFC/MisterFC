import { describe, it, expect } from 'vitest';
import {
  careerBySeason,
  careerTotals,
  seasonComparison,
  type SeasonStatRow,
  type SeasonMetricInput,
} from '../career';

function row(
  season: string,
  over: Partial<SeasonStatRow> = {}
): SeasonStatRow {
  return {
    season,
    started: false,
    minutes_played: 0,
    goals: 0,
    assists: 0,
    yellow_cards: 0,
    red_cards: 0,
    shots: 0,
    fouls_committed: 0,
    fouls_received: 0,
    penalties_scored: 0,
    penalties_missed: 0,
    ...over,
  };
}

describe('careerBySeason', () => {
  it('agrupa por temporada, suma y deriva ratios sobre el agregado de cada una', () => {
    const rows = [
      row('2024-25', { started: true, minutes_played: 90, goals: 1 }),
      row('2024-25', { started: false, minutes_played: 45, goals: 2 }),
      row('2025-26', { started: true, minutes_played: 90, goals: 1, assists: 1 }),
    ];

    const bySeason = careerBySeason(rows);

    expect(bySeason).toHaveLength(2);
    const s2425 = bySeason.find((s) => s.season === '2024-25')!;
    expect(s2425.stats.matches).toBe(2);
    expect(s2425.stats.starts).toBe(1);
    expect(s2425.stats.minutesPlayed).toBe(135);
    expect(s2425.stats.goals).toBe(3);
    // ratios sobre el agregado de la temporada: 3 goles / 2 partidos = 1.5
    expect(s2425.ratios.goalsPerMatch).toBeCloseTo(1.5, 6);
    // 3 goles · 90 / 135 min = 2.0
    expect(s2425.ratios.goalsPer90).toBeCloseTo(2.0, 6);
    // 1 titular / 2 partidos = 0.5
    expect(s2425.ratios.startRate).toBeCloseTo(0.5, 6);
  });

  it('devuelve las temporadas en orden DESCENDENTE por label', () => {
    const rows = [
      row('2023-24', { goals: 1 }),
      row('2025-26', { goals: 1 }),
      row('2024-25', { goals: 1 }),
    ];
    expect(careerBySeason(rows).map((s) => s.season)).toEqual([
      '2025-26',
      '2024-25',
      '2023-24',
    ]);
  });

  it('multi-equipo en la MISMA temporada se suma (D2)', () => {
    // Dos equipos en 2025-26 (p.ej. cambio de equipo a mitad de temporada):
    // ambas filas comparten season → mismo grupo → se suman.
    const rows = [
      row('2025-26', { minutes_played: 90, goals: 2 }), // equipo A
      row('2025-26', { minutes_played: 60, goals: 1 }), // equipo B
    ];
    const bySeason = careerBySeason(rows);
    expect(bySeason).toHaveLength(1);
    expect(bySeason[0]!.stats.matches).toBe(2);
    expect(bySeason[0]!.stats.goals).toBe(3);
    expect(bySeason[0]!.stats.minutesPlayed).toBe(150);
  });

  it('división por cero → ratios null (0 partidos / 0 minutos)', () => {
    // Una fila con 0 minutos: matches=1 pero minutes=0 → goalsPer90 null.
    const bySeason = careerBySeason([row('2025-26', { minutes_played: 0 })]);
    expect(bySeason[0]!.ratios.goalsPer90).toBeNull();
    // goalsPerMatch sí existe (1 partido): 0 goles / 1 = 0
    expect(bySeason[0]!.ratios.goalsPerMatch).toBe(0);
  });

  it('sin filas → array vacío', () => {
    expect(careerBySeason([])).toEqual([]);
  });
});

describe('careerTotals', () => {
  it('total de carrera = Σ de todas las temporadas; ratios sobre el total (D1)', () => {
    const rows = [
      row('2024-25', { started: true, minutes_played: 90, goals: 1 }),
      row('2024-25', { started: true, minutes_played: 90, goals: 1 }),
      row('2025-26', { started: false, minutes_played: 10, goals: 0 }),
    ];

    const totals = careerTotals(rows);
    expect(totals.stats.matches).toBe(3);
    expect(totals.stats.starts).toBe(2);
    expect(totals.stats.minutesPlayed).toBe(190);
    expect(totals.stats.goals).toBe(2);

    // D1: ratios sobre el AGREGADO de carrera, NO media de los ratios por temporada.
    // 2 goles · 90 / 190 min = 0.947… (la media de medias daría otro valor).
    expect(totals.ratios.goalsPer90).toBeCloseTo((2 * 90) / 190, 6);
    expect(totals.ratios.goalsPerMatch).toBeCloseTo(2 / 3, 6);
  });

  it('los totales coinciden con la suma de careerBySeason', () => {
    const rows = [
      row('2024-25', { minutes_played: 90, goals: 1, assists: 2 }),
      row('2025-26', { minutes_played: 45, goals: 3, assists: 0 }),
      row('2025-26', { minutes_played: 60, goals: 1, assists: 1 }),
    ];
    const totals = careerTotals(rows);
    const bySeason = careerBySeason(rows);
    const sumGoals = bySeason.reduce((a, s) => a + s.stats.goals, 0);
    const sumMin = bySeason.reduce((a, s) => a + s.stats.minutesPlayed, 0);
    expect(sumGoals).toBe(totals.stats.goals);
    expect(sumMin).toBe(totals.stats.minutesPlayed);
  });

  it('sin filas → totales a cero y ratios null', () => {
    const totals = careerTotals([]);
    expect(totals.stats.matches).toBe(0);
    expect(totals.stats.goals).toBe(0);
    expect(totals.ratios.goalsPerMatch).toBeNull();
    expect(totals.ratios.goalsPer90).toBeNull();
  });
});

describe('seasonComparison', () => {
  const rows = [
    row('2024-25', { started: true, minutes_played: 90, goals: 2 }),
    row('2025-26', { started: false, minutes_played: 90, goals: 4 }),
  ];
  const bySeason = careerBySeason(rows); // desc: 2025-26, 2024-25

  it('proyecta una métrica de totales (goles) conservando el orden', () => {
    expect(seasonComparison(bySeason, 'goals')).toEqual([
      { season: '2025-26', value: 4 },
      { season: '2024-25', value: 2 },
    ]);
  });

  it('proyecta una métrica de ratios (% titularidad = startRate)', () => {
    expect(seasonComparison(bySeason, 'startRate')).toEqual([
      { season: '2025-26', value: 0 }, // 0 titular / 1 partido
      { season: '2024-25', value: 1 }, // 1 titular / 1 partido
    ]);
  });

  it('proyecta minutos', () => {
    expect(seasonComparison(bySeason, 'minutesPlayed')).toEqual([
      { season: '2025-26', value: 90 },
      { season: '2024-25', value: 90 },
    ]);
  });

  it('rating: lo lee del campo opcional por temporada (no lo fabrica)', () => {
    const withRating: SeasonMetricInput[] = [
      { ...bySeason[0]!, rating: 7.5 },
      { ...bySeason[1]! }, // sin rating
    ];
    expect(seasonComparison(withRating, 'rating')).toEqual([
      { season: '2025-26', value: 7.5 },
      { season: '2024-25', value: null }, // sin valoraciones → null
    ]);
  });

  it('una temporada sin partidos aparece con valor 0/null según la métrica', () => {
    // careerBySeason no genera temporadas vacías por sí mismo; la UI puede
    // inyectar una temporada "presente pero sin partidos". Simulamos esa entrada.
    const empty: SeasonMetricInput = careerBySeason([])[0] ?? {
      season: '2026-27',
      stats: careerTotals([]).stats,
      ratios: careerTotals([]).ratios,
    };
    expect(seasonComparison([empty], 'goals')).toEqual([
      { season: '2026-27', value: 0 },
    ]);
    expect(seasonComparison([empty], 'goalsPer90')).toEqual([
      { season: '2026-27', value: null },
    ]);
  });
});
