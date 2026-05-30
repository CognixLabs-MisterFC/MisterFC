import { describe, it, expect } from 'vitest';
import {
  playerImportRowSchema,
  playerImportPayloadSchema,
  normalizeDate,
} from '../schema';

/**
 * Validación por fila. Cubre el hotfix F2.9 2026-05-30:
 *   - A: parser bilingüe headers (testeado en parse.test.ts).
 *   - B: enum bilingüe (castellano / inglés / sinónimos / acentos).
 *   - C: validación relajada (solo Nombre + DOB obligatorios) y formato fecha
 *        España como primario + Excel serial number + fallback ISO.
 */
describe('playerImportRowSchema — validación por fila', () => {
  const base = {
    first_name: 'Pepe',
    last_name: 'Gomez',
    date_of_birth: '2010-05-15',
  };

  // ─────────────────── Fechas ───────────────────

  it('acepta fecha YYYY-MM-DD (ISO fallback)', () => {
    const r = playerImportRowSchema.safeParse({ ...base });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-05-15');
  });

  it('normaliza fecha DD/MM/YYYY a ISO (España, primario)', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '15/03/2010' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-03-15');
  });

  it('normaliza fecha DD-MM-YYYY a ISO', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '15-03-2010' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-03-15');
  });

  it('acepta Date nativo (read-excel-file con celda formato Date)', () => {
    const d = new Date(Date.UTC(2010, 2, 15));
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: d });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-03-15');
  });

  it('acepta Excel serial number (40252 → 2010-03-15)', () => {
    // 40252 = 2010-03-15 en serial Excel (1900-based).
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: 40252 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.date_of_birth).toBe('2010-03-15');
  });

  it('falla con formato inválido ("15.03") con código date_of_birth_invalid', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '15.03' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('date_of_birth_invalid');
  });

  it('falla sin date_of_birth con código date_of_birth_required', () => {
    const r = playerImportRowSchema.safeParse({ ...base, date_of_birth: '' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('date_of_birth_required');
  });

  // ─────────────────── Validación relajada (last_name opcional) ───────────────────

  it('entra con solo Nombre + DOB (apellidos vacío → null)', () => {
    const r = playerImportRowSchema.safeParse({
      first_name: 'Solo',
      last_name: '',
      date_of_birth: '15/03/2010',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.first_name).toBe('Solo');
      expect(r.data.last_name).toBeNull();
      expect(r.data.date_of_birth).toBe('2010-03-15');
    }
  });

  it('entra con Nombre + DOB y last_name omitido del payload', () => {
    const r = playerImportRowSchema.safeParse({
      first_name: 'Solo',
      date_of_birth: '15/03/2010',
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.last_name).toBeNull();
  });

  it('falla sin Nombre con código first_name_required', () => {
    const r = playerImportRowSchema.safeParse({
      first_name: '',
      last_name: 'Gomez',
      date_of_birth: '15/03/2010',
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('first_name_required');
  });

  // ─────────────────── Dorsal ───────────────────

  it('falla con dorsal fuera de rango (0, 100, -1, abc)', () => {
    for (const bad of [0, 100, -1, 'abc']) {
      const r = playerImportRowSchema.safeParse({ ...base, dorsal: bad });
      expect(r.success, `dorsal=${bad}`).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe('dorsal_invalid');
    }
  });

  // ─────────────────── Enums bilingües (Parte B) ───────────────────

  it('position_main castellano "Delantero" → forward', () => {
    const r = playerImportRowSchema.safeParse({ ...base, position_main: 'Delantero' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.position_main).toBe('forward');
  });

  it('position_main case-insensitive ("DELANTERO" y "delantero")', () => {
    for (const v of ['DELANTERO', 'delantero', 'Delantero', '  Delantero  ']) {
      const r = playerImportRowSchema.safeParse({ ...base, position_main: v });
      expect(r.success, v).toBe(true);
      if (r.success) expect(r.data.position_main).toBe('forward');
    }
  });

  it('position_main sin tildes ("Portéro" tolera el acento añadido)', () => {
    const r = playerImportRowSchema.safeParse({ ...base, position_main: 'Portéro' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.position_main).toBe('goalkeeper');
  });

  it('position_main sinónimos (Lateral/Central/Defensa → defender)', () => {
    for (const v of ['Lateral', 'Central', 'Defensa', 'Zaguero']) {
      const r = playerImportRowSchema.safeParse({ ...base, position_main: v });
      expect(r.success, v).toBe(true);
      if (r.success) expect(r.data.position_main).toBe('defender');
    }
  });

  it('position_main sinónimos (Mediocentro/Mediocampista/Centrocampista → midfielder)', () => {
    for (const v of ['Mediocentro', 'Mediocampista', 'Centrocampista', 'Pivote']) {
      const r = playerImportRowSchema.safeParse({ ...base, position_main: v });
      expect(r.success, v).toBe(true);
      if (r.success) expect(r.data.position_main).toBe('midfielder');
    }
  });

  it('position_main inglés retro-compat (midfielder → midfielder)', () => {
    const r = playerImportRowSchema.safeParse({ ...base, position_main: 'midfielder' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.position_main).toBe('midfielder');
  });

  it('position_main rechaza valor desconocido con position_invalid', () => {
    const r = playerImportRowSchema.safeParse({ ...base, position_main: 'inventado-XYZ' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('position_invalid');
  });

  it('positions_secondary split por | y resuelve castellano', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: 'Defensa|Mediocentro',
    });
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.positions_secondary).toEqual(['defender', 'midfielder']);
  });

  it('positions_secondary split por coma también (lista castellana natural)', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: 'Defensa, Delantero',
    });
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.positions_secondary).toEqual(['defender', 'forward']);
  });

  it('foot castellano (Derecho/Zurdo/Ambidiestro)', () => {
    const right = playerImportRowSchema.safeParse({ ...base, foot: 'Derecho' });
    const left = playerImportRowSchema.safeParse({ ...base, foot: 'Zurdo' });
    const both = playerImportRowSchema.safeParse({ ...base, foot: 'Ambidiestro' });
    expect(right.success && right.data.foot).toBe('right');
    expect(left.success && left.data.foot).toBe('left');
    expect(both.success && both.data.foot).toBe('both');
  });

  it('foot inglés retro-compat (right/left/both)', () => {
    const r = playerImportRowSchema.safeParse({ ...base, foot: 'left' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.foot).toBe('left');
  });

  it('foot rechaza valor desconocido con foot_invalid', () => {
    const r = playerImportRowSchema.safeParse({ ...base, foot: 'culo' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toBe('foot_invalid');
  });

  // ─────────────────── Numéricos ───────────────────

  it('weight_kg acepta coma y punto decimal, ambos a 72.5', () => {
    const comma = playerImportRowSchema.safeParse({ ...base, weight_kg: '72,5' });
    const dot = playerImportRowSchema.safeParse({ ...base, weight_kg: '72.5' });
    expect(comma.success).toBe(true);
    expect(dot.success).toBe(true);
    if (comma.success) expect(comma.data.weight_kg).toBe(72.5);
    if (dot.success) expect(dot.data.weight_kg).toBe(72.5);
  });

  it('height_cm fuera de rango falla con height_cm_invalid', () => {
    for (const bad of [49, 251, 'no-num']) {
      const r = playerImportRowSchema.safeParse({ ...base, height_cm: bad });
      expect(r.success, `height=${bad}`).toBe(false);
      if (!r.success) expect(r.error.issues[0]?.message).toBe('height_cm_invalid');
    }
  });
});

describe('normalizeDate', () => {
  it('devuelve null para vacío/null/undefined', () => {
    expect(normalizeDate('')).toBe(null);
    expect(normalizeDate(null)).toBe(null);
    expect(normalizeDate(undefined)).toBe(null);
  });

  it('Date nativo → ISO yyyy-mm-dd', () => {
    expect(normalizeDate(new Date(Date.UTC(2010, 4, 15)))).toBe('2010-05-15');
  });

  it('Excel serial razonable → ISO', () => {
    expect(normalizeDate(40313)).toBe('2010-05-15');
  });

  it('Excel serial fuera de rango → null (downstream falla)', () => {
    expect(normalizeDate(0.5)).toBe(null);
    expect(normalizeDate(999999)).toBe(null);
  });

  it('dd/mm/yyyy con punto como separador también funciona', () => {
    expect(normalizeDate('15.03.2010')).toBe('2010-03-15');
  });
});

/**
 * Round-trip — el cliente envía al server action el OUTPUT de
 * `playerImportRowSchema.parse()` (transformado: dorsal=number,
 * positions_secondary=string[], date_of_birth=ISO, etc.). El server re-valida
 * con `playerImportPayloadSchema`, que reutiliza `playerImportRowSchema`. La
 * forma transformada DEBE volver a pasar la validación; si no, el server
 * responde "invalid_payload" y el import devuelve 0 creados.
 *
 * Regresión del bug F2.9 post-piloto 2026-05-30:
 *   `positions_secondary` salía como `string[]` pero el input union sólo
 *   aceptaba `string | null` → fallaba en cuanto el row pasaba al server.
 */
describe('round-trip: el output del schema vuelve a parsear (server re-valida)', () => {
  const base = {
    first_name: 'Pepe',
    last_name: 'Gomez',
    date_of_birth: '15/03/2010',
  };

  it('row mínima (solo obligatorios) re-parsea OK', () => {
    const first = playerImportRowSchema.safeParse({
      first_name: 'Solo',
      date_of_birth: '15/03/2010',
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    const second = playerImportRowSchema.safeParse(first.data);
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data).toEqual(first.data);
    }
  });

  it('row completa (todos los campos opcionales) re-parsea OK', () => {
    const first = playerImportRowSchema.safeParse({
      ...base,
      dorsal: 7,
      position_main: 'Delantero',
      positions_secondary: 'Mediocentro|Extremo',
      foot: 'Derecho',
      height_cm: 180,
      weight_kg: '72,5',
      origin: 'Cantera',
    });
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.data.positions_secondary).toEqual(['midfielder', 'forward']);
    const second = playerImportRowSchema.safeParse(first.data);
    expect(second.success).toBe(true);
    if (second.success) {
      expect(second.data).toEqual(first.data);
    }
  });

  it('positions_secondary = [] (vacío) re-parsea OK', () => {
    const first = playerImportRowSchema.safeParse(base);
    expect(first.success).toBe(true);
    if (!first.success) return;
    expect(first.data.positions_secondary).toEqual([]);
    const second = playerImportRowSchema.safeParse(first.data);
    expect(second.success).toBe(true);
  });

  it('positions_secondary = string[] canónico (sin transform) re-parsea OK', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: ['defender', 'forward'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.positions_secondary).toEqual(['defender', 'forward']);
    }
  });

  it('positions_secondary array castellano se resuelve a canónico', () => {
    const r = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: ['Mediocentro', 'Delantero'],
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.positions_secondary).toEqual(['midfielder', 'forward']);
    }
  });

  it('payload completo (rows + team_id) re-parsea OK', () => {
    const r1 = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: 'Defensa, Mediocentro',
    });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    const payload = {
      rows: [r1.data],
      // UUID v4 válido (Zod en este schema rechaza UUIDs nil con [1-8] middle).
      team_id: 'a3b1c2d4-e5f6-4789-8abc-1234567890ab',
    };
    const r2 = playerImportPayloadSchema.safeParse(payload);
    expect(r2.success).toBe(true);
  });

  it('payload con team_id=null re-parsea OK (caso "sin equipo asignado")', () => {
    const r1 = playerImportRowSchema.safeParse({
      ...base,
      positions_secondary: ['defender'],
    });
    expect(r1.success).toBe(true);
    if (!r1.success) return;
    const r2 = playerImportPayloadSchema.safeParse({
      rows: [r1.data],
      team_id: null,
    });
    expect(r2.success).toBe(true);
  });
});
