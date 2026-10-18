import { describe, it, expect } from 'vitest';
import { matchHasStarted, matchPhase, phaseShowsMinute } from '../phase';
import type { MatchPhaseKind } from '../phase';
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
    const r = matchPhase({
      status: 'not_started',
      periods: [],
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0,
    });
    expect(r).toEqual({ phase: 'not_started', minute: 0, addedTime: 0 });
  });

  it('sin empezar: live pero sin periodos aún', () => {
    const r = matchPhase({
      status: 'live',
      periods: [],
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0,
    });
    expect(r.phase).toBe('not_started');
    expect(r.minute).toBe(0);
  });

  it('1ª parte en curso', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) }),
    ];
    const r = matchPhase({
      status: 'live',
      periods,
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0 + 10 * 60_000,
    });
    expect(r.phase).toBe('first_half');
    expect(r.minute).toBe(10);
    expect(r.addedTime).toBe(0);
  });

  it('1ª parte en pausa (no terminada) sigue siendo primera parte', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: false, accumulatedSeconds: 10 * 60 }),
    ];
    const r = matchPhase({
      status: 'live',
      periods,
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0 + 999_999,
    });
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
    const r = matchPhase({
      status: 'live',
      periods,
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0 + 26 * 60_000,
    });
    expect(r.phase).toBe('first_half');
    expect(r.minute).toBe(25);
    expect(r.addedTime).toBe(2); // 26 - 25 + 1
  });

  it('justo al alcanzar la duración nominal empieza el añadido', () => {
    const periods = [
      period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) }),
    ];
    const r = matchPhase({
      status: 'live',
      periods,
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0 + 25 * 60_000,
    });
    expect(r.minute).toBe(25);
    expect(r.addedTime).toBe(1); // 25 - 25 + 1
  });
});

describe('matchPhase — descanso (congelado)', () => {
  it('1ª terminada, sin 2ª aún → descanso con minuto congelado', () => {
    const periods = [
      period({
        period: 'first_half',
        ordinal: 1,
        running: false,
        ended: true,
        accumulatedSeconds: 24 * 60 + 30,
      }),
    ];
    const base = { status: 'live' as const, periods, halfDurationMinutes: HALF, periodCount: 2 as const };
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

  it("arranca mostrando la duración de la 1ª parte (25')", () => {
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
      periodCount: 2,
      nowMs: T0, // 0s dentro de la 2ª
    });
    expect(r.phase).toBe('second_half');
    expect(r.minute).toBe(25);
    expect(r.addedTime).toBe(0);
  });

  it("avanza desde el offset (26' tras un minuto)", () => {
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
      periodCount: 2,
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
      periodCount: 2,
      nowMs: T0 + 26 * 60_000, // 26 min dentro de la 2ª
    });
    expect(r.minute).toBe(50); // 25 (offset) + 25 (tope)
    expect(r.addedTime).toBe(2);
  });
});

describe('matchPhase — prórroga', () => {
  it("continúa con el offset acumulado (prórroga a partir de 50')", () => {
    const first = period({
      period: 'first_half',
      ordinal: 1,
      ended: true,
      accumulatedSeconds: HALF * 60,
      baseOffsetSeconds: 0,
    });
    const second = period({
      period: 'second_half',
      ordinal: 2,
      ended: true,
      accumulatedSeconds: HALF * 60,
      baseOffsetSeconds: HALF * 60,
    });
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
      periodCount: 2,
      nowMs: T0 + 5 * 60_000,
    });
    expect(r.phase).toBe('extra_time');
    expect(r.minute).toBe(55); // 2*25 + 5
    expect(r.addedTime).toBe(0);
  });
});

