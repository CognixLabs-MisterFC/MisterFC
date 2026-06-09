import { z } from 'zod';
import { PLAYER_POSITIONS, PLAYER_FEET } from '../schemas/player';

/**
 * Columnas que aceptamos en la plantilla. El orden lo controla el archivo
 * de plantilla en `public/import-templates/`; este array es la fuente de
 * verdad para el matching de headers (case-insensitive, trim, sin acentos)
 * durante el parsing en cliente.
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
  // Rework A (A5) — equipo por fila (nombre; se resuelve a team_id en club +
  // temporada activa) e email de contacto/invitación (🔒 O2; solo se guarda).
  'team',
  'invite_email',
] as const;

export type PlayerImportColumn = (typeof PLAYER_IMPORT_COLUMNS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Fechas — soporte primario dd/mm/yyyy (España), secundarios dd-mm-yyyy,
// yyyy-mm-dd (ISO), y Excel serial (cuando la celda viene como número).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Excel guarda fechas como número de días desde 1900-01-01 (con un bug
 * histórico: trata 1900 como año bisiesto). Para >= 1900-03-01 (serial 61
 * en adelante) basta restar 25569 y multiplicar por 86_400_000.
 *
 * Convertimos a UTC midnight ISO yyyy-mm-dd. Si el serial está fuera de
 * rango razonable (< 1 o > 100k), devolvemos null para que la validación
 * downstream falle con "date_of_birth_invalid".
 */
function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 100_000) return null;
  const ms = (serial - 25_569) * 86_400_000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Normaliza una fecha en input crudo a ISO `yyyy-mm-dd`.
 *
 * Acepta:
 *  - `dd/mm/yyyy` (primario, formato España: 15/03/2010).
 *  - `dd-mm-yyyy` (secundario: 15-03-2010).
 *  - `yyyy-mm-dd` (ISO fallback: 2010-03-15).
 *  - Excel serial number (la celda viene como `number` cuando el usuario
 *    marca formato Date nativo en Excel).
 *  - Date object (read-excel-file devuelve Date para celdas con formato).
 *
 * Devuelve `null` si el input está vacío. Devuelve el original (sin
 * normalizar) si el formato no se reconoce, para que la validación
 * downstream lo marque como `date_of_birth_invalid` con un mensaje claro.
 */
export function normalizeDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;

  // Excel serial (Date nativo o número entero/decimal).
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    const yyyy = raw.getUTCFullYear();
    const mm = String(raw.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(raw.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (typeof raw === 'number') {
    return excelSerialToIso(raw);
  }

  const s = String(raw).trim();
  if (s.length === 0) return null;

  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // dd/mm/yyyy o dd-mm-yyyy
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(s);
  if (m && m[1] && m[2] && m[3]) {
    const dd = m[1].padStart(2, '0');
    const mm = m[2].padStart(2, '0');
    const yyyy = m[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  // No reconocido — devolvemos el original para que el regex posterior falle
  // con `date_of_birth_invalid`. La UI muestra el valor original al user.
  return s;
}

const dateOfBirthField = z
  .union([z.string(), z.number(), z.null(), z.date()])
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

// ─────────────────────────────────────────────────────────────────────────────
// Texto requerido / opcional
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// Enums bilingües (castellano + retro-compat inglés + sinónimos)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normaliza texto para comparación de enums:
 *   - lowercase
 *   - trim
 *   - quita acentos (NFD + strip diacritics) — `delantero` = `Deléntero`
 */
function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Mapa de aliases para `position_main` y `positions_secondary`. Las claves
 * están en formato folded (sin acentos, lowercase). El valor es el enum
 * canónico inglés que persiste BD.
 */
export const POSITION_VALUE_MAP: Record<string, (typeof PLAYER_POSITIONS)[number]> = {
  // goalkeeper
  goalkeeper: 'goalkeeper',
  portero: 'goalkeeper',
  portera: 'goalkeeper',
  arquero: 'goalkeeper',
  // defender
  defender: 'defender',
  defensa: 'defender',
  defensor: 'defender',
  central: 'defender',
  lateral: 'defender',
  'lateral derecho': 'defender',
  'lateral izquierdo': 'defender',
  zaguero: 'defender',
  libero: 'defender',
  // midfielder
  midfielder: 'midfielder',
  mediocentro: 'midfielder',
  mediocampista: 'midfielder',
  centrocampista: 'midfielder',
  medio: 'midfielder',
  'medio centro': 'midfielder',
  'medio ofensivo': 'midfielder',
  'medio defensivo': 'midfielder',
  interior: 'midfielder',
  pivote: 'midfielder',
  // forward
  forward: 'forward',
  delantero: 'forward',
  delantera: 'forward',
  atacante: 'forward',
  extremo: 'forward',
  'extremo derecho': 'forward',
  'extremo izquierdo': 'forward',
  punta: 'forward',
  ariete: 'forward',
  '9': 'forward',
};

/** Etiquetas castellano para mostrar como "opciones aceptadas" en errores. */
export const POSITION_LABELS_ES = [
  'Portero',
  'Defensa',
  'Lateral',
  'Mediocentro',
  'Delantero',
  'Extremo',
] as const;

export const FOOT_VALUE_MAP: Record<string, (typeof PLAYER_FEET)[number]> = {
  right: 'right',
  derecho: 'right',
  derecha: 'right',
  diestro: 'right',
  'pie derecho': 'right',
  d: 'right',
  left: 'left',
  izquierdo: 'left',
  izquierda: 'left',
  zurdo: 'left',
  'pie izquierdo': 'left',
  i: 'left',
  z: 'left',
  both: 'both',
  ambos: 'both',
  'los dos': 'both',
  ambidiestro: 'both',
  ambidextro: 'both',
};

export const FOOT_LABELS_ES = ['Derecho', 'Izquierdo', 'Ambidiestro'] as const;

function resolvePosition(raw: string): (typeof PLAYER_POSITIONS)[number] | undefined {
  return POSITION_VALUE_MAP[fold(raw)];
}

function resolveFoot(raw: string): (typeof PLAYER_FEET)[number] | undefined {
  return FOOT_VALUE_MAP[fold(raw)];
}

const positionMainField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s.length === 0) return null;
    return resolvePosition(s) ?? s; // si no resuelve, deja el raw para que falle el refine
  })
  .refine(
    (v) => v === null || (PLAYER_POSITIONS as readonly string[]).includes(v),
    { message: 'position_invalid' }
  )
  .transform((v) => v as (typeof PLAYER_POSITIONS)[number] | null);

