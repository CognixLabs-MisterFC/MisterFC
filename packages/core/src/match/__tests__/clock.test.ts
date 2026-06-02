import { describe, it, expect } from 'vitest';
import {
  type ClockPeriod,
  PERIOD_ORDER,
  periodClockSeconds,
  clockSecondsAt,
  currentPeriod,
  isClockRunning,
  isAtBreak,
  nextPeriodAfter,
  buildNextPeriod,
  pauseClockPatch,
  resumeClockPatch,
  endPeriodPatch,
  adjustClockPatch,
  formatClock,
  displayMinute,
} from '../clock';

// Instante de referencia para todos los tests (ISO + ms). Date.now() NO se usa:
// el motor recibe `nowMs`/`nowIso` por parámetro (puro y determinista).
const T0_ISO = '2026-06-02T16:00:00.000Z';
const T0 = Date.parse(T0_ISO);
const at = (secondsAfterT0: number) => T0 + secondsAfterT0 * 1000;

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

describe('periodClockSeconds', () => {
  it('en pausa = base + accumulated (ignora el wall-clock)', () => {
    const p = period({ baseOffsetSeconds: 100, accumulatedSeconds: 50 });
    expect(periodClockSeconds(p, at(9999))).toBe(150);
  });

  it('corriendo = base + accumulated + (now - last_started)', () => {
    const p = period({
      accumulatedSeconds: 30,
      running: true,
      lastStartedAt: T0_ISO,
    });
    expect(periodClockSeconds(p, at(70))).toBe(100); // 30 + 70
  });

  it('nunca retrocede si el reloj del cliente va atrasado (now < last_started)', () => {
    const p = period({
      accumulatedSeconds: 30,
      running: true,
      lastStartedAt: new Date(at(100)).toISOString(), // arrancó "después" de now
    });
    expect(periodClockSeconds(p, at(40))).toBe(30); // elapsed clamped a 0
  });
});

describe('clockSecondsAt — arranque / pausa', () => {
  it('sin periodos → 0', () => {
    expect(clockSecondsAt([], T0)).toBe(0);
  });

  it('1ª parte corriendo 65s → 65', () => {
    const p = period({ running: true, lastStartedAt: T0_ISO });
    expect(clockSecondsAt([p], at(65))).toBe(65);
  });

  it('pausa: pliega lo corrido y deja de avanzar', () => {
    const running = period({ running: true, lastStartedAt: T0_ISO });
    const patch = pauseClockPatch(running, at(80));
    expect(patch).toEqual({
      accumulatedSeconds: 80,
      running: false,
      lastStartedAt: null,
    });
    const paused = period({ accumulatedSeconds: 80 });
    // El reloj ya no avanza aunque pase el tiempo.
    expect(clockSecondsAt([paused], at(500))).toBe(80);
  });

  it('reanudar vuelve a contar desde el instante de reanudación', () => {
    const patch = resumeClockPatch(new Date(at(120)).toISOString());
    expect(patch.running).toBe(true);
    const resumed = period({
      accumulatedSeconds: 80,
      running: true,
      lastStartedAt: new Date(at(120)).toISOString(),
    });
    expect(clockSecondsAt([resumed], at(150))).toBe(110); // 80 + 30
  });
});

describe('clockSecondsAt — descanso (sin periodo corriendo)', () => {
  it('1ª parte terminada a 45:00, 2ª aún no creada → reloj congelado en 2700', () => {
    const firstEnded = period({ accumulatedSeconds: 2700, ended: true });
    expect(clockSecondsAt([firstEnded], at(99999))).toBe(2700);
    expect(isAtBreak([firstEnded])).toBe(true);
    expect(isClockRunning([firstEnded])).toBe(false);
  });

  it('descanso real entre dos periodos no suma tiempo', () => {
    const first = period({ accumulatedSeconds: 2700, ended: true });
    // 2ª parte creada, base_offset = 2700, aún sin arrancar.
    const second = period({
      period: 'second_half',
      ordinal: 2,
      baseOffsetSeconds: 2700,
    });
    expect(clockSecondsAt([first, second], at(0))).toBe(2700);
  });
});

