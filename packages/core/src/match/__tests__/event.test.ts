import { describe, it, expect } from 'vitest';
import { type ClockPeriod } from '../clock';
import {
  PLAYER_EVENT_TYPES,
  isPlayerEventType,
  FIELD_EVENT_TYPES,
  isFieldEventType,
  isExpelled,
  deriveExpelledPlayers,
  mergeLiveEvents,
  playerEventClockFields,
  resolveCardOutcome,
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

describe('isFieldEventType (7.4)', () => {
  it('acepta los 4 eventos sobre el campo', () => {
    expect(FIELD_EVENT_TYPES).toEqual(['corner', 'foul', 'offside', 'shot']);
    for (const t of FIELD_EVENT_TYPES) expect(isFieldEventType(t)).toBe(true);
  });
  it('rechaza eventos de jugador / cambio', () => {
    for (const t of ['goal', 'assist', 'yellow_card', 'red_card', 'substitution']) {
      expect(isFieldEventType(t)).toBe(false);
    }
  });
  it('jugador y campo son disjuntos', () => {
    for (const t of PLAYER_EVENT_TYPES) expect(isFieldEventType(t)).toBe(false);
    for (const t of FIELD_EVENT_TYPES) expect(isPlayerEventType(t)).toBe(false);
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

describe('resolveCardOutcome — tarjetas y expulsión (F7.3, §3.4 bis)', () => {
  it('1ª amarilla: se registra (sin roja, no expulsado todavía)', () => {
    expect(resolveCardOutcome([], 'yellow_card')).toEqual({ kind: 'register' });
  });

  it('2ª amarilla: se registra como amarilla MÁS (NO genera roja)', () => {
    // El jugador queda con 2 amarillas → expulsado por estado derivado, pero el
    // desenlace de registrar es una amarilla normal: no hay evento de roja.
    expect(resolveCardOutcome(['yellow_card'], 'yellow_card')).toEqual({
      kind: 'register',
    });
  });

  it('roja directa (sin tarjetas previas) → se registra', () => {
    expect(resolveCardOutcome([], 'red_card')).toEqual({ kind: 'register' });
  });

  it('roja directa con una amarilla previa → se registra', () => {
    expect(resolveCardOutcome(['yellow_card'], 'red_card')).toEqual({
      kind: 'register',
    });
  });

  it('2ª roja al mismo jugador → BLOQUEADA (player_expelled)', () => {
    expect(resolveCardOutcome(['red_card'], 'red_card')).toEqual({
      kind: 'blocked',
      reason: 'player_expelled',
    });
  });

  it('jugador con 2 amarillas (expulsado) → bloquea cualquier evento, incl. roja', () => {
    for (const t of ['goal', 'assist', 'yellow_card', 'red_card'] as const) {
      expect(resolveCardOutcome(['yellow_card', 'yellow_card'], t)).toEqual({
        kind: 'blocked',
        reason: 'player_expelled',
      });
    }
  });

  it('expulsado por roja NO puede recibir gol/asistencia/amarilla', () => {
    for (const t of ['goal', 'assist', 'yellow_card'] as const) {
      expect(resolveCardOutcome(['red_card'], t)).toEqual({
        kind: 'blocked',
        reason: 'player_expelled',
      });
    }
  });

  it('gol/asistencia de un jugador no expulsado se registran sin más', () => {
    expect(resolveCardOutcome(['goal'], 'assist')).toEqual({ kind: 'register' });
  });
});

describe('isExpelled — estado derivado (1 roja O 2 amarillas)', () => {
  it('sin tarjetas / 1 amarilla → no expulsado', () => {
    expect(isExpelled([])).toBe(false);
    expect(isExpelled(['yellow_card'])).toBe(false);
    expect(isExpelled(['goal', 'assist'])).toBe(false);
  });
  it('2 amarillas → expulsado (sin fila de roja)', () => {
    expect(isExpelled(['yellow_card', 'yellow_card'])).toBe(true);
  });
  it('1 roja directa → expulsado', () => {
    expect(isExpelled(['red_card'])).toBe(true);
    expect(isExpelled(['yellow_card', 'red_card'])).toBe(true);
  });
});

// Regresión F7.3: hidratación desde los persistidos + overlay optimista.
type Ev = { id: string; type: string; playerId: string | null };

describe('mergeLiveEvents — persistidos autoritativos + overlay optimista', () => {
  it('solo persistidos (tras recargar/volver): se muestran todos', () => {
    const persisted: Ev[] = [
      { id: 'r', type: 'red_card', playerId: 'X' },
      { id: 'g', type: 'goal', playerId: 'X' },
    ];
    expect(mergeLiveEvents(persisted, [])).toEqual(persisted);
  });

  it('optimista aún no persistido se SUPERPONE delante (no reemplaza)', () => {
    const persisted: Ev[] = [{ id: 'g', type: 'goal', playerId: 'X' }];
    const optimistic: Ev[] = [{ id: 'y', type: 'yellow_card', playerId: 'X' }];
    expect(mergeLiveEvents(persisted, optimistic)).toEqual([
      { id: 'y', type: 'yellow_card', playerId: 'X' },
      { id: 'g', type: 'goal', playerId: 'X' },
    ]);
  });

  it('optimista ya persistido (mismo id) NO duplica: gana el persistido', () => {
    const persisted: Ev[] = [{ id: 'g', type: 'goal', playerId: 'X' }];
    const optimistic: Ev[] = [{ id: 'g', type: 'goal', playerId: 'X' }];
    expect(mergeLiveEvents(persisted, optimistic)).toEqual(persisted);
  });

  it('lo optimista NUNCA borra lo persistido (overlay vacío → persistidos intactos)', () => {
    const persisted: Ev[] = [
      { id: 'a', type: 'goal', playerId: 'X' },
      { id: 'b', type: 'red_card', playerId: 'Y' },
    ];
    // Aunque el cliente "olvide" sus optimistas (remontaje), los persistidos siguen.
    expect(mergeLiveEvents(persisted, [])).toHaveLength(2);
  });
});

describe('deriveExpelledPlayers — recomputado desde TODOS los eventos', () => {
  it('expulsado por 2 amarillas y por 1 roja; los eventos NO se pierden', () => {
    const events: Ev[] = [
      { id: '1', type: 'goal', playerId: 'X' }, // X marca
      { id: '2', type: 'yellow_card', playerId: 'X' },
      { id: '3', type: 'yellow_card', playerId: 'X' }, // X expulsado (2 amarillas)
      { id: '4', type: 'red_card', playerId: 'Y' }, // Y expulsado (roja)
      { id: '5', type: 'goal', playerId: 'Z' },
    ];
    const expelled = deriveExpelledPlayers(events);
    expect(expelled.has('X')).toBe(true);
    expect(expelled.has('Y')).toBe(true);
    expect(expelled.has('Z')).toBe(false);
  });

  it('tras hidratar solo desde persistidos, el expulsado SIGUE expulsado (no reaparece)', () => {
    // Simula recargar/volver: solo persistidos, sin estado optimista.
    const persisted: Ev[] = [
      { id: '1', type: 'yellow_card', playerId: 'X' },
      { id: '2', type: 'yellow_card', playerId: 'X' },
    ];
    const events = mergeLiveEvents(persisted, []);
    expect(deriveExpelledPlayers(events).has('X')).toBe(true);
  });

  it('eventos sin jugador (rival/equipo) se ignoran', () => {
    const events: Ev[] = [{ id: '1', type: 'red_card', playerId: null }];
    expect(deriveExpelledPlayers(events).size).toBe(0);
  });
});
