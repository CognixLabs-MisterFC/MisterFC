/**
 * F3 — Calendario y eventos. Tipos compartidos.
 *
 * El modelo está documentado en `docs/specs/3.0-calendario-eventos.md` §4.
 */

export const EVENT_TYPES = [
  'training',
  'match',
  'tournament',
  'friendly',
  'other',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/**
 * Tipos de evento que se comportan como un PARTIDO gestionable: salen en
 * "gestión de partidos" y pasan por convocatoria → alineación → directo →
 * post-partido. Fuente única para todos los filtros de la app, para evitar la
 * deriva que dejaba fuera a amistosos/torneos. `training` y `other` NO son
 * partidos. El modelo de datos ya los soporta por igual (events.type +
 * trigger de `evaluations` que deriva el event_type de los tres).
 */
export const MANAGEABLE_MATCH_TYPES = [
  'match',
  'friendly',
  'tournament',
] as const satisfies readonly EventType[];

export type ManageableMatchType = (typeof MANAGEABLE_MATCH_TYPES)[number];

/** ¿Este tipo de evento es un partido gestionable? */
export function isManageableMatchType(
  type: string | null | undefined
): type is ManageableMatchType {
  return (MANAGEABLE_MATCH_TYPES as readonly string[]).includes(type ?? '');
}

/**
 * ISO 0=Monday … 6=Sunday. Mapeable a JS Date.getDay() via `(jsDay+6)%7`.
 */
export type IsoWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type WeeklyRecurrenceRule = {
  freq: 'weekly';
  /** 1–4. interval=1 → todas las semanas; 2 → cada 2; … */
  interval: number;
  /** Días de la semana ISO (0=lun … 6=dom). Min 1, max 7. */
  by_weekday: number[];
  /** Número de SEMANAS de la serie (no de hijos). count XOR until. */
  count?: number;
  /** Fecha local ISO YYYY-MM-DD, inclusiva. count XOR until. */
  until?: string;
};

export type RecurrenceRule = WeeklyRecurrenceRule;

/**
 * Target del evento. "at most one set" entre team_id y category_id:
 *   - { kind: 'team', team_id }     → evento de un equipo
 *   - { kind: 'category', category_id } → evento de una categoría
 *   - { kind: 'club' }              → evento de club (ambos NULL en BD)
 */
export type EventTarget =
  | { kind: 'team'; team_id: string }
  | { kind: 'category'; category_id: string }
  | { kind: 'club' };

export const TIMEZONE_OLA1 = 'Europe/Madrid';