describe('clockSecondsAt — segunda parte / prórroga (monótono)', () => {
  it('2ª parte corriendo arranca desde base_offset (45:00) y sube', () => {
    const first = period({ accumulatedSeconds: 2700, ended: true });
    const second = period({
      period: 'second_half',
      ordinal: 2,
      baseOffsetSeconds: 2700,
      running: true,
      lastStartedAt: T0_ISO,
    });
    expect(clockSecondsAt([first, second], at(120))).toBe(2820); // 2700 + 120
  });

  it('prórroga: extra_first parte del reloj acumulado de los 90+', () => {
    const periods: ClockPeriod[] = [
      period({ accumulatedSeconds: 2700, ended: true }),
      period({ period: 'second_half', ordinal: 2, baseOffsetSeconds: 2700, accumulatedSeconds: 2760, ended: true }),
    ];
    const next = buildNextPeriod(periods, at(0), T0_ISO);
    expect(next).not.toBeNull();
    expect(next?.period).toBe('extra_first');
    expect(next?.ordinal).toBe(3);
    expect(next?.baseOffsetSeconds).toBe(5460); // 2700 + 2760
    expect(next?.running).toBe(true);
  });

  it('categoría Alevín (30 min/parte): la 2ª arranca en 30:00, NO en 45:00', () => {
    // El motor NO conoce la duración de categoría: el base_offset sale del
    // juego REAL acumulado. Un Alevín que cierra la 1ª a 30:00 (1800s) continúa
    // la 2ª desde 1800, no desde 2700. Nada asume 45.
    const firstHalf = period({ accumulatedSeconds: 1800, ended: true });
    const next = buildNextPeriod([firstHalf], at(0), T0_ISO);
    expect(next?.period).toBe('second_half');
    expect(next?.baseOffsetSeconds).toBe(1800); // 30:00, no 2700
    const secondHalf = period({
      period: 'second_half',
      ordinal: 2,
      baseOffsetSeconds: 1800,
      running: true,
      lastStartedAt: T0_ISO,
    });
    expect(clockSecondsAt([firstHalf, secondHalf], at(60))).toBe(1860); // 31:00
  });

  it('el orden del array no altera el reloj (máximo robusto)', () => {
    const first = period({ accumulatedSeconds: 2700, ended: true });
    const second = period({
      period: 'second_half',
      ordinal: 2,
      baseOffsetSeconds: 2700,
      running: true,
      lastStartedAt: T0_ISO,
    });
    expect(clockSecondsAt([second, first], at(60))).toBe(
      clockSecondsAt([first, second], at(60)),
    );
  });
});

describe('endPeriodPatch', () => {
  it('pliega lo corrido y marca ended', () => {
    const running = period({
      accumulatedSeconds: 2640,
      running: true,
      lastStartedAt: T0_ISO,
    });
    expect(endPeriodPatch(running, at(60))).toEqual({
      accumulatedSeconds: 2700,
      running: false,
      lastStartedAt: null,
      ended: true,
    });
  });
});

