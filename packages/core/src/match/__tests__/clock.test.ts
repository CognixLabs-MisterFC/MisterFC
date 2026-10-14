import { describe, it, expect } from 'vitest';
import {
  type ClockPeriod,
  periodOrder,
  periodClockSeconds,
  clockSecondsAt,
  currentPeriod,
  isClockRunning,
  isAtBreak,
  nextPeriodAfter,
  nextRegularPeriod,
  nextExtraPeriod,
  canFinishMatch,
  isRegularPeriod,
  isExtraPeriod,
  asPeriodCount,
  regularPeriods,
  periodLabelKey,
  PERIOD_KINDS,
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
    expect(isAtBreak([firstEnded], 2)).toBe(true);
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
    const next = buildNextPeriod(periods, at(0), T0_ISO, 2);
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
    const next = buildNextPeriod([firstHalf], at(0), T0_ISO, 2);
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
    expect(nextPeriodAfter([], 2)).toEqual({ period: 'first_half', ordinal: 1 });
    const first = buildNextPeriod([], T0, T0_ISO, 2);
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
    expect(nextPeriodAfter([first], 2)).toEqual({ period: 'second_half', ordinal: 2 });
  });

  it('agotado el catálogo → null', () => {
    const all = periodOrder(2).map((p, i) =>
      period({ period: p, ordinal: i + 1, ended: true }),
    );
    expect(nextPeriodAfter(all, 2)).toBeNull();
    expect(buildNextPeriod(all, T0, T0_ISO, 2)).toBeNull();
  });

  it('penalties es el último', () => {
    expect(periodOrder(2)[periodOrder(2).length - 1]).toBe('penalties');
  });
});

describe('isAtBreak', () => {
  it('partido sin empezar → false', () => {
    expect(isAtBreak([], 2)).toBe(false);
  });

  it('jugando → false', () => {
    const running = period({ running: true, lastStartedAt: T0_ISO });
    expect(isAtBreak([running], 2)).toBe(false);
  });

  it('fin de partido (penalties terminada) → false (no es descanso)', () => {
    const all = periodOrder(2).map((p, i) =>
      period({ period: p, ordinal: i + 1, ended: true }),
    );
    expect(isAtBreak(all, 2)).toBe(false);
  });
});

