import { describe, it, expect } from 'vitest';
import {
  exerciseFormSchema,
  createExerciseSchema,
  statusForAction,
  toExerciseColumns,
  type ExerciseFormInput,
} from '../exercise-form';
import { DIAGRAM_VERSION, type Diagram } from '../../diagram/diagram';

// Datos mínimos válidos del formulario (solo `name`).
const minimal = { name: 'Rondo 4v2' };

describe('F11.6 — exerciseFormSchema: validación', () => {
  it('solo `name` es obligatorio', () => {
    const r = exerciseFormSchema.safeParse(minimal);
    expect(r.success).toBe(true);
  });

  it('rechaza `name` vacío con name_required', () => {
    const r = exerciseFormSchema.safeParse({ name: '   ' });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toBe('name_required');
    }
  });

  it('recorta `name` y normaliza textos vacíos a undefined', () => {
    const r = exerciseFormSchema.safeParse({
      name: '  Rondo  ',
      description: '   ',
      objective: '',
      coaching_points: '  pisar el balón  ',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.name).toBe('Rondo');
      expect(r.data.description).toBeUndefined();
      expect(r.data.objective).toBeUndefined();
      expect(r.data.coaching_points).toBe('pisar el balón');
    }
  });

  it('arrays de taxonomías por defecto vacíos y validados contra el vocabulario', () => {
    const ok = exerciseFormSchema.safeParse(minimal);
    expect(ok.success && ok.data.categories).toEqual([]);

    const bad = exerciseFormSchema.safeParse({
      ...minimal,
      tactical_objectives: ['posesion', 'no_existe'],
    });
    expect(bad.success).toBe(false);
  });

  it('intensity/space_type solo aceptan valores del vocabulario', () => {
    expect(exerciseFormSchema.safeParse({ ...minimal, intensity: 'alta' }).success).toBe(true);
    expect(exerciseFormSchema.safeParse({ ...minimal, intensity: 'brutal' }).success).toBe(false);
    expect(
      exerciseFormSchema.safeParse({ ...minimal, space_type: 'medio_campo' }).success
    ).toBe(true);
  });

  it('base_duration: coacciona string numérico, vacío → undefined, rechaza negativos', () => {
    const a = exerciseFormSchema.safeParse({ ...minimal, base_duration: '20' });
    expect(a.success && a.data.base_duration).toBe(20);

    const b = exerciseFormSchema.safeParse({ ...minimal, base_duration: '' });
    expect(b.success && b.data.base_duration).toBeUndefined();

    expect(exerciseFormSchema.safeParse({ ...minimal, base_duration: -5 }).success).toBe(false);
  });

  it('acepta un diagrama válido y rechaza uno malformado', () => {
    const diagram: Diagram = {
      version: DIAGRAM_VERSION,
      field: { kind: 'completo', orientation: 'vertical' },
      elements: [{ type: 'balon', id: 'el-1', x_pct: 50, y_pct: 50 }],
    };
    expect(exerciseFormSchema.safeParse({ ...minimal, diagram }).success).toBe(true);
    expect(
      exerciseFormSchema.safeParse({ ...minimal, diagram: { version: 99 } }).success
    ).toBe(false);
  });
});

describe('F11.6 — statusForAction: estado por acción/rol', () => {
  it('save_draft → draft (cualquier rol)', () => {
    expect(statusForAction('save_draft', false)).toBe('draft');
    expect(statusForAction('save_draft', true)).toBe('draft');
  });

  it('propose → proposed (cualquier rol)', () => {
    expect(statusForAction('propose', false)).toBe('proposed');
    expect(statusForAction('propose', true)).toBe('proposed');
  });

  it('publish → published SOLO si Admin; si no, null (no permitido)', () => {
    expect(statusForAction('publish', true)).toBe('published');
    expect(statusForAction('publish', false)).toBeNull();
  });
});

describe('F11.6 — createExerciseSchema: incluye la acción', () => {
  it('exige una acción válida', () => {
    expect(createExerciseSchema.safeParse({ ...minimal, action: 'propose' }).success).toBe(true);
    expect(createExerciseSchema.safeParse({ ...minimal, action: 'nope' }).success).toBe(false);
    expect(createExerciseSchema.safeParse(minimal).success).toBe(false);
  });
});

describe('F11.6 — toExerciseColumns: mapeo a columnas', () => {
  const full: ExerciseFormInput = {
    name: 'Rondo',
    description: 'desc',
    objective: undefined,
    coaching_points: undefined,
    variants: undefined,
    players: undefined,
    categories: ['alevin'],
    tactical_objectives: ['posesion'],
    technical_objectives: ['pase'],
    physical_focus: undefined,
    intensity: 'media',
    space_type: 'reducido',
    space_dimensions: '20x20',
    base_duration: 15,
    diagram: undefined,
  };

  it('convierte opcionales ausentes a null y respeta el status dado', () => {
    const cols = toExerciseColumns(full, 'proposed');
    expect(cols.status).toBe('proposed');
    expect(cols.name).toBe('Rondo');
    expect(cols.description).toBe('desc');
    expect(cols.objective).toBeNull();
    expect(cols.physical_focus).toBeNull();
    expect(cols.intensity).toBe('media');
    expect(cols.base_duration).toBe(15);
    expect(cols.categories).toEqual(['alevin']);
  });

  it('un diagrama sin elementos no se persiste (→ null)', () => {
    const empty: Diagram = {
      version: DIAGRAM_VERSION,
      field: { kind: 'completo', orientation: 'vertical' },
      elements: [],
    };
    expect(toExerciseColumns({ ...full, diagram: empty }, 'draft').diagram).toBeNull();
  });

  it('un diagrama con elementos se conserva', () => {
    const d: Diagram = {
      version: DIAGRAM_VERSION,
      field: { kind: 'medio', orientation: 'vertical' },
      elements: [{ type: 'cono', id: 'el-1', x_pct: 10, y_pct: 10 }],
    };
    expect(toExerciseColumns({ ...full, diagram: d }, 'draft').diagram).toEqual(d);
  });
});
