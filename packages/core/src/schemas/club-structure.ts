import { z } from 'zod';

const nameField = z
  .string()
  .trim()
  .min(1, { message: 'name_required' })
  .max(80, { message: 'name_too_long' });

const seasonField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}$/, { message: 'season_invalid' });

const orderField = z.coerce
  .number()
  .int()
  .min(0)
  .max(9999)
  .optional()
  .default(0);

export const TEAM_FORMATS = ['F7', 'F8', 'F11'] as const;

const formatField = z.enum(TEAM_FORMATS, { message: 'format_invalid' });

const colorField = z
  .string()
  .trim()
  .regex(/^#[0-9A-Fa-f]{6}$/, { message: 'color_invalid' });

/**
 * 🔒 O1 — Grupos de edad normalizados (categories.kind). Mismo conjunto que el
 * backfill de la migración 20260616000000 y que substitution_regimes.
 */
export const CATEGORY_KINDS = [
  'querubin',
  'prebenjamin',
  'benjamin',
  'alevin',
  'infantil',
  'cadete',
  'juvenil',
  'amateur',
  'senior',
  'veterano',
] as const;

export type CategoryKind = (typeof CATEGORY_KINDS)[number];

/**
 * 🔒 O1 — Orden de listado de categorías-plantilla derivado del `kind` (edad),
 * no de un order_idx manual. `kind = null` → al final (CATEGORY_KIND_ORDER_NULL);
 * el desempate por nombre (collation `es`, case-insensitive) lo aplica la lectura.
 */
export const CATEGORY_KIND_ORDER: Record<CategoryKind, number> = {
  querubin: 1,
  prebenjamin: 2,
  benjamin: 3,
  alevin: 4,
  infantil: 5,
  cadete: 6,
  juvenil: 7,
  amateur: 8,
  senior: 9,
  veterano: 10,
};

/** Ordinal para `kind = null` o desconocido: al final del listado. */
export const CATEGORY_KIND_ORDER_NULL = 99;

/** Ordinal de orden para un kind (null/desconocido → CATEGORY_KIND_ORDER_NULL). */
export function categoryKindOrdinal(kind: string | null | undefined): number {
  if (kind && kind in CATEGORY_KIND_ORDER) {
    return CATEGORY_KIND_ORDER[kind as CategoryKind];
  }
  return CATEGORY_KIND_ORDER_NULL;
}

/**
 * Categoría dentro de un club y temporada (esquema legacy de /categorias, retirado
 * en A4). Se conserva para compatibilidad de importaciones; el alta de plantilla
 * usa `categoryTemplateSchema`.
 */
export const categorySchema = z.object({
  name: nameField,
  season: seasonField,
  order_idx: orderField,
});

export type CategoryInput = z.infer<typeof categorySchema>;

const halfDurationField = z.coerce
  .number({ message: 'half_duration_invalid' })
  .int({ message: 'half_duration_invalid' })
  .min(1, { message: 'half_duration_invalid' })
  .max(90, { message: 'half_duration_invalid' });

/**
 * 🔒 D1/O1 — `kind` de la categoría-plantilla. Opcional: las plantillas sin grupo
 * de edad (kind null) ordenan al final y no exponen divisiones. '' → null.
 */
const kindField = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || (CATEGORY_KINDS as readonly string[]).includes(v), {
    message: 'kind_invalid',
  });

/**
 * 🔒 D1 — Categoría-plantilla permanente del club: `name + kind +
 * half_duration_minutes`. SIN season ni order_idx (la temporada vive en el equipo;
 * el orden se deriva de kind). Alta/renombrado en /equipos/plantillas.
 */
export const categoryTemplateSchema = z.object({
  name: nameField,
  kind: kindField,
  half_duration_minutes: halfDurationField,
});

export type CategoryTemplateInput = z.infer<typeof categoryTemplateSchema>;