describe('matchPhase — penaltis y fin', () => {
  it('tanda de penaltis: fase penalties, minuto congelado en el fin del tiempo jugado', () => {
    const first = period({
      period: 'first_half',
      ordinal: 1,
      ended: true,
      accumulatedSeconds: HALF * 60,
      baseOffsetSeconds: 0,
    });
    const second = period({
      period: 'second_half',
      ordinal: 2,
      ended: true,
      accumulatedSeconds: HALF * 60,
      baseOffsetSeconds: HALF * 60,
    });
    const shootout = period({
      period: 'penalties',
      ordinal: 5,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: 2 * HALF * 60,
    });
    const r = matchPhase({
      status: 'live',
      periods: [first, second, shootout],
      halfDurationMinutes: HALF,
      periodCount: 2,
      nowMs: T0 + 3 * 60_000,
    });
    expect(r.phase).toBe('penalties');
    // El minuto sale de la 2ª parte (último periodo jugado), no de la tanda.
    expect(r.minute).toBe(50);
  });

  it('fin: status closed → finished, minuto congelado', () => {
    const first = period({
      period: 'first_half',
      ordinal: 1,
      ended: true,
      accumulatedSeconds: HALF * 60,
      baseOffsetSeconds: 0,
    });
    const second = period({
      period: 'second_half',
      ordinal: 2,
      ended: true,
      accumulatedSeconds: 24 * 60,
      baseOffsetSeconds: HALF * 60,
    });
    const base = {
      status: 'closed' as const,
      periods: [first, second],
      halfDurationMinutes: HALF,
      periodCount: 2 as const,
    };
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
    const call = () =>
      matchPhase({
        status: 'live',
        periods,
        halfDurationMinutes: HALF,
        periodCount: 2,
        nowMs: T0 + 7 * 60_000,
      });
    expect(call()).toEqual(call());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TRES TIEMPOS DE DOCE (querubines). El minuto de marcador ya no puede salir de
// un `switch` con las cuentas escritas a mano: con tres periodos regulares la
// prórroga arranca en 3×12 y no en 2×12, y ninguna de esas constantes valía.
// ─────────────────────────────────────────────────────────────────────────────
describe('matchPhase — tres tiempos de doce', () => {
  const DOCE = 12;
  const seg = (min: number) => min * 60;

  const primero = period({
    period: 'first_half',
    ordinal: 1,
    ended: true,
    accumulatedSeconds: seg(DOCE),
    baseOffsetSeconds: 0,
  });
  const segundo = period({
    period: 'second_half',
    ordinal: 2,
    ended: true,
    accumulatedSeconds: seg(DOCE),
    baseOffsetSeconds: seg(DOCE),
  });

  it('el tercer tiempo tiene su propia fase (no es «prórroga» ni «2ª parte»)', () => {
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: seg(2 * DOCE),
    });
    const r = matchPhase({
      status: 'live',
      periods: [primero, segundo, tercero],
      halfDurationMinutes: DOCE,
      periodCount: 3,
      nowMs: T0,
    });
    expect(r.phase).toBe('third_period');
    // Arranca mostrando 24' = los dos tiempos previos de doce.
    expect(r.minute).toBe(24);
    expect(r.addedTime).toBe(0);
  });

  it("avanza desde 24' y entra en añadido al llegar a los doce", () => {
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: seg(2 * DOCE),
    });
    const base = {
      status: 'live' as const,
      periods: [primero, segundo, tercero],
      halfDurationMinutes: DOCE,
      periodCount: 3 as const,
    };
    expect(matchPhase({ ...base, nowMs: T0 + 5 * 60_000 }).minute).toBe(29);
    // 11 min dentro: último minuto sin añadido.
    expect(matchPhase({ ...base, nowMs: T0 + 11 * 60_000 })).toMatchObject({
      minute: 35,
      addedTime: 0,
    });
    // 13 min dentro: base congelado en 36' (3×12) y "+2".
    expect(matchPhase({ ...base, nowMs: T0 + 13 * 60_000 })).toMatchObject({
      minute: 36,
      addedTime: 2,
    });
  });

  it('LA CUENTA QUE EL SWITCH HACÍA MAL: la prórroga arranca en 36\', no en 24\'', () => {
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      ended: true,
      accumulatedSeconds: seg(DOCE),
      baseOffsetSeconds: seg(2 * DOCE),
    });
    const extra = period({
      period: 'extra_first',
      ordinal: 4, // 4, no 3: el tercer tiempo ocupa el 3
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: seg(3 * DOCE),
    });
    const periods = [primero, segundo, tercero, extra];
    const r = matchPhase({
      status: 'live',
      periods,
      halfDurationMinutes: DOCE,
      periodCount: 3,
      nowMs: T0 + 5 * 60_000,
    });
    expect(r.phase).toBe('extra_time');
    expect(r.minute).toBe(41); // 3×12 + 5
    // El contraste: con la categoría contando dos, esa MISMA fila da 29' —que
    // es lo que devolvía el `2 * halfMin` escrito a mano. La diferencia no está
    // en los datos del partido, está en la categoría.
    const comoSiFueranDos = matchPhase({
      status: 'live',
      periods,
      halfDurationMinutes: DOCE,
      periodCount: 2,
      nowMs: T0 + 5 * 60_000,
    });
    expect(comoSiFueranDos.minute).toBe(29);
  });

  it('descanso tras el 2º tiempo: half_time con el minuto congelado, NO finished', () => {
    const base = {
      status: 'live' as const,
      periods: [primero, segundo],
      halfDurationMinutes: DOCE,
      periodCount: 3 as const,
    };
    const r1 = matchPhase({ ...base, nowMs: T0 });
    const r2 = matchPhase({ ...base, nowMs: T0 + 8 * 60_000 });
    expect(r1.phase).toBe('half_time');
    expect(r1.minute).toBe(24);
    expect(r2).toEqual(r1);
  });

  it('cerrado con los tres jugados → finished y el minuto del tercero', () => {
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      ended: true,
      accumulatedSeconds: seg(10), // el árbitro lo cortó en el 10'
      baseOffsetSeconds: seg(2 * DOCE),
    });
    const r = matchPhase({
      status: 'closed',
      periods: [primero, segundo, tercero],
      halfDurationMinutes: DOCE,
      periodCount: 3,
      nowMs: T0 + 99 * 60_000,
    });
    expect(r.phase).toBe('finished');
    expect(r.minute).toBe(34); // 24 + 10
  });

  it('un partido ya jugado a tres cuya categoría HOY dice dos no inventa el minuto', () => {
    // Pasa de verdad: se juega el amistoso con period_count=3 y después alguien
    // deja la categoría en 2. Sumando el orden de dos, el tercer tiempo no
    // aparecería en la lista y el offset acabaría siendo la suma ENTERA de los
    // cinco periodos nominales (60' con tiempos de doce). Se cuenta con el orden
    // que sí lo contiene: el que se jugó.
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      ended: true,
      accumulatedSeconds: seg(DOCE),
      baseOffsetSeconds: seg(2 * DOCE),
    });
    const r = matchPhase({
      status: 'closed',
      periods: [primero, segundo, tercero],
      halfDurationMinutes: DOCE,
      periodCount: 2,
      nowMs: T0,
    });
    expect(r.phase).toBe('finished');
    expect(r.minute).toBe(36); // 24 + 12, no 60 + 12
  });

  it('con DOS periodos nada cambia: el tercer tiempo no aparece por su cuenta', () => {
    // La defensa de los otros quince equipos del club: el mismo motor, con la
    // categoría de siempre, da exactamente lo de siempre.
    const extra = period({
      period: 'extra_first',
      ordinal: 3,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: seg(2 * DOCE),
    });
    const r = matchPhase({
      status: 'live',
      periods: [primero, segundo, extra],
      halfDurationMinutes: DOCE,
      periodCount: 2,
      nowMs: T0 + 3 * 60_000,
    });
    expect(r.phase).toBe('extra_time');
    expect(r.minute).toBe(27); // 2×12 + 3
  });
});

