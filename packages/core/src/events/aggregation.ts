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

/**
 * F13B (T-2) — Evento FUENTE de la convocatoria de un evento. Para un partido de
 * torneo (`tournament_id` no nulo) → la CABECERA del torneo (donde vive la
 * convocatoria única); para cualquier otro evento → él mismo. Los partidos de
 * torneo no tienen convocatoria propia: la LEEN por referencia desde la cabecera.
 */
export function callupEventIdFor(event: {
  id: string;
  tournament_id: string | null;
}): string {
  return event.tournament_id ?? event.id;
}

/**
 * F13B (T-2) — ¿La alineación de este evento puede ESCRIBIR su convocatoria
 * (called_up) al colocar/quitar jugadores? Para un partido de torneo NO: su
 * plantilla se gestiona SOLO en la cabecera, así que la alineación del partido
 * solo distribuye (nunca escribe convocatoria) y no reintroduce doble verdad.
 * Para cualquier otro evento, comportamiento clásico (sí escribe).
 */
export function lineupWritesCallup(event: {
  tournament_id: string | null;
}): boolean {
  return event.tournament_id == null;
}

/**
 * F13B (T-4) — Ronda del SIGUIENTE partido de un torneo: `max(round) + 1`. El
 * avance es MANUAL y el nº de partidos INDETERMINADO, así que cada alta calcula
 * la ronda a partir de las existentes. Ignora rondas nulas/no finitas. Si aún no
 * hubiera ninguna (no debería pasar: T-1 crea la ronda 1), empieza en 1.
 */
export function nextTournamentRound(
  existingRounds: ReadonlyArray<number | null>,
): number {
  const valid = existingRounds.filter(
    (r): r is number => typeof r === 'number' && Number.isFinite(r),
  );
  if (valid.length === 0) return 1;
  return Math.max(...valid) + 1;
}

/**
 * F13B — CONSOLIDA los partidos candidatos a recordatorio en UN representante por
 * ANCLA de convocatoria (`callupEventIdFor` = `tournament_id ?? id`). Los
 * sub-partidos de un mismo torneo comparten cabecera → colapsan a uno solo (el de
 * `starts_at` más temprano), de modo que el cron emite **1 recordatorio por
 * torneo/día/usuario** en vez de uno por cruce (evita el spam de los torneos de
 * finde). Un partido NORMAL tiene ancla = su propio id → es su propio grupo, sin
 * cambios. Empate de `starts_at` → gana el primero encontrado (estable). No muta.
 */
export function consolidateReminderTargets<
  T extends { id: string; tournament_id: string | null; starts_at: string },
>(matches: readonly T[]): T[] {
  const byAnchor = new Map<string, T>();
  for (const m of matches) {
    const anchor = callupEventIdFor(m);
    const cur = byAnchor.get(anchor);
    if (!cur || m.starts_at < cur.starts_at) byAnchor.set(anchor, m);
  }
  return Array.from(byAnchor.values());
}

/**
 * F13B — filtra los eventos cuya convocatoria está PUBLICADA resolviendo el ANCLA
 * con `callupEventIdFor` (la CABECERA para un sub-partido de torneo, el propio
 * evento para uno normal). Así un sub-partido de torneo aflora sii la
 * convocatoria de SU cabecera está publicada (su meta propia está vacía), y uno
 * normal sii la suya lo está (comportamiento intacto). `publishedAnchorIds` son
 * los event_id de convocatorias publicadas (ya resueltos a nivel de ancla).
 */
export function filterPublishedByAnchor<
  T extends { id: string; tournament_id: string | null },
>(events: readonly T[], publishedAnchorIds: ReadonlySet<string>): T[] {
  return events.filter((e) => publishedAnchorIds.has(callupEventIdFor(e)));
}

/**
 * F13B (T-5) — Forma mínima para agrupar filas de "Gestión de partidos" por
 * torneo. `type='tournament'` (con `tournament_id` null) es la CABECERA; una fila
 * con `tournament_id` no nulo es un sub-partido de ese torneo; el resto son
 * partidos sueltos (match/friendly normales).
 */
export type CallupGroupable = {
  event_id: string;
  type: string;
  tournament_id: string | null;
  round: number | null;
  starts_at: string;
};

export type GroupedCallup<T> =
  | { kind: 'single'; match: T }
  | { kind: 'tournament'; header: T; matches: T[] };

/**
 * F13B (T-5) — Agrupa las filas de convocatoria en unidades: cada torneo como un
 * grupo (cabecera + sus sub-partidos ordenados por ronda) y cada partido normal
 * suelto. El orden entre grupos es por fecha ascendente (la cabecera representa al
 * torneo con su `starts_at`, = 1er partido). Un sub-partido cuya cabecera NO esté
 * en `rows` (p.ej. la ronda 1 ya pasó y la cabecera cayó fuera de la ventana) se
 * degrada a `single` para no perderlo; el llamador debería incluir la cabecera
 * (así el grupo lleva la convocatoria única). NO muta `rows`.
 */
export function groupCallupsByTournament<T extends CallupGroupable>(
  rows: readonly T[],
): GroupedCallup<T>[] {
  const headers = new Map<string, T>();
  const subsByTournament = new Map<string, T[]>();
  const singles: T[] = [];

  for (const r of rows) {
    if (r.tournament_id != null) {
      const arr = subsByTournament.get(r.tournament_id) ?? [];
      arr.push(r);
      subsByTournament.set(r.tournament_id, arr);
    } else if (r.type === 'tournament') {
      headers.set(r.event_id, r);
    } else {
      singles.push(r);
    }
  }

  const byRoundThenDate = (a: T, b: T): number => {
    const ra = a.round ?? Number.MAX_SAFE_INTEGER;
    const rb = b.round ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.starts_at.localeCompare(b.starts_at);
  };

  const keyed: { at: string; order: number; g: GroupedCallup<T> }[] = [];
  let order = 0;

  for (const [tid, header] of headers) {
    const matches = (subsByTournament.get(tid) ?? []).slice().sort(byRoundThenDate);
    subsByTournament.delete(tid);
    keyed.push({
      at: header.starts_at,
      order: order++,
      g: { kind: 'tournament', header, matches },
    });
  }

  // Sub-partidos huérfanos (cabecera fuera de `rows`) → como sueltos, ordenados.
  for (const arr of subsByTournament.values()) {
    for (const m of arr) {
      keyed.push({ at: m.starts_at, order: order++, g: { kind: 'single', match: m } });
    }
  }

  for (const s of singles) {
    keyed.push({ at: s.starts_at, order: order++, g: { kind: 'single', match: s } });
  }

  keyed.sort((a, b) => {
    const c = a.at.localeCompare(b.at);
    return c !== 0 ? c : a.order - b.order;
  });
  return keyed.map((k) => k.g);
}

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
