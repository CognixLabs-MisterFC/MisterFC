/**
 * Helpers puros de agregación de eventos / asistencia para los hubs
 * /mis-equipos y /mis-equipos/[teamId]. Aislados aquí para poder
 * cubrirlos con Vitest sin tocar Supabase.
 *
 * Convenciones:
 *  - Todas las funciones reciben ISO strings UTC; no convierten a TZ.
 *  - Reciben `nowIso` explícito (testeable, sin Date.now()).
 *  - Devuelven `null` cuando no hay candidato (nunca `undefined`).
 */

import { isMatchSurfaceType } from './types';

export type DatedEvent = {
  id: string;
  starts_at: string;
  type?: string;
};

/**
 * Primer evento futuro que cumple `predicate`, ordenado por `starts_at`
 * ascendente. Lista de entrada no se asume ordenada.
 */
export function pickNextEvent<T extends DatedEvent>(
  events: ReadonlyArray<T>,
  nowIso: string,
  predicate: (e: T) => boolean = () => true
): T | null {
  const future = events
    .filter((e) => e.starts_at > nowIso && predicate(e))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  return future[0] ?? null;
}

/**
 * Último evento que cumple `predicate` y empezó dentro de las últimas
 * `hoursWindow` horas (no estrictamente pasado: aplica en una ventana
 * cerrada). Útil para "marca asistencia del último entrenamiento".
 */
export function pickLastEventWithin<T extends DatedEvent>(
  events: ReadonlyArray<T>,
  nowIso: string,
  hoursWindow: number,
  predicate: (e: T) => boolean = () => true
): T | null {
  const now = new Date(nowIso).getTime();
  const fromMs = now - hoursWindow * 3600_000;
  const fromIso = new Date(fromMs).toISOString();
  const past = events
    .filter(
      (e) => e.starts_at <= nowIso && e.starts_at >= fromIso && predicate(e)
    )
    .sort((a, b) => b.starts_at.localeCompare(a.starts_at));
  return past[0] ?? null;
}

/**
 * Primer partido futuro del team (oficial o amistoso) que NO tiene fila en
 * `publishedCallupEventIds`. Devuelve null si no hay candidato. Incluye
 * amistosos (F13B): tienen convocatoria como un oficial. `tournament` queda
 * fuera hasta su fase (ver `MATCH_SURFACE_TYPES`).
 */
export function pickNextMatchWithoutCallup<T extends DatedEvent>(
  events: ReadonlyArray<T>,
  nowIso: string,
  publishedCallupEventIds: ReadonlySet<string>
): T | null {
  return pickNextEvent(
    events,
    nowIso,
    (e) => isMatchSurfaceType(e.type) && !publishedCallupEventIds.has(e.id)
  );
}

/**
 * Primer training pasado en las últimas `hoursWindow` horas que aún no
 * tiene asistencia marcada (no aparece en `attendanceMarkedEventIds`).
 */
export function pickLastTrainingWithoutAttendance<T extends DatedEvent>(
  events: ReadonlyArray<T>,
  nowIso: string,
  hoursWindow: number,
  attendanceMarkedEventIds: ReadonlySet<string>
): T | null {
  return pickLastEventWithin(
    events,
    nowIso,
    hoursWindow,
    (e) => e.type === 'training' && !attendanceMarkedEventIds.has(e.id)
  );
}
