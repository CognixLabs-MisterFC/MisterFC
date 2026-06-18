import { describe, it, expect } from 'vitest';
import {
  SESSION_BLOCK_TYPES,
  DEFAULT_SESSION_SKELETON,
  SESSION_VISIBILITIES,
  buildDefaultSkeleton,
  isSessionBlockType,
  isSessionVisibility,
} from '../sessions';
import {
  sessionHeaderSchema,
  sessionTaskSchema,
  sessionBlockSchema,
  sessionBlockTypeSchema,
  createSessionSchema,
  updateSessionHeaderSchema,
  toSessionHeaderColumns,
} from '../session-form';

describe('F12 — SESSION_BLOCK_TYPES (catálogo fijo, D1)', () => {
  it('es el catálogo cerrado de 4 tipos en orden', () => {
    expect(SESSION_BLOCK_TYPES).toEqual([
      'calentamiento',
      'complementaria',
      'principal',
      'vuelta_a_la_calma',
    ]);
  });

  it('isSessionBlockType discrimina', () => {
    expect(isSessionBlockType('principal')).toBe(true);
    expect(isSessionBlockType('inventado')).toBe(false);
  });
});

describe('F12 — DEFAULT_SESSION_SKELETON + buildDefaultSkeleton (siembra)', () => {
  it('son 5 bloques en el orden estándar (principal ×2)', () => {
    expect(DEFAULT_SESSION_SKELETON).toEqual([
      'calentamiento',
      'complementaria',
      'principal',
      'principal',
      'vuelta_a_la_calma',
    ]);
  });

  it('todos los tipos del esqueleto pertenecen al catálogo', () => {
    for (const t of DEFAULT_SESSION_SKELETON) {
      expect(isSessionBlockType(t)).toBe(true);
    }
  });

  it('buildDefaultSkeleton numera order_idx 0..n correlativo', () => {
    const blocks = buildDefaultSkeleton();
    expect(blocks).toHaveLength(DEFAULT_SESSION_SKELETON.length);
    blocks.forEach((b, i) => {
      expect(b.order_idx).toBe(i);
      expect(b.block_type).toBe(DEFAULT_SESSION_SKELETON[i]);
    });
  });

  it('los order_idx son únicos', () => {
    const idxs = buildDefaultSkeleton().map((b) => b.order_idx);
    expect(new Set(idxs).size).toBe(idxs.length);
  });
});

describe('F12 — visibilidad (D3)', () => {
  it('es {staff, team} y staff es la opción por defecto del schema', () => {
    expect(SESSION_VISIBILITIES).toEqual(['staff', 'team']);
    expect(isSessionVisibility('team')).toBe(true);
    expect(isSessionVisibility('publico')).toBe(false);
    const r = sessionHeaderSchema.parse({});
    expect(r.visibility).toBe('staff');
  });
});

describe('F12 — sessionHeaderSchema (D7/D8)', () => {
  it('una cabecera vacía es válida (todo opcional, arrays por defecto)', () => {
    const r = sessionHeaderSchema.parse({});
    expect(r.tactical_objectives).toEqual([]);
    expect(r.technical_objectives).toEqual([]);
  });

  it('valida objetivos contra el vocabulario de F11 (D8)', () => {
    const ok = sessionHeaderSchema.safeParse({
      tactical_objectives: ['posesion', 'presion_tras_perdida'],
      technical_objectives: ['pase'],
    });
    expect(ok.success).toBe(true);

    const bad = sessionHeaderSchema.safeParse({ tactical_objectives: ['no_existe'] });
    expect(bad.success).toBe(false);
  });

  it('normaliza texto vacío a undefined y acepta meso/micro libres', () => {
    const r = sessionHeaderSchema.parse({
      title: '   ',
      mesocycle: 'Meso 2',
      microcycle: '  ',
    });
    expect(r.title).toBeUndefined();
    expect(r.mesocycle).toBe('Meso 2');
    expect(r.microcycle).toBeUndefined();
  });

  it('total_minutes coacciona string numérico y rechaza negativos', () => {
    expect(sessionHeaderSchema.parse({ total_minutes: '90' }).total_minutes).toBe(90);
    expect(sessionHeaderSchema.safeParse({ total_minutes: -5 }).success).toBe(false);
  });

  it('session_date exige formato YYYY-MM-DD si está presente', () => {
    expect(sessionHeaderSchema.safeParse({ session_date: '2026-06-18' }).success).toBe(true);
    expect(sessionHeaderSchema.safeParse({ session_date: '18/06/2026' }).success).toBe(false);
    expect(sessionHeaderSchema.safeParse({ session_date: null }).success).toBe(true);
  });
});