// F7.7b — flujo de periodos: 2 partes → finalizar; prórroga OPCIONAL.
describe('flujo de periodos (7.7b): regular vs prórroga + finalizar', () => {
  const ended = (p: ClockPeriod['period'], ordinal: number) =>
    period({ period: p, ordinal, ended: true });
  const running = (p: ClockPeriod['period'], ordinal: number) =>
    period({ period: p, ordinal, running: true, lastStartedAt: T0_ISO });

  it('clasifica periodos regulares vs prórroga', () => {
    expect(isRegularPeriod('first_half', 2)).toBe(true);
    expect(isRegularPeriod('second_half', 2)).toBe(true);
    expect(isExtraPeriod('extra_first')).toBe(true);
    expect(isExtraPeriod('extra_second')).toBe(true);
    // Penaltis no es prórroga jugable (no entra en el flujo).
    expect(isExtraPeriod('penalties')).toBe(false);
    expect(isRegularPeriod('extra_first', 2)).toBe(false);
  });

  it('nextRegularPeriod: 1ª → 2ª → null (tras la 2ª no fuerza prórroga)', () => {
    expect(nextRegularPeriod([], 2)).toEqual({ period: 'first_half', ordinal: 1 });
    expect(nextRegularPeriod([ended('first_half', 1)], 2)).toEqual({
      period: 'second_half',
      ordinal: 2,
    });
    expect(
      nextRegularPeriod([ended('first_half', 1), ended('second_half', 2)], 2),
    ).toBeNull();
  });

  it('nextExtraPeriod: solo tras el tiempo reglamentario; 1ª → 2ª → null', () => {
    // Antes de acabar el reglamentario no hay prórroga disponible.
    expect(nextExtraPeriod([ended('first_half', 1)], 2)).toBeNull();
    // Tras la 2ª parte → 1ª prórroga.
    expect(
      nextExtraPeriod([ended('first_half', 1), ended('second_half', 2)], 2),
    ).toEqual({ period: 'extra_first', ordinal: 3 });
    // Tras la 1ª prórroga → 2ª prórroga.
    expect(
      nextExtraPeriod(
        [ended('first_half', 1), ended('second_half', 2), ended('extra_first', 3)],
        2,
      ),
    ).toEqual({ period: 'extra_second', ordinal: 4 });
    // Tras la 2ª prórroga → no hay más prórroga (penaltis no se ofrece).
    expect(
      nextExtraPeriod(
        [
          ended('first_half', 1),
          ended('second_half', 2),
          ended('extra_first', 3),
          ended('extra_second', 4),
        ],
        2,
      ),
    ).toBeNull();
  });

  it('canFinishMatch: solo con el reglamentario cubierto y sin reloj corriendo', () => {
    expect(canFinishMatch([], 2)).toBe(false);
    // En el descanso (solo 1ª parte) NO se puede finalizar.
    expect(canFinishMatch([ended('first_half', 1)], 2)).toBe(false);
    // 2ª parte corriendo → no.
    expect(canFinishMatch([ended('first_half', 1), running('second_half', 2)], 2)).toBe(false);
    // 2ª parte terminada → SÍ (acción principal: finalizar; prórroga opcional).
    expect(canFinishMatch([ended('first_half', 1), ended('second_half', 2)], 2)).toBe(true);
  });

  it('flujo por defecto: 2 partes → FINALIZAR (sin prórroga forzada)', () => {
    // Arranque.
    let periods: ClockPeriod[] = [running('first_half', 1)];
    expect(canFinishMatch(periods, 2)).toBe(false);
    // Fin 1ª → descanso → siguiente regular = 2ª parte.
    periods = [ended('first_half', 1)];
    expect(nextRegularPeriod(periods, 2)).toEqual({ period: 'second_half', ordinal: 2 });
    expect(nextExtraPeriod(periods, 2)).toBeNull();
    // 2ª parte y su fin.
    periods = [ended('first_half', 1), ended('second_half', 2)];
    // Ya no hay regular pendiente; se puede finalizar; la prórroga es opcional.
    expect(nextRegularPeriod(periods, 2)).toBeNull();
    expect(canFinishMatch(periods, 2)).toBe(true);
    expect(nextExtraPeriod(periods, 2)).toEqual({ period: 'extra_first', ordinal: 3 });
  });

  it('con prórroga: 4 periodos → FINALIZAR', () => {
    let periods: ClockPeriod[] = [
      ended('first_half', 1),
      ended('second_half', 2),
    ];
    // Añadir prórroga (1ª) y terminarla.
    periods = [...periods, ended('extra_first', 3)];
    expect(canFinishMatch(periods, 2)).toBe(true); // puede finalizar entre prórrogas
    expect(nextExtraPeriod(periods, 2)).toEqual({ period: 'extra_second', ordinal: 4 });
    // 2ª prórroga y su fin → 4 periodos jugados.
    periods = [...periods, ended('extra_second', 4)];
    expect(periods).toHaveLength(4);
    expect(canFinishMatch(periods, 2)).toBe(true);
    expect(nextExtraPeriod(periods, 2)).toBeNull(); // no se fuerza nada más
    expect(nextRegularPeriod(periods, 2)).toBeNull();
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

// ─────────────────────────────────────────────────────────────────────────────
// LOS TRES TIEMPOS (querubines, `categories.period_count` = 3).
//
// Hasta la migración 20261121000000 un partido tenía dos partes porque la LISTA
// de periodos tenía dos, no porque nadie lo hubiera decidido. Estos tests miden
// el caso de TRES, que es el que no existía: antes no había ni uno.
// ─────────────────────────────────────────────────────────────────────────────
describe('tres tiempos: el orden depende de la categoría', () => {
  it('con tres, el tercer tiempo va DETRÁS de la 2ª y ANTES de la prórroga', () => {
    expect(periodOrder(3)).toEqual([
      'first_half',
      'second_half',
      'third_period',
      'extra_first',
      'extra_second',
      'penalties',
    ]);
  });

  it('con dos, el tercer tiempo NO está en el orden (nada cambia para los demás)', () => {
    expect(periodOrder(2)).toEqual([
      'first_half',
      'second_half',
      'extra_first',
      'extra_second',
      'penalties',
    ]);
    expect(periodOrder(2)).not.toContain('third_period');
  });

  it('el catálogo de valores válidos tiene los SEIS (es lo que valida el CHECK)', () => {
    // Sin orden: esta lista es para validar lo que llega de fuera. El orden lo
    // da periodOrder, que depende de la categoría.
    expect([...PERIOD_KINDS].sort()).toEqual(
      [
        'extra_first',
        'extra_second',
        'first_half',
        'penalties',
        'second_half',
        'third_period',
      ].sort(),
    );
  });

  it('regularPeriods: tres son reglamentarios con 3, dos con 2', () => {
    expect(regularPeriods(3)).toEqual(['first_half', 'second_half', 'third_period']);
    expect(regularPeriods(2)).toEqual(['first_half', 'second_half']);
    expect(isRegularPeriod('third_period', 3)).toBe(true);
    // En una categoría de dos partes, una fila `third_period` no es tiempo
    // reglamentario: es un dato de otra época.
    expect(isRegularPeriod('third_period', 2)).toBe(false);
  });

  it('LOS ORDINALES DE LA PRÓRROGA SE CORREN: extra_first pasa de 3 a 4', () => {
    // Esto importa de verdad: `match_periods` tiene UNIQUE(event_id, ordinal), y
    // en producción hay 22 filas con extra_first en el ordinal 3 — justo el que
    // ocupa el tercer tiempo. Un partido de tres tiempos CON prórroga va 1..6.
    const con2 = periodOrder(2);
    const con3 = periodOrder(3);
    expect(con2.indexOf('extra_first') + 1).toBe(3);
    expect(con3.indexOf('extra_first') + 1).toBe(4);
    expect(con3.indexOf('extra_second') + 1).toBe(5);
    expect(con3.indexOf('penalties') + 1).toBe(6);
  });
});

describe('asPeriodCount: lo que trae la base, traído al dominio', () => {
  it('3 es 3; todo lo demás es 2 (ante la duda, el partido de siempre)', () => {
    expect(asPeriodCount(3)).toBe(3);
    expect(asPeriodCount(2)).toBe(2);
    // null = el join no trajo la categoría; undefined = la columna no viajó.
    expect(asPeriodCount(null)).toBe(2);
    expect(asPeriodCount(undefined)).toBe(2);
    // Valores que el CHECK de la base no deja guardar, por si llegan por otra
    // puerta (un tipo generado a mano, un RPC nuevo): no revientan, caen en 2.
    expect(asPeriodCount(1)).toBe(2);
    expect(asPeriodCount(4)).toBe(2);
    expect(asPeriodCount(Number.NaN)).toBe(2);
  });
});

describe('tres tiempos: la secuencia completa', () => {
  const ended = (p: ClockPeriod['period'], ordinal: number) =>
    period({ period: p, ordinal, ended: true });

  it('nextPeriodAfter recorre los seis con sus ordinales 1..6', () => {
    const vistos: Array<{ period: string; ordinal: number }> = [];
    let periods: ClockPeriod[] = [];
    for (;;) {
      const next = nextPeriodAfter(periods, 3);
      if (!next) break;
      vistos.push(next);
      periods = [...periods, ended(next.period, next.ordinal)];
    }
    expect(vistos).toEqual([
      { period: 'first_half', ordinal: 1 },
      { period: 'second_half', ordinal: 2 },
      { period: 'third_period', ordinal: 3 },
      { period: 'extra_first', ordinal: 4 },
      { period: 'extra_second', ordinal: 5 },
      { period: 'penalties', ordinal: 6 },
    ]);
    // Seis filas, seis ordinales distintos: representable con el UNIQUE.
    expect(new Set(periods.map((p) => p.ordinal)).size).toBe(6);
  });

  it('nextRegularPeriod: tras las dos primeras TODAVÍA queda el tercer tiempo', () => {
    const dos = [ended('first_half', 1), ended('second_half', 2)];
    // El contraste con la categoría de dos, que es donde estaba el agujero.
    expect(nextRegularPeriod(dos, 2)).toBeNull();
    expect(nextRegularPeriod(dos, 3)).toEqual({ period: 'third_period', ordinal: 3 });
    // Y tras el tercero ya no queda reglamentario.
    expect(
      nextRegularPeriod([...dos, ended('third_period', 3)], 3),
    ).toBeNull();
  });

  it('nextExtraPeriod: no hay prórroga mientras falte el tercer tiempo', () => {
    const dos = [ended('first_half', 1), ended('second_half', 2)];
    expect(nextExtraPeriod(dos, 3)).toBeNull();
    expect(nextExtraPeriod([...dos, ended('third_period', 3)], 3)).toEqual({
      period: 'extra_first',
      ordinal: 4,
    });
  });

  it('EL FRENO: no se puede finalizar con el tercer tiempo sin jugar', () => {
    const dos = [ended('first_half', 1), ended('second_half', 2)];
    // Esto es lo que hacía mal el código viejo, que buscaba 'second_half' a
    // mano: en un partido de querubines dejaba finalizar con doce minutos
    // enteros por jugar, y el marcador se consolidaba ahí.
    expect(canFinishMatch(dos, 3)).toBe(false);
    expect(canFinishMatch([...dos, ended('third_period', 3)], 3)).toBe(true);
    // Mismo estado, categoría de dos: sí se puede. La diferencia es la categoría.
    expect(canFinishMatch(dos, 2)).toBe(true);
  });

  it('finalizar sigue siendo opcional tras cada prórroga', () => {
    const tres = [
      ended('first_half', 1),
      ended('second_half', 2),
      ended('third_period', 3),
    ];
    expect(canFinishMatch([...tres, ended('extra_first', 4)], 3)).toBe(true);
    expect(canFinishMatch([...tres, ended('extra_first', 4), ended('extra_second', 5)], 3)).toBe(
      true,
    );
  });

  it('con un periodo a medias no se finaliza aunque el reloj esté parado', () => {
    const tres = [
      ended('first_half', 1),
      ended('second_half', 2),
      period({ period: 'third_period', ordinal: 3, accumulatedSeconds: 300 }),
    ];
    expect(isClockRunning(tres)).toBe(false);
    expect(canFinishMatch(tres, 3)).toBe(false);
  });

  it('descanso: tras la 2ª de tres hay descanso, no fin de partido', () => {
    const dos = [ended('first_half', 1), ended('second_half', 2)];
    expect(isAtBreak(dos, 3)).toBe(true);
    expect(nextPeriodAfter(dos, 3)).toEqual({ period: 'third_period', ordinal: 3 });
  });

  it('buildNextPeriod: el tercer tiempo arranca en el reloj acumulado (12+12)', () => {
    const DOCE = 12 * 60;
    const periods: ClockPeriod[] = [
      period({ accumulatedSeconds: DOCE, ended: true }),
      period({
        period: 'second_half',
        ordinal: 2,
        baseOffsetSeconds: DOCE,
        accumulatedSeconds: DOCE,
        ended: true,
      }),
    ];
    const next = buildNextPeriod(periods, T0, T0_ISO, 3);
    expect(next).toMatchObject({
      period: 'third_period',
      ordinal: 3,
      baseOffsetSeconds: 2 * DOCE, // 24:00
      accumulatedSeconds: 0,
      running: true,
      lastStartedAt: T0_ISO,
      ended: false,
    });
    // Y el reloj del partido sigue siendo monótono: 24:00 + lo que corra.
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      baseOffsetSeconds: 2 * DOCE,
      running: true,
      lastStartedAt: T0_ISO,
    });
    expect(clockSecondsAt([...periods, tercero], at(90))).toBe(2 * DOCE + 90);
  });

  it('el mismo estado con la categoría de dos ofrece PRÓRROGA, no tercer tiempo', () => {
    const dos = [ended('first_half', 1), ended('second_half', 2)];
    expect(buildNextPeriod(dos, T0, T0_ISO, 2)?.period).toBe('extra_first');
    expect(buildNextPeriod(dos, T0, T0_ISO, 3)?.period).toBe('third_period');
  });
});

describe('periodLabelKey: en un partido de tres no hay «partes»', () => {
  it('con tres, los dos primeros se leen como tiempos', () => {
    expect(periodLabelKey('first_half', 3)).toBe('first_of_three');
    expect(periodLabelKey('second_half', 3)).toBe('second_of_three');
    // El tercero ya se llama por su nombre.
    expect(periodLabelKey('third_period', 3)).toBe('third_period');
  });

  it('con tres, la prórroga y la tanda NO se renombran', () => {
    for (const clave of ['extra_first', 'extra_second', 'extra_time', 'penalties', 'finished']) {
      expect(periodLabelKey(clave, 3)).toBe(clave);
    }
  });

  it('con dos, ni una clave cambia (los demás clubes no ven nada nuevo)', () => {
    for (const clave of [...PERIOD_KINDS, 'half_time', 'extra_time', 'finished', 'not_started']) {
      expect(periodLabelKey(clave, 2)).toBe(clave);
    }
  });
});