/**
 * División (slug) en la que juega el equipo (F7.6c). Opcional: las categorías
 * sin divisiones cargadas (p.ej. adultas) no la exigen. '' se trata como ausente.
 * La validez del slug para la categoría la comprueba la server action contra
 * `substitution_regimes` (catálogo de divisiones por categoría).
 */
const divisionField = z
  .string()
  .trim()
  .max(40, { message: 'division_invalid' })
  .optional()
  .transform((v) => (v ? v : undefined));

/** Equipo dentro de una categoría (edición: name + format + color + division). */
export const teamSchema = z.object({
  name: nameField,
  format: formatField,
  color: colorField,
  division: divisionField,
});

export type TeamInput = z.infer<typeof teamSchema>;

/**
 * 🔒 D2/D4 — Alta de equipo desde /equipos: temporada + categoría (plantilla) +
 * división + nombre (+ formato + color). `club_id` lo pone el trigger
 * teams_derive_from_category desde la categoría; aquí no se pide.
 */
export const teamCreateSchema = z.object({
  category_id: z.string().uuid({ message: 'category_invalid' }),
  season: seasonField,
  name: nameField,
  format: formatField,
  color: colorField,
  division: divisionField,
});

export type TeamCreateInput = z.infer<typeof teamCreateSchema>;

/**
 * Devuelve la temporada actual en formato `YYYY-YY`. Heurística pensada para
 * fútbol español: la temporada cambia a 1 de agosto.
 */
export function currentSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-12
  const start = month >= 8 ? year : year - 1;
  const endTwo = String((start + 1) % 100).padStart(2, '0');
  return `${start}-${endTwo}`;
}

/**
 * 🔒 Rework C (C3) — catálogo gestionado de categorías-plantilla.
 *
 * Las categorías estándar (`is_standard=true`) no se borran ni se renombran (ni
 * se cambia su `kind`); solo `half_duration_minutes` es editable. Las custom
 * (`is_standard=false`) son editables y borrables solo si no tienen equipos (el
 * FK teams.category_id es CASCADE: borrar con equipos destruiría histórico — el
 * blindaje a nivel BD llega en C4; aquí el guard es de app/servidor).
 */
export type CategoryDeleteVerdict = 'ok' | 'is_standard' | 'has_teams';

export function assertCategoryDeletable(params: {
  isStandard: boolean;
  teamsCount: number;
}): CategoryDeleteVerdict {
  if (params.isStandard) return 'is_standard';
  if (params.teamsCount > 0) return 'has_teams';
  return 'ok';
}

/**
 * Resuelve los campos efectivos de un UPDATE de categoría según `is_standard`.
 * Para una estándar, `name` y `kind` quedan CONGELADOS al valor actual (se ignora
 * lo que venga del form); solo cambia `half_duration_minutes`. Para una custom,
 * se aplican los tres campos del input. El servidor es el contrato final: aunque
 * el cliente bloquee los inputs, aquí se garantiza.
 */
export function resolveCategoryUpdate(params: {
  isStandard: boolean;
  existing: { name: string; kind: string | null };
  input: { name: string; kind: string | null; half_duration_minutes: number };
}): { name: string; kind: string | null; half_duration_minutes: number } {
  if (params.isStandard) {
    return {
      name: params.existing.name,
      kind: params.existing.kind,
      half_duration_minutes: params.input.half_duration_minutes,
    };
  }
  return params.input;
}

/**
 * ¿Una categoría custom (is_standard=false) solapa un kind estándar? Útil para
 * avisar en la UI de los "match ambiguos" (kind canónico pero nombre distinto del
 * canónico) que la reconciliación de C3 deja como custom a propósito.
 */
export function customOverlapsStandardKind(params: {
  isStandard: boolean;
  kind: string | null;
}): boolean {
  if (params.isStandard) return false;
  return (
    params.kind !== null &&
    (CATEGORY_KINDS as readonly string[]).includes(params.kind)
  );
}
