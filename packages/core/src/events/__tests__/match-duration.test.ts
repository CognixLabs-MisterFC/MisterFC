import { describe, it, expect } from 'vitest';
import {
  computeEndsAt,
  computeCitacionAt,
  matchBlockMinutes,
  DEFAULT_CITACION_LEAD_MINUTES,
  type MatchBlockShape,
} from '../match-duration';

/**
 * El bloque de un partido = periodos × duración + (periodos − 1) × descanso.
 *
 * Hasta la migración 20261124000000 la cuenta era `2 × duración + 15` con los dos
 * números a mano. Para querubines —tres tiempos de doce con descansos de cuatro—
 * eso daba 39 minutos para un partido que ocupa 44: la sugerencia era MÁS CORTA
 * que el juego. De ahí el caso del querubín y el invariante del final.
 */
const dosPartes = (duracion: number, descanso = 15): MatchBlockShape => ({
  halfDurationMinutes: duracion,
  periodCount: 2,
  breakMinutes: descanso,
});

const QUERUBIN: MatchBlockShape = {
  halfDurationMinutes: 12,
  periodCount: 3,
  breakMinutes: 4,
};

describe('matchBlockMinutes', () => {
  it('EL CASO QUE LA FÓRMULA VIEJA HACÍA MAL: querubines son 44, no 39', () => {
    // 12 + 4 + 12 + 4 + 12. La vieja (2 × 12 + 15) daba 39.
    expect(matchBlockMinutes(QUERUBIN)).toBe(44);
    expect(matchBlockMinutes(QUERUBIN)).not.toBe(2 * 12 + 15);
  });

  it('con dos periodos da exactamente lo de siempre (las siete duraciones)', () => {
    expect(matchBlockMinutes(dosPartes(15))).toBe(45);
    expect(matchBlockMinutes(dosPartes(20))).toBe(55);
    expect(matchBlockMinutes(dosPartes(25))).toBe(65);
    expect(matchBlockMinutes(dosPartes(30))).toBe(75);
    expect(matchBlockMinutes(dosPartes(35))).toBe(85);
    expect(matchBlockMinutes(dosPartes(40))).toBe(95);
    expect(matchBlockMinutes(dosPartes(45))).toBe(105);
  });

  it('los tres valores del catálogo de producción: 44, 55 y 105', () => {
    // Los mismos que imprime el informe de la migración 20261124000000, medidos
    // en producción: querubín 3 × 12 con 4, prebenjamín 2 × 20 con 15, sénior
    // 2 × 45 con 15.
    expect(matchBlockMinutes(QUERUBIN)).toBe(44);
    expect(matchBlockMinutes(dosPartes(20))).toBe(55);
    expect(matchBlockMinutes(dosPartes(45))).toBe(105);
  });

  it('descanso 0 es LEGÍTIMO, no «sin dato»: 2 × 45 del tirón son 90', () => {
    expect(matchBlockMinutes(dosPartes(45, 0))).toBe(90);
    expect(matchBlockMinutes({ ...QUERUBIN, breakMinutes: 0 })).toBe(36);
  });

  it('un periodo único no suma ningún descanso', () => {
    expect(
      matchBlockMinutes({ halfDurationMinutes: 20, periodCount: 1, breakMinutes: 15 }),
    ).toBe(20);
  });

  it('sin duración → null (no inventamos)', () => {
    expect(matchBlockMinutes(dosPartes(0))).toBeNull();
    expect(matchBlockMinutes(dosPartes(-10))).toBeNull();
    expect(matchBlockMinutes({ ...dosPartes(45), halfDurationMinutes: null })).toBeNull();
    expect(matchBlockMinutes({ ...dosPartes(45), halfDurationMinutes: undefined })).toBeNull();
  });

  it('sin periodos o sin descanso → null', () => {
    expect(matchBlockMinutes({ ...dosPartes(45), periodCount: null })).toBeNull();
    expect(matchBlockMinutes({ ...dosPartes(45), periodCount: 0 })).toBeNull();
    expect(matchBlockMinutes({ ...dosPartes(45), breakMinutes: null })).toBeNull();
    expect(matchBlockMinutes({ ...dosPartes(45), breakMinutes: undefined })).toBeNull();
    expect(matchBlockMinutes({ ...dosPartes(45), breakMinutes: -1 })).toBeNull();
  });

  it('EL INVARIANTE: el bloque nunca es más corto que el juego', () => {
    // Es lo único que la sugerencia no puede permitirse, y es justo lo que la
    // fórmula vieja hacía con tres tiempos.
    const formas: MatchBlockShape[] = [
      QUERUBIN,
      dosPartes(15),
      dosPartes(20),
      dosPartes(45),
      dosPartes(45, 0),
      { halfDurationMinutes: 12, periodCount: 3, breakMinutes: 0 },
    ];
    for (const f of formas) {
      const bloque = matchBlockMinutes(f);
      const juego = (f.periodCount as number) * (f.halfDurationMinutes as number);
      expect(bloque).not.toBeNull();
      expect(bloque as number).toBeGreaterThanOrEqual(juego);
    }
  });
});