describe('F12 — sessionTaskSchema (override del día)', () => {
  it('exige exercise_id (uuid) y acepta overrides opcionales', () => {
    const r = sessionTaskSchema.parse({
      exercise_id: '11111111-1111-4111-8111-111111111111',
      duration_min: '18',
      series: "2 x 8'",
    });
    expect(r.duration_min).toBe(18);
    expect(r.series).toBe("2 x 8'");
    expect(r.notes).toBeUndefined();
  });

  it('rechaza exercise_id no-uuid', () => {
    expect(sessionTaskSchema.safeParse({ exercise_id: 'abc' }).success).toBe(false);
  });
});

describe('F12 — sessionBlockSchema', () => {
  it('exige un block_type válido y tasks por defecto []', () => {
    const r = sessionBlockSchema.parse({ block_type: 'principal' });
    expect(r.tasks).toEqual([]);
    expect(sessionBlockSchema.safeParse({ block_type: 'x' }).success).toBe(false);
    expect(sessionBlockTypeSchema.safeParse('vuelta_a_la_calma').success).toBe(true);
  });
});

describe('F12.2 — createSessionSchema (alta mínima)', () => {
  it('acepta un objeto vacío (equipo y fecha opcionales)', () => {
    expect(createSessionSchema.safeParse({}).success).toBe(true);
  });

  it('acepta team_id uuid y fecha YYYY-MM-DD; rechaza basura', () => {
    expect(
      createSessionSchema.safeParse({
        team_id: '11111111-1111-4111-8111-111111111111',
        session_date: '2026-09-10',
      }).success
    ).toBe(true);
    expect(createSessionSchema.safeParse({ team_id: 'nope' }).success).toBe(false);
    expect(createSessionSchema.safeParse({ session_date: '10-09-2026' }).success).toBe(false);
  });
});

describe('F12.2 — updateSessionHeaderSchema + toSessionHeaderColumns', () => {
  const id = '22222222-2222-4222-8222-222222222222';

  it('exige id uuid', () => {
    expect(updateSessionHeaderSchema.safeParse({}).success).toBe(false);
    expect(updateSessionHeaderSchema.safeParse({ id }).success).toBe(true);
  });

  it('NO admite visibility (publicar = 12.4): se ignora', () => {
    const r = updateSessionHeaderSchema.parse({ id, visibility: 'team' });
    expect('visibility' in r).toBe(false);
  });

  it('mapea a columnas normalizando vacíos a null', () => {
    const parsed = updateSessionHeaderSchema.parse({
      id,
      title: '  ',
      session_date: '2026-09-10',
      team_id: '33333333-3333-4333-8333-333333333333',
      objective_physical: 'Resistencia',
      tactical_objectives: ['posesion'],
      mesocycle: 'Meso 1',
      microcycle: '   ',
      total_minutes: '90',
    });
    const cols = toSessionHeaderColumns(parsed);
    expect(cols.title).toBeNull();
    expect(cols.microcycle).toBeNull();
    expect(cols.session_date).toBe('2026-09-10');
    expect(cols.team_id).toBe('33333333-3333-4333-8333-333333333333');
    expect(cols.objective_physical).toBe('Resistencia');
    expect(cols.tactical_objectives).toEqual(['posesion']);
    expect(cols.technical_objectives).toEqual([]);
    expect(cols.total_minutes).toBe(90);
  });

  it('team_id null se conserva como null (sin equipo)', () => {
    const cols = toSessionHeaderColumns(updateSessionHeaderSchema.parse({ id, team_id: null }));
    expect(cols.team_id).toBeNull();
  });
});