describe('phaseShowsMinute — ¿minuto o etiqueta de fase?', () => {
  it('el tercer tiempo ENSEÑA el minuto, como las otras fases en juego', () => {
    // Las cinco pantallas del directo tenían su propio Set escrito a mano con
    // first_half/second_half/extra_time: en el tercer tiempo las cinco habrían
    // dejado de enseñar el minuto y habrían puesto «3er tiempo» en su lugar.
    expect(phaseShowsMinute('third_period')).toBe(true);
    expect(phaseShowsMinute('first_half')).toBe(true);
    expect(phaseShowsMinute('second_half')).toBe(true);
    expect(phaseShowsMinute('extra_time')).toBe(true);
  });

  it('las fases sin reloj en juego rotulan la fase', () => {
    expect(phaseShowsMinute('not_started')).toBe(false);
    expect(phaseShowsMinute('half_time')).toBe(false); // congelado
    expect(phaseShowsMinute('penalties')).toBe(false); // no es tiempo jugado
    expect(phaseShowsMinute('finished')).toBe(false);
  });

  it('cubre TODAS las fases: ninguna se queda sin respuesta', () => {
    const todas: MatchPhaseKind[] = [
      'not_started',
      'first_half',
      'half_time',
      'second_half',
      'third_period',
      'extra_time',
      'penalties',
      'finished',
    ];
    for (const fase of todas) {
      expect(typeof phaseShowsMinute(fase), fase).toBe('boolean');
    }
  });

  it('la fase que devuelve matchPhase en el tercer tiempo es una que enseña minuto', () => {
    // El aserto de verdad: no que el mapa diga true, sino que la fase que SALE
    // de un partido de tres tiempos en curso sea una de las que enseñan minuto.
    const DOCE = 12;
    const tercero = period({
      period: 'third_period',
      ordinal: 3,
      running: true,
      lastStartedAt: iso(T0),
      baseOffsetSeconds: 2 * DOCE * 60,
    });
    const { phase } = matchPhase({
      status: 'live',
      periods: [
        period({ period: 'first_half', ordinal: 1, ended: true, accumulatedSeconds: DOCE * 60 }),
        period({
          period: 'second_half',
          ordinal: 2,
          ended: true,
          accumulatedSeconds: DOCE * 60,
          baseOffsetSeconds: DOCE * 60,
        }),
        tercero,
      ],
      halfDurationMinutes: DOCE,
      periodCount: 3,
      nowMs: T0 + 60_000,
    });
    expect(phaseShowsMinute(phase)).toBe(true);
  });
});

