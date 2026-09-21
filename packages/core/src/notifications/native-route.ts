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

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * PUSH-ÁREA — el aviso sobre un hijo abre FAMILIA, aunque el hogar sea otro.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * EL FALLO QUE ARREGLA. `NotificationsProvider` enrutaba el push al área HOGAR del
 * usuario (`chromeAreaFor` → `navAreaForRole`). Para quien tiene UN solo papel eso
 * es correcto y sigue siéndolo. Pero `memberships` tiene UNIQUE (profile_id,
 * club_id): un director que además es padre solo puede tener UN rol, y su hogar es
 * dirección. Resultado medido, con la convocatoria de su hija:
 *
 *     callup_published → /direction/convocatorias
 *
 * que es la lista club-wide de dirección, en SOLO LECTURA (D1b-2) — donde no puede
 * responder por ella. Y `development_report_published` o `play_published`, que no
 * tienen pantalla en dirección, caían directamente en el inicio de dirección.
 *
 * LA SEÑAL ES LA AUDIENCIA DEL AVISO, NO EL ROL DE QUIEN LO RECIBE. Medido en los
 * emisores, un aviso de la lista de abajo resuelve sus destinatarios ÚNICAMENTE por
 * `player_accounts` (`publish-callup.ts`, `promotion-actions.ts`, los informes,
 * `equipos/[teamId]/jugadas`…): se recibe por ser tutor o jugador, NUNCA por el rol
 * de club. Si te ha llegado, es por tu hijo. Eso es lo que se usa aquí.
 *
 * LO QUE ESTO NO ES. No abre ninguna puerta: quién puede montar la carcasa de
 * familia lo decide `isAllowedInArea` (modo tutor, `hasLinkedPlayers`) y el acceso a
 * los DATOS lo decide la RLS por `player_accounts`. Esto solo elige a qué área
 * NAVEGA un toque, entre las que el usuario ya tenía permitidas.
 *
 * LOS MIXTOS SE QUEDAN FUERA, A PROPÓSITO. Hay tipos que llegan a DOS audiencias con
 * el mismo nombre y el push no trae con qué distinguirlas:
 *
 *   · `new_message` — coach→familia y familia→coach son el mismo type; el `data`
 *     lleva `conversation_id` y nada que diga de qué lado está quien lo recibe;
 *   · `new_announcement` — club-wide va a TODOS los `memberships`; team-bound solo a
 *     `player_accounts`;
 *   · `training_cancelled` / `training_reinstated` — por festivo (`holidays.ts`) van
 *     a `team_staff` Y a familia; por calendario, solo a familia;
 *   · `training_reminder` — "hoy tienes entrenamiento" va a TODO el equipo:
 *     jugadores, familias Y entrenadores;
 *   · `image_consent_revoked` — dirección Y cuerpo técnico del equipo.
 *
 * Adivinar el lado desde el cliente sería inventarse un dato. Se resuelven marcando
 * la audiencia en el `data` del emisor, y eso va en su propio PR. Hasta entonces
 * siguen yendo al hogar, que es EXACTAMENTE lo que hacen hoy: esta pieza no los
 * mejora, pero tampoco los cambia.
 */
const FAMILY_AUDIENCE_TYPES: ReadonlySet<string> = new Set([
  // Convocatoria del jugador: roster activo + promocionados → player_accounts.
  'callup_published',
  'callup_updated',
  'match_callup_reminder',
  // Cambio de un evento del equipo del jugador (team_members → player_accounts).
  'event_updated',
  // Al jugador lo suben a un equipo superior (player_accounts del subido).
  'player_promoted',
  // Informe de desarrollo publicado (player_accounts del jugador).
  'development_report_published',
  // Jugada compartida al playbook de la familia (player_accounts del equipo).
  'play_published',
  // BC-7: el otro tutor del menor borró su cuenta. "El destinatario es su propio
  // tutor" — y pasa a ser el único.
  'tutor_unlinked',
  // SU-6: solo a quien de verdad paga. "Al staff no se le avisa de nada."
  'subscription_expiring',
]);

/**
 * Clave del `data` con la que un emisor declara a qué audiencia manda ESTE envío.
 *
 * Existe por los MIXTOS de arriba: cuando un mismo `type` llega a dos audiencias, el
 * tipo ya no alcanza y solo el emisor sabe de qué lado está cada destinatario —
 * `send.ts` sabe si el mensaje va al coach o a la familia; `holidays.ts` sabe cuáles
 * de sus destinatarios son cuerpo técnico. Marcarlo en el `data` es pasar ese dato
 * al enrutado en vez de adivinarlo en el cliente.
 *
 * QUIÉN LA ESCRIBE. Los emisores de web/core, en su propio PR. Aquí solo se LEE, y
 * de forma tolerante: mientras nadie la mande, todo sigue decidiéndose por el tipo.
 * Por eso esta pieza puede entrar antes que la que la escribe sin cambiar nada.
 *
 * ⚠️ El valor es una CADENA acordada entre los dos lados ('family' | 'staff' |
 * 'direction'). Si se renombra aquí, hay que renombrarla en los emisores el MISMO
 * día: el fallo sería mudo —la marca dejaría de reconocerse y el enrutado caería a
 * la tabla por tipo—, que es justo el fallo que esto viene a arreglar.
 */
