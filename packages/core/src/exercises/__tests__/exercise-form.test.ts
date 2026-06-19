import { describe, it, expect } from 'vitest';
import {
  exerciseFormSchema,
  createExerciseSchema,
  updateExerciseSchema,
  exerciseIdSchema,
  rejectExerciseSchema,
  statusForAction,
  statusForUpdate,
  toExerciseColumns,
  EXERCISE_EXPORT_VERSION,
  buildExerciseExport,
  parseExerciseImport,
  type ExerciseFormInput,
  type ExerciseExportContent,
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

  it('phases (12.7a): vacío por defecto, acepta tipos de bloque y rechaza inválidos', () => {
    const def = exerciseFormSchema.safeParse(minimal);
    expect(def.success && def.data.phases).toEqual([]);
    expect(
      exerciseFormSchema.safeParse({ ...minimal, phases: ['calentamiento', 'principal'] }).success
    ).toBe(true);
    expect(exerciseFormSchema.safeParse({ ...minimal, phases: ['inventada'] }).success).toBe(false);
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

  it('12.7b — ejercicio SIN campo (solo texto): válido y diagram → null', () => {
    const textOnly = { name: 'Estiramientos', description: 'Tren inferior 8 min' };
    const r = exerciseFormSchema.safeParse(textOnly);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.diagram == null).toBe(true);
      expect(toExerciseColumns(r.data, 'draft').diagram).toBeNull();
    }
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

const UUID = '11111111-1111-4111-8111-111111111111';

describe('F11.6 PR2 — updateExerciseSchema: id + acción', () => {
  it('exige id uuid válido y acción', () => {
    expect(
      updateExerciseSchema.safeParse({ ...minimal, id: UUID, action: 'propose' }).success
    ).toBe(true);
    expect(
      updateExerciseSchema.safeParse({ ...minimal, id: 'no-uuid', action: 'propose' }).success
    ).toBe(false);
    expect(updateExerciseSchema.safeParse({ ...minimal, action: 'propose' }).success).toBe(false);
  });
});

describe('F11.6 PR2 — exerciseIdSchema: acciones sin formulario', () => {
  it('acepta un id uuid y rechaza lo demás', () => {
    expect(exerciseIdSchema.safeParse({ id: UUID }).success).toBe(true);
    expect(exerciseIdSchema.safeParse({ id: 'x' }).success).toBe(false);
    expect(exerciseIdSchema.safeParse({}).success).toBe(false);
  });
});

describe('F11.6 PR2 — statusForUpdate: estado objetivo por estado actual', () => {
  it('desde draft: set completo (publish solo Admin)', () => {
    expect(statusForUpdate('draft', 'save_draft', false)).toBe('draft');
    expect(statusForUpdate('draft', 'propose', false)).toBe('proposed');
    expect(statusForUpdate('draft', 'publish', true)).toBe('published');
    expect(statusForUpdate('draft', 'publish', false)).toBeNull();
  });

  it('desde proposed: SOLO sigue propuesto (sin aprobar aquí, eso es 11.7)', () => {
    expect(statusForUpdate('proposed', 'propose', false)).toBe('proposed');
    expect(statusForUpdate('proposed', 'propose', true)).toBe('proposed');
    // Ni el Admin publica desde el editor de un propuesto.
    expect(statusForUpdate('proposed', 'publish', true)).toBeNull();
    expect(statusForUpdate('proposed', 'save_draft', false)).toBeNull();
  });

  it('desde rejected: el autor corrige y reprone (como draft, sin publicar)', () => {
    expect(statusForUpdate('rejected', 'propose', false)).toBe('proposed');
    expect(statusForUpdate('rejected', 'save_draft', false)).toBe('draft');
    // Ni el Admin publica desde el editor de un rechazado.
    expect(statusForUpdate('rejected', 'publish', true)).toBeNull();
  });

  it('desde published (12.7a): SOLO el Admin edita en sitio y sigue publicado', () => {
    expect(statusForUpdate('published', 'publish', true)).toBe('published');
    // El no-Admin no puede editar un publicado.
    expect(statusForUpdate('published', 'publish', false)).toBeNull();
    // El Admin no lo "despublica" con otras acciones (defensa: solo 'publish').
    expect(statusForUpdate('published', 'save_draft', true)).toBeNull();
    expect(statusForUpdate('published', 'propose', true)).toBeNull();
  });
});

describe('F11.7 — rejectExerciseSchema: motivo obligatorio', () => {
  it('exige id uuid y motivo no vacío', () => {
    expect(rejectExerciseSchema.safeParse({ id: UUID, reason: 'Falta el objetivo' }).success).toBe(true);
    expect(rejectExerciseSchema.safeParse({ id: UUID, reason: '   ' }).success).toBe(false);
    expect(rejectExerciseSchema.safeParse({ id: UUID }).success).toBe(false);
    expect(rejectExerciseSchema.safeParse({ id: 'x', reason: 'ok' }).success).toBe(false);
  });

  it('recorta el motivo', () => {
    const r = rejectExerciseSchema.safeParse({ id: UUID, reason: '  corrige el espacio  ' });
    expect(r.success && r.data.reason).toBe('corrige el espacio');
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
    phases: ['principal'],
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
    expect(cols.phases).toEqual(['principal']);
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

describe('F11.8 — buildExerciseExport: envoltorio versionado + solo contenido', () => {
  const content: ExerciseExportContent = {
    name: 'Rondo 4v2',
    categories: ['alevin'],
    tactical_objectives: ['posesion'],
    technical_objectives: ['pase'],
    phases: ['principal'],
    physical_focus: null,
    intensity: 'media',
    space_type: 'reducido',
    space_dimensions: '20x20',
    base_duration: 15,
    description: 'desc',
    objective: null,
    coaching_points: null,
    variants: null,
    players: null,
    diagram: null,
  };

  it('envuelve con version y omite los opcionales nulos', () => {
    const out = buildExerciseExport(content);
    expect(out.version).toBe(EXERCISE_EXPORT_VERSION);
    expect(out.exercise.name).toBe('Rondo 4v2');
    expect(out.exercise.intensity).toBe('media');
    expect(out.exercise.base_duration).toBe(15);
    expect('physical_focus' in out.exercise).toBe(false);
    expect('objective' in out.exercise).toBe(false);
    expect('diagram' in out.exercise).toBe(false);
    expect(out.exercise.phases).toEqual(['principal']);
  });

  it('sanea las fases invalidas y conserva las validas (round-trip)', () => {
    const out = buildExerciseExport({
      ...content,
      phases: ['principal', 'inventada', 'calentamiento'],
    });
    expect(out.exercise.phases).toEqual(['principal', 'calentamiento']);
    expect(exerciseFormSchema.safeParse(out.exercise).success).toBe(true);
  });

  it('NO incluye campos de BD/ciclo (round-trip válido)', () => {
    const out = buildExerciseExport(content);
    const keys = Object.keys(out.exercise);
    for (const banned of ['id', 'owner_profile_id', 'club_id', 'status', 'approved_by', 'created_at', 'archived_at']) {
      expect(keys).not.toContain(banned);
    }
    // El contenido exportado vuelve a validar como formulario.
    expect(exerciseFormSchema.safeParse(out.exercise).success).toBe(true);
  });

  it('incluye el diagrama si tiene elementos', () => {
    const d: Diagram = {
      version: DIAGRAM_VERSION,
      field: { kind: 'medio', orientation: 'vertical' },
      elements: [{ type: 'balon', id: 'el-1', x_pct: 40, y_pct: 40 }],
    };
    const out = buildExerciseExport({ ...content, diagram: d });
    expect(out.exercise.diagram).toEqual(d);
  });
});

describe('F11.8 — parseExerciseImport: validación del JSON importado', () => {
  const valid = {
    version: EXERCISE_EXPORT_VERSION,
    exercise: { name: 'Importado', tactical_objectives: ['posesion'] },
  };

  it('acepta un envoltorio válido y devuelve el contenido', () => {
    const r = parseExerciseImport(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.exercise.name).toBe('Importado');
  });

  it('rechaza version incorrecta o ausente', () => {
    expect(parseExerciseImport({ version: 99, exercise: { name: 'X' } }).success).toBe(false);
    expect(parseExerciseImport({ exercise: { name: 'X' } }).success).toBe(false);
  });

  it('rechaza contenido inválido (sin name)', () => {
    expect(
      parseExerciseImport({ version: EXERCISE_EXPORT_VERSION, exercise: {} }).success
    ).toBe(false);
  });

  it('rechaza un diagrama corrupto', () => {
    const r = parseExerciseImport({
      version: EXERCISE_EXPORT_VERSION,
      exercise: { name: 'X', diagram: { version: 1, field: {}, elements: [{ type: 'nope' }] } },
    });
    expect(r.success).toBe(false);
  });
});