describe('matchHasStarted — ¿ha empezado DE VERDAD?', () => {
  const primera = period({ period: 'first_half', ordinal: 1, running: true, lastStartedAt: iso(T0) });

  it('con periodo y en juego, sí', () => {
    expect(matchHasStarted([primera], 'live')).toBe(true);
  });

  it('con sus periodos y cerrado, también: empezó y terminó', () => {
    expect(matchHasStarted([{ ...primera, running: false, ended: true }], 'closed')).toBe(true);
  });

  it('sin periodos y sin empezar, no', () => {
    expect(matchHasStarted([], 'not_started')).toBe(false);
  });

  /**
   * EL CASO QUE MOTIVA LA FUNCIÓN, y no es teórico: el 2026-10-16 un partido del
   * club quedó así —`match_state` en `live`, cero filas en `match_periods`— porque
   * el arranque escribía el estado antes de comprobar la alineación (#801).
   *
   * La columna dice que está en juego y el reloj dice que no existe. Manda el
   * reloj: mientras esto devuelva false, la pantalla ofrece «Empezar partido», y
   * ese botón es el que lo repara (`startMatchFromClient` es idempotente). Si
   * devolviera true, el control se queda sin un solo botón que pulsar.
   */
  it('EN LIVE PERO SIN PERIODOS, no: es un arranque a medias, y hay que poder arrancarlo', () => {
    expect(matchHasStarted([], 'live')).toBe(false);
  });

  it('con periodos pero el estado sin empezar, tampoco', () => {
    // La otra mitad de la discrepancia: una reconstrucción de acta a medio hacer.
    expect(matchHasStarted([primera], 'not_started')).toBe(false);
  });
});
