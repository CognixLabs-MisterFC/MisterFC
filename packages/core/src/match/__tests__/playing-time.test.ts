import { describe, it, expect } from 'vitest';
import {
  computePlayingSeconds,
  countPlayerEvents,
  computePlayerMatchStats,
  flagLowPlaytime,
  leastPlayedIds,
  type MatchEventLite,
} from '../playing-time';

// Reloj de referencia: partido de 90' = 5400 s; descanso/prórroga ya plegados en
// clock_seconds (§6), así que aquí solo restamos instantes.
const FULL = 90 * 60; // 5400
const sub = (out: string, into: string, clockSeconds: number): MatchEventLite => ({
  type: 'substitution',
  playerId: out,
  relatedPlayerId: into,
  clockSeconds,
});
const card = (
  type: 'yellow_card' | 'red_card' | 'goal' | 'assist',
  playerId: string,
  clockSeconds = 0,
): MatchEventLite => ({ type, playerId, clockSeconds });

describe('computePlayingSeconds — tramos en campo (§6)', () => {
  it('un titular sin cambios juega el partido entero', () => {
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [],
      matchClockSeconds: FULL,
    });
    expect(s.get('A')).toBe(FULL); // 90'
  });

  it('un suplente que entra al 60′ suma desde su entrada', () => {
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [sub('A', 'B', 60 * 60)],
      matchClockSeconds: FULL,
    });
    expect(s.get('B')).toBe(30 * 60); // 30'
    expect(s.get('A')).toBe(60 * 60); // titular sustituido al 60′ → 60'
  });

  it('un titular sustituido deja de sumar en el cambio', () => {
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [sub('A', 'B', 70 * 60)],
      matchClockSeconds: FULL,
    });
    expect(s.get('A')).toBe(70 * 60);
  });

  it('reentrada (cambios corridos): suma varios tramos', () => {
    // A titular, sale al 30′ (entra B), vuelve al 60′ (sale B). Tramos: 0–30 y 60–90.
    const s = computePlayingSeconds({
      starterIds: ['A', 'C'],
      events: [sub('A', 'B', 30 * 60), sub('B', 'A', 60 * 60)],
      matchClockSeconds: FULL,
    });
    expect(s.get('A')).toBe(30 * 60 + 30 * 60); // 60'
    expect(s.get('B')).toBe(30 * 60); // 30–60 → 30'
  });

  it('un expulsado (roja) deja de sumar en su expulsión', () => {
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [card('red_card', 'A', 70 * 60)],
      matchClockSeconds: FULL,
    });
    expect(s.get('A')).toBe(70 * 60);
  });

  it('una doble amarilla (2× yellow) NO recorta minutos por sí sola', () => {
    // La expulsión efectiva por doble amarilla la modela el estado derivado +
    // (en el cierre) el red_card; dos amarillas sueltas no cierran el tramo aquí.
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [card('yellow_card', 'A', 20 * 60), card('yellow_card', 'A', 50 * 60)],
      matchClockSeconds: FULL,
    });
    expect(s.get('A')).toBe(FULL);
  });

  it('un AUSENTE no suma minutos aunque figure como titular', () => {
    const s = computePlayingSeconds({
      starterIds: ['A', 'B'],
      events: [],
      matchClockSeconds: FULL,
      absentIds: ['B'],
    });
    expect(s.get('B') ?? 0).toBe(0);
    expect(s.has('B')).toBe(false);
    expect(s.get('A')).toBe(FULL);
  });

  it('el reloj en marcha avanza los minutos (mismo escenario, dos relojes)', () => {
    const at30 = computePlayingSeconds({
      starterIds: ['A'],
      events: [],
      matchClockSeconds: 30 * 60,
    });
    const at45 = computePlayingSeconds({
      starterIds: ['A'],
      events: [],
      matchClockSeconds: 45 * 60,
    });
    expect(at30.get('A')).toBe(30 * 60);
    expect(at45.get('A')).toBe(45 * 60);
  });

  it('en el DESCANSO el reloj no avanza: el motor solo resta instantes', () => {
    // En descanso clockSecondsAt se queda en el fin de la 1ª parte (45'); el motor
    // confía en ese número → no cuenta el descanso (robustez §6).
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [],
      matchClockSeconds: 45 * 60,
    });
    expect(s.get('A')).toBe(45 * 60);
  });

  it('robusto: cambio de un jugador que ya no está en campo se ignora sin negativos', () => {
    const s = computePlayingSeconds({
      starterIds: ['A'],
      events: [sub('A', 'B', 30 * 60), sub('A', 'C', 60 * 60)], // 2ª salida de A: A ya está fuera
      matchClockSeconds: FULL,
    });
    expect(s.get('A')).toBe(30 * 60); // no resta de más (la 2ª salida de A se ignora)
    expect(s.get('B')).toBe(60 * 60); // B entró al 30′ y nadie lo saca → hasta el final (90′)
    expect(s.get('C') ?? 0).toBe(30 * 60); // C entra al 60′ aunque A ya estuviera fuera
  });
});

