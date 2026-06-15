import { describe, it, expect } from 'vitest';
import {
  registerPlayerFieldEventSchema,
  registerFoulSchema,
} from '../match-event';

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const ROW_ID = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
const PLAYER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('registerPlayerFieldEventSchema — tiro/offside por jugador, sin coords', () => {
  it('acepta tiro con player_id', () => {
    const r = registerPlayerFieldEventSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      type: 'shot',
      player_id: PLAYER_ID,
    });
    expect(r.success).toBe(true);
  });

  it('acepta fuera de juego con player_id', () => {
    const r = registerPlayerFieldEventSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      type: 'offside',
      player_id: PLAYER_ID,
    });
    expect(r.success).toBe(true);
  });

  it('no captura coordenadas (las descarta del dato validado)', () => {
    const r = registerPlayerFieldEventSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      type: 'shot',
      player_id: PLAYER_ID,
      x_pct: 50,
      y_pct: 50,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect('x_pct' in r.data).toBe(false);
      expect('y_pct' in r.data).toBe(false);
    }
  });

  it('rechaza tipos que no son de campo-por-jugador (corner/foul/goal)', () => {
    for (const type of ['corner', 'foul', 'goal']) {
      const r = registerPlayerFieldEventSchema.safeParse({
        event_id: EVENT_ID,
        id: ROW_ID,
        type,
        player_id: PLAYER_ID,
      });
      expect(r.success).toBe(false);
    }
  });

  it('rechaza si falta player_id (el actor es obligatorio)', () => {
    const r = registerPlayerFieldEventSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      type: 'shot',
    });
    expect(r.success).toBe(false);
  });
});

describe('registerFoulSchema — coords opcionales (falta por toque de jugador)', () => {
  it('acepta falta sin coordenadas', () => {
    const r = registerFoulSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      player_id: PLAYER_ID,
      kind: 'committed',
    });
    expect(r.success).toBe(true);
  });

  it('acepta falta con coordenadas (compat con ubicación)', () => {
    const r = registerFoulSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      player_id: PLAYER_ID,
      kind: 'received',
      x_pct: 12.5,
      y_pct: 80,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza kind inválido', () => {
    const r = registerFoulSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      player_id: PLAYER_ID,
      kind: 'sideways',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza coordenadas fuera de rango cuando se indican', () => {
    const r = registerFoulSchema.safeParse({
      event_id: EVENT_ID,
      id: ROW_ID,
      player_id: PLAYER_ID,
      kind: 'committed',
      x_pct: 120,
      y_pct: 50,
    });
    expect(r.success).toBe(false);
  });
});
