import { describe, it, expect } from 'vitest';
import { matchPhase } from '../phase';
import type { ClockPeriod, PeriodKind } from '../clock';

// Epoch fijo para timestamps deterministas (evita depender del reloj real).
const T0 = 1_700_000_000_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Constructor de una fila de reloj (match_periods proyectada). */
function period(p: Partial<ClockPeriod> & { period: PeriodKind; ordinal: number }): ClockPeriod {
  return {
    baseOffsetSeconds: 0,
    accumulatedSeconds: 0,
    running: false,
    lastStartedAt: null,
    ended: false,
    ...p,
  };
}

const HALF = 25; // duración de media parte (min) → 2ª parte arranca en 25'.

describe('matchPhase — fase', () => {
  it('sin empezar: status not_started', () => {
    const r = matchPhase({ status: 'not_started', periods: [], halfDurationMinutes: HALF, nowMs: T0 });
    expect(r).toEqual({ phase: 'not_started', minute: 0, addedTime: 0 });
  });

  it('sin empezar: live pero sin periodos aún', () => {
    const r = matchPhase({ status: 'live', periods: [], halfDurationMinutes: HALF, nowMs: T0 });
    expect(r.phase).toBe('not_started');
    expect(r.minute).toBe(0);
  });

  it('1ª parte en curso', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) }),
    ];
    const r = matchPhase({ status: 'live', periods, halfDurationMinutes: HALF, nowMs: T0 + 10 * 60_000 });
    expect(r.phase).toBe('first_half');
    expect(r.minute).toBe(10);
    expect(r.addedTime).toBe(0);
  });

  it('1ª parte en pausa (no terminada) sigue siendo primera parte', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: false, accumulatedSeconds: 10 * 60 }),
    ];
    const r = matchPhase({ status: 'live', periods, halfDurationMinutes: HALF, nowMs: T0 + 999_999 });
    expect(r.phase).toBe('first_half');
    expect(r.minute).toBe(10); // congelado: no corre
  });
});

describe('matchPhase — añadido (descuento)', () => {
  it('1ª parte pasada de duración → "+X"', () => {
    // 26 min dentro de una parte de 25' → base congelado en 25, +2.
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) }),
    ];
    const r = matchPhase({ status: 'live', periods, halfDurationMinutes: HALF, nowMs: T0 + 26 * 60_000 });
    expect(r.phase).toBe('first_half');
    expect(r.minute).toBe(25);
    expect(r.addedTime).toBe(2); // 26 - 25 + 1
  });

  it('justo al alcanzar la duración nominal empieza el añadido', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) }),
    ];
    const r = matchPhase({ status: 'live', periods, halfDurationMinutes: HALF, nowMs: T0 + 25 * 60_000 });
    expect(r.minute).toBe(25);
    expect(r.addedTime).toBe(1); // 25 - 25 + 1
  });
});

describe('matchPhase — descanso (congelado)', () => {
  it('1ª terminada, sin 2ª aún → descanso con minuto congelado', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: false, ended: true, accumulatedSeconds: 24 * 60 + 30 }),
    ];
    const base = { status: 'live' as const, periods, halfDurationMinutes: HALF };
    const r1 = matchPhase({ ...base, nowMs: T0 });
    const r2 = matchPhase({ ...base, nowMs: T0 + 5 * 60_000 });
    expect(r1.phase).toBe('half_time');
    expect(r1.minute).toBe(24); // 24:30 → 24', sin añadido
    expect(r1.addedTime).toBe(0);
    // Congelado: no avanza con el paso del tiempo.
    expect(r2).toEqual(r1);
  });
});

