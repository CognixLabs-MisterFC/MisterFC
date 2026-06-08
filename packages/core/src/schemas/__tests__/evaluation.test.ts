import { describe, expect, it } from 'vitest';
import {
  upsertEvaluationSchema,
  deleteEvaluationSchema,
  setPostMatchDoneSchema,
  upsertTeamEvaluationSchema,
  deleteTeamEvaluationSchema,
} from '../evaluation';

const EV = '11111111-1111-4111-8111-111111111111';
const PL = '22222222-2222-4222-8222-222222222222';

describe('upsertEvaluationSchema', () => {
  it('acepta rating + comentario (recorta) + MVP', () => {
    const r = upsertEvaluationSchema.safeParse({
      event_id: EV,
      player_id: PL,
      rating: 8,
      comment: '  gran partido  ',
      is_mvp: true,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rating).toBe(8);
      expect(r.data.comment).toBe('gran partido');
      expect(r.data.is_mvp).toBe(true);
    }
  });

  it('normaliza comentario vacío / solo-espacios a null', () => {
    const r = upsertEvaluationSchema.safeParse({
      event_id: EV,
      player_id: PL,
      rating: 5,
      comment: '   ',
      is_mvp: false,
    });
    expect(r.success && r.data.comment).toBe(null);
  });

  it('is_mvp por defecto false', () => {
    const r = upsertEvaluationSchema.safeParse({
      event_id: EV,
      player_id: PL,
      rating: 6,
      comment: null,
    });
    expect(r.success && r.data.is_mvp).toBe(false);
  });

  it('rechaza rating fuera de 1..10 o no entero', () => {
    for (const rating of [0, 11, 5.5, -1]) {
      expect(
        upsertEvaluationSchema.safeParse({ event_id: EV, player_id: PL, rating, comment: null, is_mvp: false }).success,
      ).toBe(false);
    }
  });

  it('permite rating null si hay comentario o MVP (entreno; partido lo valida cliente/trigger)', () => {
    expect(
      upsertEvaluationSchema.safeParse({ event_id: EV, player_id: PL, rating: null, comment: 'buen entreno', is_mvp: false }).success,
    ).toBe(true);
    expect(
      upsertEvaluationSchema.safeParse({ event_id: EV, player_id: PL, rating: null, comment: null, is_mvp: true }).success,
    ).toBe(true);
  });

  it('rechaza fila vacía (sin rating, sin comentario, sin MVP)', () => {
    expect(
      upsertEvaluationSchema.safeParse({ event_id: EV, player_id: PL, rating: null, comment: '   ', is_mvp: false }).success,
    ).toBe(false);
  });

  it('rechaza ids no-uuid', () => {
    expect(
      upsertEvaluationSchema.safeParse({ event_id: 'no', player_id: PL, rating: 7, comment: null, is_mvp: false }).success,
    ).toBe(false);
  });
});

describe('deleteEvaluationSchema / setPostMatchDoneSchema', () => {
  it('delete exige event_id + player_id uuid', () => {
    expect(deleteEvaluationSchema.safeParse({ event_id: EV, player_id: PL }).success).toBe(true);
    expect(deleteEvaluationSchema.safeParse({ event_id: EV, player_id: 'x' }).success).toBe(false);
  });

  it('setPostMatchDone exige event_id uuid + done boolean', () => {
    expect(setPostMatchDoneSchema.safeParse({ event_id: EV, done: true }).success).toBe(true);
    expect(setPostMatchDoneSchema.safeParse({ event_id: EV, done: 'yes' }).success).toBe(false);
  });
});

describe('upsertTeamEvaluationSchema (colectiva)', () => {
  it('acepta event_id + rating 1-10 + comentario (recorta)', () => {
    const r = upsertTeamEvaluationSchema.safeParse({
      event_id: EV,
      rating: 7,
      comment: '  buen partido de equipo  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.rating).toBe(7);
      expect(r.data.comment).toBe('buen partido de equipo');
    }
  });

  it('rating es OBLIGATORIO (no nullable) y 1..10 entero', () => {
    expect(upsertTeamEvaluationSchema.safeParse({ event_id: EV, comment: 'x' }).success).toBe(false);
    expect(upsertTeamEvaluationSchema.safeParse({ event_id: EV, rating: null, comment: 'x' }).success).toBe(false);
    for (const rating of [0, 11, 5.5]) {
      expect(upsertTeamEvaluationSchema.safeParse({ event_id: EV, rating, comment: null }).success).toBe(false);
    }
  });

  it('normaliza comentario vacío a null y permite null', () => {
    const r = upsertTeamEvaluationSchema.safeParse({ event_id: EV, rating: 6, comment: '   ' });
    expect(r.success && r.data.comment).toBe(null);
    expect(upsertTeamEvaluationSchema.safeParse({ event_id: EV, rating: 6, comment: null }).success).toBe(true);
  });

  it('deleteTeamEvaluation exige event_id uuid', () => {
    expect(deleteTeamEvaluationSchema.safeParse({ event_id: EV }).success).toBe(true);
    expect(deleteTeamEvaluationSchema.safeParse({ event_id: 'x' }).success).toBe(false);
  });
});