describe('adjustClockPatch — ajuste manual', () => {
  it('suma delta a un periodo en pausa', () => {
    const paused = period({ accumulatedSeconds: 100 });
    expect(adjustClockPatch(paused, 30, T0, T0_ISO)).toEqual({
      accumulatedSeconds: 130,
    });
  });

  it('resta delta sin bajar de 0', () => {
    const paused = period({ accumulatedSeconds: 20 });
    expect(adjustClockPatch(paused, -60, T0, T0_ISO)).toEqual({
      accumulatedSeconds: 0,
    });
  });

  it('corriendo: pliega lo corrido, aplica delta y re-ancla en now', () => {
    const running = period({
      accumulatedSeconds: 100,
      running: true,
      lastStartedAt: T0_ISO,
    });
    // a los 50s corriendo (clock = 150), +30 → accumulated = 180, re-anclado.
    const patch = adjustClockPatch(running, 30, at(50), new Date(at(50)).toISOString());
    expect(patch.accumulatedSeconds).toBe(180);
    expect(patch.lastStartedAt).toBe(new Date(at(50)).toISOString());
    // El reloj inmediatamente tras el ajuste = 180 (sin saltos).
    const after = period({
      accumulatedSeconds: 180,
      running: true,
      lastStartedAt: new Date(at(50)).toISOString(),
    });
    expect(clockSecondsAt([after], at(50))).toBe(180);
  });
});

describe('currentPeriod', () => {
  it('sin periodos → null', () => {
    expect(currentPeriod([])).toBeNull();
  });

  it('devuelve el que corre', () => {
    const first = period({ accumulatedSeconds: 2700, ended: true });
    const second = period({ period: 'second_half', ordinal: 2, baseOffsetSeconds: 2700, running: true, lastStartedAt: T0_ISO });
    expect(currentPeriod([first, second])?.period).toBe('second_half');
  });

  it('en descanso → el de mayor ordinal ya jugado', () => {
    const first = period({ accumulatedSeconds: 2700, ended: true });
    expect(currentPeriod([first])?.period).toBe('first_half');
  });
});

describe('nextPeriodAfter / buildNextPeriod', () => {
  it('vacío → first_half (ordinal 1), arranca corriendo', () => {
    expect(nextPeriodAfter([])).toEqual({ period: 'first_half', ordinal: 1 });
    const first = buildNextPeriod([], T0, T0_ISO);
    expect(first).toMatchObject({
      period: 'first_half',
      ordinal: 1,
      baseOffsetSeconds: 0,
      accumulatedSeconds: 0,
      running: true,
      lastStartedAt: T0_ISO,
      ended: false,
    });
  });

  it('tras first_half → second_half', () => {
    const first = period({ ended: true, accumulatedSeconds: 2700 });
    expect(nextPeriodAfter([first])).toEqual({ period: 'second_half', ordinal: 2 });
  });

  it('agotado el catálogo → null', () => {
    const all = PERIOD_ORDER.map((p, i) =>
      period({ period: p, ordinal: i + 1, ended: true }),
    );
    expect(nextPeriodAfter(all)).toBeNull();
    expect(buildNextPeriod(all, T0, T0_ISO)).toBeNull();
  });

  it('penalties es el último', () => {
    expect(PERIOD_ORDER[PERIOD_ORDER.length - 1]).toBe('penalties');
  });
});

describe('isAtBreak', () => {
  it('partido sin empezar → false', () => {
    expect(isAtBreak([])).toBe(false);
  });

  it('jugando → false', () => {
    const running = period({ running: true, lastStartedAt: T0_ISO });
    expect(isAtBreak([running])).toBe(false);
  });

  it('fin de partido (penalties terminada) → false (no es descanso)', () => {
    const all = PERIOD_ORDER.map((p, i) =>
      period({ period: p, ordinal: i + 1, ended: true }),
    );
    expect(isAtBreak(all)).toBe(false);
  });
});

describe('formatClock / displayMinute', () => {
  it('formatea MM:SS con padding', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(2700)).toBe('45:00');
  });

  it('minutos > 99 sin tope (prórroga)', () => {
    expect(formatClock(6000)).toBe('100:00');
  });

  it('negativo o fraccional se sanea', () => {
    expect(formatClock(-10)).toBe('00:00');
    expect(formatClock(90.9)).toBe('01:30');
  });

  it('displayMinute redondea hacia abajo', () => {
    expect(displayMinute(0)).toBe(0);
    expect(displayMinute(59)).toBe(0);
    expect(displayMinute(60)).toBe(1);
    expect(displayMinute(2759)).toBe(45);
  });
});