export const NOTIFICATION_AUDIENCE_KEY = 'audience';

/** Las audiencias que un emisor puede declarar. */
export type NotificationAudience = 'family' | 'staff' | 'direction';

/**
 * El par que el emisor pega en SUS DOS payloads. Y son dos, no uno:
 *
 *   · `in_app_payload` — de ahí saca el `data` el envío EAGER (notify-bus);
 *   · `push_payload`   — de ahí lo saca el DRENADOR del cron, que lee la fila
 *     `channel='push'` en crudo cuando el eager no llegó a enviar.
 *
 * Marcar solo uno funcionaría en las pruebas y fallaría en producción cada vez que
 * el envío inmediato falla y lo recoge el cron — un aviso de cada tantos, yendo al
 * área equivocada, sin nada en los logs. Por eso esto es una función: para que el
 * emisor escriba `...audienceMark('family')` en los dos sitios y no dependa de
 * acordarse de una cadena.
 */
export function audienceMark(audience: NotificationAudience): {
  audience: NotificationAudience;
} {
  return { [NOTIFICATION_AUDIENCE_KEY]: audience } as {
    audience: NotificationAudience;
  };
}

/** Audiencia declarada por el emisor, o `null` si este envío no viene marcado. */
export function declaredAudience(
  data: Record<string, unknown> | null | undefined,
): string | null {
  const v = (data ?? {})[NOTIFICATION_AUDIENCE_KEY];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * ¿Este aviso se recibe por ser TUTOR (o el propio jugador), y no por el rol de club?
 *
 * Orden de decisión, y el orden importa:
 *   1. la marca del emisor, si viene — es el único que sabe la audiencia de un mixto,
 *      y `audience: 'staff'` tiene que poder decir "este NO" aunque el tipo esté en
 *      la tabla (el entrenador que además es padre y recibe el festivo de SU equipo);
 *   2. la tabla por tipo, que resuelve los avisos de una sola audiencia;
 *   3. y ante la duda —type desconocido, marca vacía— el hogar, que es el
 *      comportamiento de siempre.
 */
export function isFamilyAudienceNotification(
  type: string,
  data?: Record<string, unknown> | null,
): boolean {
  const marcada = declaredAudience(data);
  if (marcada !== null) return marcada === 'family';
  return FAMILY_AUDIENCE_TYPES.has(type);
}

/** Lo que la app sabe de quién recibe el push, para elegir el área de destino. */
export type NotificationAreaContext = {
  /** Segmento del área HOGAR (la de su rol): 'family' | 'staff' | 'direction' | … */
  homeArea: string;
  /** Pantallas que existen en el área hogar. */
  homeScreens: ReadonlySet<string>;
  /**
   * Segmento del área de familia SI el usuario puede entrar en ella (tiene hijos
   * vinculados: el `hasLinkedPlayers` del modo tutor). `null` cuando no — y entonces
   * aquí no se decide nada distinto de lo de siempre.
   */
  tutorArea?: string | null;
  /** Pantallas del área de familia. Sin ellas, `tutorArea` se ignora. */
  tutorScreens?: ReadonlySet<string> | null;
};

/**
 * Destino nativo del push TENIENDO EN CUENTA a quién va dirigido el aviso. Envoltorio
 * de `nativeHrefForNotification` (que sigue resolviendo type→pantalla dentro de un
 * área) con la elección del ÁREA delante.
 *
 * El área de familia se elige SOLO si se cumple todo:
 *   1. el aviso es de audiencia familia (`isFamilyAudienceNotification`);
 *   2. el usuario puede entrar en familia (`tutorArea` no nulo ⇔ hasLinkedPlayers);
 *   3. no es ya su hogar (si lo es, no hay nada que cambiar);
 *   4. y el aviso ATERRIZA de verdad en una pantalla de familia.
 *
 * LA CUARTA CONDICIÓN NO ES UN DETALLE. `tutor_unlinked` y `subscription_expiring`
 * son de audiencia familia pero no tienen pantalla nativa todavía: sin ella, cambiar
 * de área solo serviría para dejar al director en el INICIO de familia en vez del
 * suyo — moverlo de sitio sin llevarlo a nada. Mientras no exista el destino, se
 * queda donde estaba. El día que se añada la pantalla, empiezan a cambiar de área
 * solos, sin tocar esta función.
 */
export function nativeTargetForNotification(
  type: string,
  data: Record<string, unknown> | null | undefined,
  ctx: NotificationAreaContext,
): NativeRouteTarget {
  const home = nativeHrefForNotification(type, data, ctx.homeArea, ctx.homeScreens);

  const tutorArea = ctx.tutorArea ?? null;
  const tutorScreens = ctx.tutorScreens ?? null;
  if (
    !isFamilyAudienceNotification(type, data) ||
    tutorArea === null ||
    tutorScreens === null ||
    tutorArea === ctx.homeArea
  ) {
    return home;
  }

  const tutor = nativeHrefForNotification(type, data, tutorArea, tutorScreens);
  // Sin pantalla en familia, el mapper devuelve el Inicio del área pelado: eso no es
  // un destino, es un "no sé dónde ponerlo". No se cambia de área por eso.
  return tutor.pathname === `/${tutorArea}` ? home : tutor;
}
