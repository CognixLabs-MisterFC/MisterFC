/**
 * O2-4 PR-2 — Enrutado de deep link del push NATIVO (lógica pura).
 *
 * Espejo de `hrefFor(type, payload)` de la web (notifications-feed.ts), pero a
 * las rutas de expo-router de la app. El emisor de PR-1 manda en el `data` del
 * push el `type` + los IDs del recurso (NUNCA la ruta web /es/...); aquí se
 * deriva, a partir de ese `type`, la PANTALLA nativa destino.
 *
 * Puro y agnóstico de React Native: la app inyecta `areaSegment` (el área de
 * carcasa del usuario, derivada de su rol con `navAreaForRole`) y el conjunto de
 * pantallas que existen en esa área (`availableScreens`, construido desde la
 * config de navegación nativa). Así core NO importa nada de apps/native (la
 * dirección de dependencia es native→core) y esto se testea en el runner de core.
 *
 * TOLERANTE por diseño: un `type` sin pantalla nativa aún, o una pantalla que no
 * existe en el área del usuario, cae en el Inicio del área (`/${areaSegment}`),
 * nunca en un error. Sin `resource_id` → se navega al destino del type sin id
 * (el listado).
 */

/** Destino nativo: ruta de expo-router + params opcionales (id del recurso). */
export type NativeRouteTarget = {
  pathname: string;
  params?: Record<string, string>;
};

/**
 * `notification_type` → nombre de pantalla (relativo al área) a la que apunta el
 * push, espejo de `hrefFor`. Los tipos AUSENTES aquí (p.ej. los editores de
 * playbook `play_approved/rejected/updated`, `exercise_rejected`,
 * `evaluation_campaign_launched`) no tienen pantalla nativa todavía → Inicio.
 */
const SCREEN_FOR_TYPE: Record<string, string> = {
  new_announcement: 'anuncios',
  new_message: 'mensajes',
  callup_published: 'convocatorias',
  callup_updated: 'convocatorias',
  match_callup_reminder: 'convocatorias',
  attendance_pending_reminder: 'asistencia',
  // Cambios de evento/entreno y ascensos → calendario (la web tampoco tiene
  // vista de evento por jugador; va al calendario, accesible a todos).
  event_updated: 'calendario',
  training_cancelled: 'calendario',
  training_reinstated: 'calendario',
  training_approval_requested: 'calendario',
  training_approved: 'calendario',
  training_rejected: 'calendario',
  player_promoted: 'calendario',
  goal: 'directos',
  play_published: 'mi-equipo',
  development_report_published: 'mi-informe',
};

/**
 * Override de pantalla POR ÁREA: para un mismo `type`, un área concreta puede tener un
 * destino MÁS específico que el genérico de `SCREEN_FOR_TYPE`. Se resuelve antes que el
 * genérico y pasa por la MISMA guarda `availableScreens` (si la pantalla no existe en el
 * área → Inicio, nunca error).
 *
 * 18-F3c — dirección: `training_approval_requested` ("hay un entreno en festivo por
 * aprobar", le llega al director) debe aterrizar en la pantalla de FESTIVOS, donde se
 * aprueba, no en la lanzadera de calendario (`calendario`). Familia/staff NO se pisan:
 * para ellos ese type sigue en `calendario` (`/family|staff/calendario`), como hoy. Los
 * demás tipos de calendario (event_updated, training_cancelled/reinstated/approved/
 * rejected, player_promoted) son de calendario general → sin override.
 */
const SCREEN_OVERRIDE_BY_AREA: Record<string, Record<string, string>> = {
  direction: { training_approval_requested: 'calendario-festivos' },
};

/**
 * `notification_type` → clave del `data` que trae el ID del recurso relevante
 * (misma elección que `hrefFor`). Los tipos que van a un listado sin id (los de
 * calendario) no tienen entrada. Si no hay id específico, se usa `resource_id`
 * (el que el emisor extrae del deep_link cuando es un UUID).
 */
const PRIMARY_ID_KEY_FOR_TYPE: Record<string, string> = {
  new_announcement: 'announcement_id',
  new_message: 'conversation_id',
  callup_published: 'event_id',
  callup_updated: 'event_id',
  match_callup_reminder: 'event_id',
  attendance_pending_reminder: 'event_id',
  goal: 'event_id',
  play_published: 'play_id',
  development_report_published: 'development_report_id',
};

/**
 * ID del recurso al que apunta la notificación: la clave específica del type si
 * está en el `data`; si no, `resource_id`; si nada, `undefined` (destino sin id).
 */
export function resourceIdForNotification(
  type: string,
  data: Record<string, unknown> | null | undefined,
): string | undefined {
  const rec = data ?? {};
  const key = PRIMARY_ID_KEY_FOR_TYPE[type];
  if (key) {
    const v = rec[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  const rid = rec.resource_id;
  return typeof rid === 'string' && rid.length > 0 ? rid : undefined;
}

/**
 * Deriva la ruta nativa destino a partir del `type` + `data` del push.
 *
 * @param type            notification_type del push.
 * @param data            `data` del push (type + IDs), o null.
 * @param areaSegment     segmento de área del usuario ('family'|'staff'|...).
 * @param availableScreens pantallas que existen en esa área (tabs + menú).
 *
 * Reglas: si el type no tiene pantalla nativa, o la pantalla no existe en el
 * área del usuario → Inicio del área (`/${areaSegment}`). Si la tiene, la ruta
 * es `/${areaSegment}/${screen}`, con `params.id` SOLO si hay resource id.
 */
export function nativeHrefForNotification(
  type: string,
  data: Record<string, unknown> | null | undefined,
  areaSegment: string,
  availableScreens: ReadonlySet<string>,
): NativeRouteTarget {
  // Override por área (más específico) y, si no hay, el genérico.
  const screen = SCREEN_OVERRIDE_BY_AREA[areaSegment]?.[type] ?? SCREEN_FOR_TYPE[type];
  if (!screen || !availableScreens.has(screen)) {
    return { pathname: `/${areaSegment}` };
  }
  const pathname = `/${areaSegment}/${screen}`;
  const id = resourceIdForNotification(type, data);
  return id ? { pathname, params: { id } } : { pathname };
}
