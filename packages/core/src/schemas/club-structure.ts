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

/** Categoría dentro de un club y temporada. */
export const categorySchema = z.object({
  name: nameField,
  season: seasonField,
  order_idx: orderField,
});

export type CategoryInput = z.infer<typeof categorySchema>;

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

/** Equipo dentro de una categoría. */
export const teamSchema = z.object({
  name: nameField,
  format: formatField,
  color: colorField,
  division: divisionField,
});

export type TeamInput = z.infer<typeof teamSchema>;

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
