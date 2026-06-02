import { describe, it, expect } from 'vitest';
import { type ClockPeriod } from '../clock';
import {
  PLAYER_EVENT_TYPES,
  isPlayerEventType,
  playerEventClockFields,
} from '../event';

const T0_ISO = '2026-06-02T16:00:00.000Z';
const T0 = Date.parse(T0_ISO);
const at = (s: number) => T0 + s * 1000;

function period(overrides: Partial<ClockPeriod> = {}): ClockPeriod {
  return {
    period: 'first_half',
    ordinal: 1,
    baseOffsetSeconds: 0,
    accumulatedSeconds: 0,
    running: false,
    lastStartedAt: null,
    ended: false,
    ...overrides,
  };
}

describe('isPlayerEventType', () => {
  it('acepta los 4 tipos sobre jugador', () => {
    for (const t of PLAYER_EVENT_TYPES) expect(isPlayerEventType(t)).toBe(true);
  });
  it('rechaza eventos de campo / cambio', () => {
    for (const t of ['corner', 'foul', 'offside', 'shot', 'substitution']) {
      expect(isPlayerEventType(t)).toBe(false);
    }
  });
});

describe('playerEventClockFields', () => {
  it('1ª parte corriendo: clock/period/minuto del instante', () => {
    const p = period({ running: true, lastStartedAt: T0_ISO });
    expect(playerEventClockFields([p], at(65))).toEqual({
      clockSeconds: 65,
      period: 'first_half',
      displayMinute: 1,
    });
  });

  it('2ª parte (Alevín, base 30:00) corriendo: minuto absoluto', () => {
    const first = period({ accumulatedSeconds: 1800, ended: true });
    const second = period({
      period: 'second_half',
      ordinal: 2,
      baseOffsetSeconds: 1800,
      running: true,
      lastStartedAt: T0_ISO,
    });
    // 30:00 + 2:00 = 32:00 → 1920s, periodo 2, minuto 32.
    expect(playerEventClockFields([first, second], at(120))).toEqual({
      clockSeconds: 1920,
      period: 'second_half',
      displayMinute: 32,
    });
  });

  it('en pausa: el reloj queda congelado (una tarjeta en parada cuenta el minuto detenido)', () => {
    const p = period({ accumulatedSeconds: 600 }); // 10:00, en pausa
    expect(playerEventClockFields([p], at(9999))).toEqual({
      clockSeconds: 600,
      period: 'first_half',
      displayMinute: 10,
    });
  });

  it('sin periodos: 0 y first_half por defecto (la app impide registrar fuera de vivo)', () => {
    expect(playerEventClockFields([], at(0))).toEqual({
      clockSeconds: 0,
      period: 'first_half',
      displayMinute: 0,
    });
  });
});