describe('computeEndsAt', () => {
  it('querubines: 10:00 + 44 min', () => {
    expect(computeEndsAt('2026-04-12T10:00:00.000Z', QUERUBIN)).toBe(
      '2026-04-12T10:44:00.000Z',
    );
  });

  it('alevín (2 × 30): 16:00 + 75 min', () => {
    expect(computeEndsAt('2026-05-31T16:00:00.000Z', dosPartes(30))).toBe(
      '2026-05-31T17:15:00.000Z',
    );
  });

  it('juvenil/amateur (2 × 45): 16:00 + 105 min', () => {
    expect(computeEndsAt('2026-05-31T16:00:00.000Z', dosPartes(45))).toBe(
      '2026-05-31T17:45:00.000Z',
    );
  });

  it('prebenjamín (2 × 20): 10:00 + 55 min', () => {
    expect(computeEndsAt('2026-04-12T10:00:00.000Z', dosPartes(20))).toBe(
      '2026-04-12T10:55:00.000Z',
    );
  });

  it('atraviesa medianoche correctamente (juvenil)', () => {
    // 22:15 + 105 = 24:00 = next day 00:00 UTC
    expect(computeEndsAt('2026-05-31T22:15:00.000Z', dosPartes(45))).toBe(
      '2026-06-01T00:00:00.000Z',
    );
  });

  it('starts_at vacío/null/inválido → null', () => {
    expect(computeEndsAt(null, dosPartes(45))).toBeNull();
    expect(computeEndsAt(undefined, dosPartes(45))).toBeNull();
    expect(computeEndsAt('', dosPartes(45))).toBeNull();
    expect(computeEndsAt('not-an-iso', dosPartes(45))).toBeNull();
  });

  it('forma incompleta → null (la UI deja el campo vacío)', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeEndsAt(start, dosPartes(0))).toBeNull();
    expect(computeEndsAt(start, { ...dosPartes(45), periodCount: null })).toBeNull();
    expect(computeEndsAt(start, { ...dosPartes(45), breakMinutes: null })).toBeNull();
  });
});

describe('computeCitacionAt', () => {
  it('default 60 min antes', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start)).toBe('2026-05-31T15:00:00.000Z');
  });

  it('lead custom 120 min', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start, 120)).toBe('2026-05-31T14:00:00.000Z');
  });

  it('lead = 0 → misma hora que kickoff', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start, 0)).toBe('2026-05-31T16:00:00.000Z');
  });

  it('lead negativo se clampa a 0 (no avanza al futuro)', () => {
    const start = '2026-05-31T16:00:00.000Z';
    expect(computeCitacionAt(start, -30)).toBe('2026-05-31T16:00:00.000Z');
  });

  it('atraviesa medianoche correctamente (citacion del día anterior)', () => {
    const start = '2026-06-01T00:30:00.000Z';
    expect(computeCitacionAt(start, 60)).toBe('2026-05-31T23:30:00.000Z');
  });

  it('starts_at vacío/null → null', () => {
    expect(computeCitacionAt(null)).toBeNull();
    expect(computeCitacionAt(undefined)).toBeNull();
    expect(computeCitacionAt('')).toBeNull();
  });

  it('starts_at inválido → null', () => {
    expect(computeCitacionAt('not-an-iso')).toBeNull();
  });

  it('DEFAULT_CITACION_LEAD_MINUTES = 60', () => {
    expect(DEFAULT_CITACION_LEAD_MINUTES).toBe(60);
  });
});
