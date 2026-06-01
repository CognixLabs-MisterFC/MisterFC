import { describe, expect, it } from 'vitest';
import {
  createLineupSchema,
  setLineupFormationSchema,
  upsertLineupPositionSchema,
} from '../lineup';

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';

describe('createLineupSchema', () => {
  it('acepta una formación del catálogo', () => {
    const r = createLineupSchema.safeParse({
      event_id: UUID,
      name: 'Titular',
      formation_code: '4-3-3',
    });
    expect(r.success).toBe(true);
  });

  it('rechaza formación desconocida', () => {
    const r = createLineupSchema.safeParse({
      event_id: UUID,
      name: 'Titular',
      formation_code: '9-9-9',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('formation_unknown');
  });

  it('rechaza nombre vacío', () => {
    const r = createLineupSchema.safeParse({ event_id: UUID, name: '  ', formation_code: '4-3-3' });
    expect(r.success).toBe(false);
  });
});

describe('upsertLineupPositionSchema — coherencia location ↔ campos', () => {
  const base = { lineup_id: UUID, player_id: UUID2 };

  it('field exige position_code', () => {
    const ok = upsertLineupPositionSchema.safeParse({ ...base, location: 'field', position_code: 'GK', x_pct: 50, y_pct: 94 });
    expect(ok.success).toBe(true);
    const bad = upsertLineupPositionSchema.safeParse({ ...base, location: 'field' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('position_code_coherence');
  });

  it('bench no admite position_code', () => {
    const bad = upsertLineupPositionSchema.safeParse({ ...base, location: 'bench', position_code: 'DF1' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('position_code_coherence');
  });

  it('rechaza location "out" (ya no existe en el modelo)', () => {
    const bad = upsertLineupPositionSchema.safeParse({ ...base, location: 'out' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('location_invalid');
  });

  it('coords solo en field', () => {
    const bad = upsertLineupPositionSchema.safeParse({ ...base, location: 'bench', x_pct: 10 });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toBe('coords_only_field');
  });

  it('bench válido sin extras', () => {
    expect(upsertLineupPositionSchema.safeParse({ ...base, location: 'bench' }).success).toBe(true);
  });
});

describe('setLineupFormationSchema', () => {
  it('valida formación del catálogo', () => {
    expect(setLineupFormationSchema.safeParse({ lineup_id: UUID, formation_code: '3-5-2' }).success).toBe(true);
    expect(setLineupFormationSchema.safeParse({ lineup_id: UUID, formation_code: 'x' }).success).toBe(false);
  });
});
