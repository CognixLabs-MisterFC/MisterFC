import { describe, it, expect } from 'vitest';
import {
  eventInputSchema,
  recurrenceRuleSchema,
} from '../event';

describe('recurrenceRuleSchema', () => {
  it('acepta input canónico semanal con count', () => {
    const r = recurrenceRuleSchema.safeParse({
      freq: 'weekly',
      interval: 1,
      by_weekday: [0, 2, 4],
      count: 36,
    });
    expect(r.success).toBe(true);
  });

  it('acepta input con until en lugar de count', () => {
    const r = recurrenceRuleSchema.safeParse({
      freq: 'weekly',
      interval: 1,
      by_weekday: [1],
      until: '2026-12-31',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza count y until simultáneos', () => {
    const r = recurrenceRuleSchema.safeParse({
      freq: 'weekly',
      interval: 1,
      by_weekday: [1],
      count: 4,
      until: '2026-12-31',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza count > 52', () => {
    const r = recurrenceRuleSchema.safeParse({
      freq: 'weekly',
      interval: 1,
      by_weekday: [1],
      count: 53,
    });
    expect(r.success).toBe(false);
  });

  it('rechaza by_weekday vacío', () => {
    const r = recurrenceRuleSchema.safeParse({
      freq: 'weekly',
      interval: 1,
      by_weekday: [],
      count: 4,
    });
    expect(r.success).toBe(false);
  });

  it('rechaza interval > 4', () => {
    const r = recurrenceRuleSchema.safeParse({
      freq: 'weekly',
      interval: 5,
      by_weekday: [1],
      count: 4,
    });
    expect(r.success).toBe(false);
  });
});

describe('eventInputSchema', () => {
  const base = {
    type: 'training' as const,
    target: { kind: 'team' as const, team_id: 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' },
    title: 'Entrenamiento',
    starts_at: '2026-05-15T18:00:00.000Z',
    ends_at: '2026-05-15T19:30:00.000Z',
    all_day: false,
    location_name: null,
    location_address: null,
    opponent_name: null,
    notes: null,
    recurrence_rule: null,
  };

  it('acepta input canónico de un entreno', () => {
    expect(eventInputSchema.safeParse(base).success).toBe(true);
  });

  it('rechaza ends_at < starts_at', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      starts_at: '2026-05-15T19:00:00.000Z',
      ends_at: '2026-05-15T18:00:00.000Z',
    });
    expect(r.success).toBe(false);
  });

  it('rechaza opponent_name con type=training', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      opponent_name: 'CD Rival',
    });
    expect(r.success).toBe(false);
  });

  it('acepta opponent_name con type=match', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      type: 'match',
      opponent_name: 'CD Rival',
    });
    expect(r.success).toBe(true);
  });

  it('acepta target club (sin team_id ni category_id)', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      target: { kind: 'club' },
    });
    expect(r.success).toBe(true);
  });

  it('rechaza team_id no-uuid', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      target: { kind: 'team', team_id: 'not-a-uuid' },
    });
    expect(r.success).toBe(false);
  });

  it('acepta ends_at == starts_at', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      ends_at: base.starts_at,
    });
    expect(r.success).toBe(true);
  });

  it('rechaza title vacío', () => {
    const r = eventInputSchema.safeParse({ ...base, title: '   ' });
    expect(r.success).toBe(false);
  });

  it('acepta recurrence_rule weekly válida', () => {
    const r = eventInputSchema.safeParse({
      ...base,
      recurrence_rule: {
        freq: 'weekly',
        interval: 1,
        by_weekday: [0, 2],
        count: 10,
      },
    });
    expect(r.success).toBe(true);
  });
});