describe('countPlayerEvents — goles/asistencias/tarjetas', () => {
  it('cuenta por jugador e ignora eventos sin jugador', () => {
    const counts = countPlayerEvents([
      { type: 'goal', playerId: 'A' },
      { type: 'goal', playerId: 'A' },
      { type: 'assist', playerId: 'B' },
      { type: 'yellow_card', playerId: 'A' },
      { type: 'red_card', playerId: 'C' },
      { type: 'corner', playerId: null },
      { type: 'shot', playerId: null },
    ]);
    expect(counts.get('A')).toEqual({ goals: 2, assists: 0, yellowCards: 1, redCards: 0 });
    expect(counts.get('B')).toEqual({ goals: 0, assists: 1, yellowCards: 0, redCards: 0 });
    expect(counts.get('C')).toEqual({ goals: 0, assists: 0, yellowCards: 0, redCards: 1 });
  });
});

describe('computePlayerMatchStats — tabla por jugador', () => {
  it('una fila por rosterId (en orden), con minutos y conteos; sin jugar → 0', () => {
    const rows = computePlayerMatchStats({
      starterIds: ['A'],
      events: [sub('A', 'B', 60 * 60), card('goal', 'B', 80 * 60)],
      matchClockSeconds: FULL,
      rosterIds: ['A', 'B', 'D'], // D es suplente sin estrenar
    });
    expect(rows.map((r) => r.playerId)).toEqual(['A', 'B', 'D']);
    const [a, b, d] = rows;
    expect(a!.playedMinutes).toBe(60);
    expect(b!.playedMinutes).toBe(30);
    expect(b!.goals).toBe(1);
    expect(d!.playedMinutes).toBe(0);
    expect(d!.goals).toBe(0);
  });
});

describe('flagLowPlaytime — "ha jugado poco"', () => {
  it('marca a quien está por debajo del umbral % del tiempo jugado', () => {
    const rows = [
      { playerId: 'A', playedSeconds: FULL }, // 100%
      { playerId: 'B', playedSeconds: 20 * 60 }, // ~22%
      { playerId: 'C', playedSeconds: 45 * 60 }, // 50%
    ];
    const low = flagLowPlaytime(rows, FULL, 50);
    expect(low.has('A')).toBe(false);
    expect(low.has('B')).toBe(true);
    expect(low.has('C')).toBe(false); // exactamente al 50% NO es "por debajo"
  });

  it('con el reloj a 0 no marca a nadie', () => {
    const low = flagLowPlaytime([{ playerId: 'A', playedSeconds: 0 }], 0, 50);
    expect(low.size).toBe(0);
  });
});

describe('leastPlayedIds — destacar los menos jugados', () => {
  it('devuelve los n con menos minutos, desempate estable', () => {
    const rows = [
      { playerId: 'A', playedSeconds: 90 },
      { playerId: 'B', playedSeconds: 10 },
      { playerId: 'C', playedSeconds: 10 },
      { playerId: 'D', playedSeconds: 50 },
    ];
    const least = leastPlayedIds(rows, 2);
    expect([...least].sort()).toEqual(['B', 'C']);
    expect(leastPlayedIds(rows, 0).size).toBe(0);
  });
});