// Acepta también `string[]` en input para que el round-trip funcione: el
// cliente envía al server action el OUTPUT ya transformado (array de enums
// canónicos) y el server re-valida con el mismo schema. Sin esto, cualquier
// import devuelve "invalid_payload". Regresión bug F2.9 post-piloto 2026-05-30.
const positionsSecondaryField = z
  .union([z.string(), z.null(), z.array(z.string())])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return [] as string[];
    if (Array.isArray(v)) {
      return v
        .map((p) => String(p).trim())
        .filter((p) => p.length > 0)
        .map((p) => resolvePosition(p) ?? p);
    }
    const s = String(v).trim();
    if (s.length === 0) return [] as string[];
    return s
      .split(/[|,;/]/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
      .map((p) => resolvePosition(p) ?? p);
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
    const s = String(v).trim();
    if (s.length === 0) return null;
    return resolveFoot(s) ?? s;
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

// ─────────────────────────────────────────────────────────────────────────────
// Rework A (A5) — equipo por fila + email de contacto/invitación (🔒 O2).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Nombre del equipo por fila (p.ej. "Infantil B"). Opcional: la resolución
 * nombre → team_id (dentro del club + temporada activa) la hace la capa de
 * negocio (validate.resolveTeamName); aquí solo se valida que sea texto corto.
 */
const teamField = optionalText(80, 'team_too_long');

/**
 * 🔒 O2 — email de contacto/invitación. Opcional. El regex es el mismo que la
 * constraint de BD (`players.invite_email`): un @, sin espacios, dominio con
 * punto. Así todo valor aceptado aquí pasa también la constraint.
 */
const INVITE_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const inviteEmailField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  })
  .refine((v) => v === null || v.length <= 254, { message: 'invite_email_invalid' })
  .refine((v) => v === null || INVITE_EMAIL_RE.test(v), {
    message: 'invite_email_invalid',
  });

// ─────────────────────────────────────────────────────────────────────────────
// Row schema — validación relajada per F2.9 hotfix 2026-05-30:
// solo `first_name` + `date_of_birth` son obligatorios. `last_name` ahora
// es opcional (NULL en BD) — ver migración 20260603000002.
// ─────────────────────────────────────────────────────────────────────────────

export const playerImportRowSchema = z.object({
  first_name: requiredText(80, 'first_name_required', 'first_name_too_long'),
  last_name: optionalText(120, 'last_name_too_long'),
  date_of_birth: dateOfBirthField,
  dorsal: dorsalField,
  position_main: positionMainField,
  positions_secondary: positionsSecondaryField,
  foot: footField,
  height_cm: heightCmField,
  weight_kg: weightKgField,
  origin: optionalText(120, 'origin_too_long'),
  team: teamField,
  invite_email: inviteEmailField,
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