describe('matchPhase — 2ª parte con offset', () => {
  const first = period({
    period: 'first_half',
    ordinal: 1,
    running: false,
    ended: true,
    accumulatedSeconds: HALF * 60,
    baseOffsetSeconds: 0,
  });

  it('arranca mostrando la duración de la 1ª parte (25\')', () => {
    const second = period({
      period: 'second_half',
      ordinal: 2,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: HALF * 60, // reloj absoluto tras la 1ª
    });
    const r = matchPhase({
      status: 'live',
      periods: [first, second],
      halfDurationMinutes: HALF,
      nowMs: T0, // 0s dentro de la 2ª
    });
    expect(r.phase).toBe('second_half');
    expect(r.minute).toBe(25);
    expect(r.addedTime).toBe(0);
  });

  it('avanza desde el offset (26\' tras un minuto)', () => {
    const second = period({
      period: 'second_half',
      ordinal: 2,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: HALF * 60,
    });
    const r = matchPhase({
      status: 'live',
      periods: [first, second],
      halfDurationMinutes: HALF,
      nowMs: T0 + 60_000,
    });
    expect(r.minute).toBe(26);
  });

  it('2ª parte en añadido: base congelado en 50\' con "+X"', () => {
    const second = period({
      period: 'second_half',
      ordinal: 2,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: HALF * 60,
    });
    const r = matchPhase({
      status: 'live',
      periods: [first, second],
      halfDurationMinutes: HALF,
      nowMs: T0 + 26 * 60_000, // 26 min dentro de la 2ª
    });
    expect(r.minute).toBe(50); // 25 (offset) + 25 (tope)
    expect(r.addedTime).toBe(2);
  });
});

describe('matchPhase — prórroga', () => {
  it('continúa con el offset acumulado (prórroga a partir de 50\')', () => {
    const first = period({ period: 'first_half', ordinal: 1, ended: true, accumulatedSeconds: HALF * 60, baseOffsetSeconds: 0 });
    const second = period({ period: 'second_half', ordinal: 2, ended: true, accumulatedSeconds: HALF * 60, baseOffsetSeconds: HALF * 60 });
    const extra = period({
      period: 'extra_first',
      ordinal: 3,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: 2 * HALF * 60,
    });
    const r = matchPhase({
      status: 'live',
      periods: [first, second, extra],
      halfDurationMinutes: HALF,
      nowMs: T0 + 5 * 60_000,
    });
    expect(r.phase).toBe('extra_time');
    expect(r.minute).toBe(55); // 2*25 + 5
    expect(r.addedTime).toBe(0);
  });
});

describe('matchPhase — penaltis y fin', () => {
  it('tanda de penaltis: fase penalties, minuto congelado en el fin del tiempo jugado', () => {
    const first = period({ period: 'first_half', ordinal: 1, ended: true, accumulatedSeconds: HALF * 60, baseOffsetSeconds: 0 });
    const second = period({ period: 'second_half', ordinal: 2, ended: true, accumulatedSeconds: HALF * 60, baseOffsetSeconds: HALF * 60 });
    const shootout = period({ period: 'penalties', ordinal: 5, running: true, lastStartedAt: iso(T0), baseOffsetSeconds: 2 * HALF * 60 });
    const r = matchPhase({
      status: 'live',
      periods: [first, second, shootout],
      halfDurationMinutes: HALF,
      nowMs: T0 + 3 * 60_000,
    });
    expect(r.phase).toBe('penalties');
    // El minuto sale de la 2ª parte (último periodo jugado), no de la tanda.
    expect(r.minute).toBe(50);
  });

  it('fin: status closed → finished, minuto congelado', () => {
    const first = period({ period: 'first_half', ordinal: 1, ended: true, accumulatedSeconds: HALF * 60, baseOffsetSeconds: 0 });
    const second = period({ period: 'second_half', ordinal: 2, ended: true, accumulatedSeconds: 24 * 60, baseOffsetSeconds: HALF * 60 });
    const base = { status: 'closed' as const, periods: [first, second], halfDurationMinutes: HALF };
    const r1 = matchPhase({ ...base, nowMs: T0 });
    const r2 = matchPhase({ ...base, nowMs: T0 + 10 * 60_000 });
    expect(r1.phase).toBe('finished');
    expect(r1.minute).toBe(49); // 25 (offset) + 24 jugados en la 2ª
    expect(r2).toEqual(r1); // congelado
  });
});

describe('matchPhase — determinismo', () => {
  it('mismos datos → mismo resultado (reconstruible por cualquiera)', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) }),
    ];
    const call = () => matchPhase({ status: 'live', periods, halfDurationMinutes: HALF, nowMs: T0 + 7 * 60_000 });
    expect(call()).toEqual(call());
  });
});
