import { playerImportRowSchema, type PlayerImportRow } from './schema';

/**
 * Estado por fila tras pasar por validación + dedup. La UI lo pinta como
 * verde/amarillo/rojo. La server action ignora las amarillas/rojas y solo
 * inserta `created`.
 */
export type RowStatus = 'valid' | 'duplicate' | 'invalid';

export type ValidatedRow = {
  index: number;
  status: RowStatus;
  data?: PlayerImportRow;
  /** Código corto i18n (ej: 'date_of_birth_required', 'duplicate_in_db'). */
  reason?: string;
  /** Para `duplicate`, el id del player existente que matchea. */
  existing_player_id?: string;
};

/**
 * Tabla mínima usada por la detección de duplicados — uno por jugador
 * existente en el club. La consulta SELECT del wizard rellena este shape.
 */
export type ExistingPlayer = {
  id: string;
  first_name: string;
  /** NULL permitido per F2.9 hotfix 2026-05-30 (last_name pasó a nullable). */
  last_name: string | null;
  date_of_birth: string;
};

/**
 * Valida una fila contra `playerImportRowSchema`. Devuelve `{ ok, data }` o
 * `{ ok: false, reason }` con el código del primer issue de Zod — ese código
 * coincide con las claves i18n que la UI pinta.
 */
export function validateRow(
  raw: Record<string, unknown>,
  index: number
): ValidatedRow {
  const parsed = playerImportRowSchema.safeParse(raw);
  if (parsed.success) {
    return { index, status: 'valid', data: parsed.data };
  }
  const first = parsed.error.issues[0];
  const reason = first?.message ?? 'invalid_row';
  return { index, status: 'invalid', reason };
}

/**
 * Clave normalizada para el dedup. Per F2.9 hotfix 2026-05-30 el apellido
 * es opcional:
 *   - Si `last_name` presente: dedup por (lower(first), lower(last), dob).
 *   - Si `last_name` NULL/vacío: dedup por (lower(first), dob) — sin
 *     componente de apellido.
 *
 * Esto evita falsos positivos cuando un club tiene dos plantillas
 * concurrentes, una con apellidos y otra sin, del mismo jugador.
 */
export function dedupKey(
  firstName: string,
  lastName: string | null,
  dob: string
): string {
  const f = firstName.trim().toLowerCase();
  const l = (lastName ?? '').trim().toLowerCase();
  if (l.length === 0) return `${f}||${dob}`;
  return `${f}|${l}|${dob}`;
}

/**
 * Recorre las filas YA validadas y marca como `duplicate` aquellas cuya clave
 * exista en la lista de jugadores actuales del club. Filas inválidas se dejan
 * intactas — no participan en el dedup.
 *
 * También detecta duplicados internos del propio archivo: si el archivo trae
 * dos filas con la misma clave, la primera queda `valid` y la siguiente
 * `duplicate` con razón `duplicate_in_file`.
 */
export function detectDuplicates(
  rows: ValidatedRow[],
  existing: ExistingPlayer[]
): ValidatedRow[] {
  const existingKeys = new Map<string, string>();
  for (const p of existing) {
    existingKeys.set(dedupKey(p.first_name, p.last_name, p.date_of_birth), p.id);
  }

  const seenInFile = new Set<string>();

  return rows.map((row) => {
    if (row.status !== 'valid' || !row.data) return row;
    const key = dedupKey(
      row.data.first_name,
      row.data.last_name,
      row.data.date_of_birth
    );
    const existingId = existingKeys.get(key);
    if (existingId) {
      return {
        ...row,
        status: 'duplicate',
        reason: 'duplicate_in_db',
        existing_player_id: existingId,
      };
    }
    if (seenInFile.has(key)) {
      return { ...row, status: 'duplicate', reason: 'duplicate_in_file' };
    }
    seenInFile.add(key);
    return row;
  });
}

/**
 * Resumen para la cabecera del wizard (paso 2) y el resumen final (paso 4).
 */
export function summarize(rows: ValidatedRow[]): {
  valid: number;
  duplicates: number;
  invalid: number;
  total: number;
} {
  let valid = 0,
    duplicates = 0,
    invalid = 0;
  for (const r of rows) {
    if (r.status === 'valid') valid++;
    else if (r.status === 'duplicate') duplicates++;
    else invalid++;
  }
  return { valid, duplicates, invalid, total: rows.length };
}
