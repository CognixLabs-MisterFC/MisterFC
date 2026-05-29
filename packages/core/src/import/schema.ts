import { z } from 'zod';
import { PLAYER_POSITIONS, PLAYER_FEET } from '../schemas/player';

/**
 * Columnas que aceptamos en la plantilla. El orden lo controla el archivo
 * de plantilla en `public/import-templates/`; este array es la fuente de
 * verdad para el matching de headers (case-insensitive, trim) durante el
 * parsing en cliente.
 */
export const PLAYER_IMPORT_COLUMNS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'dorsal',
  'position_main',
  'positions_secondary',
  'foot',
  'height_cm',
  'weight_kg',
  'origin',
] as const;

export type PlayerImportColumn = (typeof PLAYER_IMPORT_COLUMNS)[number];

/**
 * Acepta `YYYY-MM-DD`, `DD/MM/YYYY` y `DD-MM-YYYY`. Normaliza siempre a ISO.
 * Devuelve `null` para entradas vacías (la validación de obligatoriedad va
 * en el field padre con `.refine` o `.min(1)`).
 */
export function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // DD/MM/YYYY o DD-MM-YYYY
  const m = /^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/.exec(s);
  if (m && m[1] && m[2] && m[3]) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // Formato no reconocido — devolvemos el original para que el regex
  // posterior falle con el código `date_of_birth_invalid`.
  return s;
}

const dateOfBirthField = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => normalizeDate(v))
  .refine((v): v is string => v !== null && v.length > 0, {
    message: 'date_of_birth_required',
  })
  .refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), {
    message: 'date_of_birth_invalid',
  })
  .refine(
    (v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const year = d.getUTCFullYear();
      if (year < 1900) return false;
      if (d.getTime() > Date.now()) return false;
      return true;
    },
    { message: 'date_of_birth_invalid' }
  );

const requiredText = (max: number, requiredCode: string, longCode: string) =>
  z
    .union([z.string(), z.number(), z.null()])
    .transform((v) => {
      if (v === null || v === undefined) return '';
      return String(v).trim();
    })
    .refine((v) => v.length > 0, { message: requiredCode })
    .refine((v) => v.length <= max, { message: longCode });

const optionalText = (max: number, longCode: string) =>
  z
    .union([z.string(), z.number(), z.null()])
    .optional()
    .transform((v) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      return s.length > 0 ? s : null;
    })
    .refine((v) => v === null || v.length <= max, { message: longCode });

const dorsalField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s.length === 0) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  })
  .refine((v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 99), {
    message: 'dorsal_invalid',
  });

const positionMainField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toLowerCase();
    return s.length > 0 ? s : null;
  })
  .refine(
    (v) => v === null || (PLAYER_POSITIONS as readonly string[]).includes(v),
    { message: 'position_invalid' }
  )
  .transform((v) => v as (typeof PLAYER_POSITIONS)[number] | null);

const positionsSecondaryField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return [] as string[];
    const s = String(v).trim();
    if (s.length === 0) return [] as string[];
    return s
      .split('|')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);
  })
  .refine(
    (arr) =>
      arr.every((p) => (PLAYER_POSITIONS as readonly string[]).includes(p)),
    { message: 'position_invalid' }
  )
  .refine((arr) => arr.length <= 4, { message: 'positions_secondary_too_many' })
  .transform((arr) => arr as (typeof PLAYER_POSITIONS)[number][]);

const footField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim().toLowerCase();
    return s.length > 0 ? s : null;
  })
  .refine(
    (v) => v === null || (PLAYER_FEET as readonly string[]).includes(v),
    { message: 'foot_invalid' }
  )
  .transform((v) => v as (typeof PLAYER_FEET)[number] | null);

const heightCmField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s.length === 0) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  })
  .refine((v) => v === null || (Number.isInteger(v) && v >= 50 && v <= 250), {
    message: 'height_cm_invalid',
  });

const weightKgField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
    const s = String(v).trim();
    if (s.length === 0) return null;
    // Acepta coma decimal española.
    const n = Number(s.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  })
  .refine((v) => v === null || (Number.isFinite(v) && v >= 10 && v <= 200), {
    message: 'weight_kg_invalid',
  });

/**
 * Schema de fila individual de la plantilla. Tras el parsing en cliente,
 * cada fila se valida con esto. Los códigos de error (`date_of_birth_invalid`,
 * `position_invalid`, etc.) se traducen vía i18n.
 */
export const playerImportRowSchema = z.object({
  first_name: requiredText(80, 'first_name_required', 'first_name_too_long'),
  last_name: requiredText(120, 'last_name_required', 'last_name_too_long'),
  date_of_birth: dateOfBirthField,
  dorsal: dorsalField,
  position_main: positionMainField,
  positions_secondary: positionsSecondaryField,
  foot: footField,
  height_cm: heightCmField,
  weight_kg: weightKgField,
  origin: optionalText(120, 'origin_too_long'),
});

export type PlayerImportRow = z.infer<typeof playerImportRowSchema>;

/**
 * Payload completo del import — validación de tamaño antes del server action.
 * 1-500 filas por subida.
 */
export const playerImportPayloadSchema = z.object({
  rows: z
    .array(playerImportRowSchema)
    .min(1, { message: 'payload_empty' })
    .max(500, { message: 'payload_too_large' }),
  team_id: z
    .string()
    .uuid({ message: 'team_invalid' })
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type PlayerImportPayload = z.infer<typeof playerImportPayloadSchema>;
