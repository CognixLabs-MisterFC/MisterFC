import { resourceIdForNotification } from '@misterfc/core';

/**
 * Bloque A — Destino de navegación al TOCAR una fila de las listas del área de
 * FAMILIA (novedades y eventos). Espejo del `hrefFor(type, payload)` de la web
 * (notifications-feed.ts) pero a las rutas DETALLE de expo-router del área
 * familia: "Nueva convocatoria" abre ESA convocatoria, "Nuevo mensaje" ese
 * mensaje, etc. (decisión de Jose: la novedad lleva AL SITIO, no a un detalle de
 * la novedad). Reutiliza `resourceIdForNotification` de core para extraer el id
 * del payload (misma elección de clave que la web), sin duplicar esa lógica.
 *
 * Tipos SIN destino en el área de familia (editores de playbook, ejercicios,
 * marcado de asistencia, aprobación de entrenos, campañas de evaluación) →
 * `null`: la fila NO es clicable (y en /novedades se ofrece "marcar leída").
 */
export type FamilyTarget = {
  pathname: string;
  params?: Record<string, string>;
} | null;

/** Novedad in_app (type + payload) → destino de detalle en el área familia. */
export function familyFeedTarget(type: string, payload: unknown): FamilyTarget {
  const data =
    payload != null && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const id = resourceIdForNotification(type, data);

  switch (type) {
    case 'new_announcement':
      // Jose: "Nuevo anuncio" abre la lista de Anuncios (la app no tiene detalle
      // por id de anuncio en familia).
      return { pathname: '/family/anuncios' };
    case 'callup_published':
    case 'callup_updated':
    case 'match_callup_reminder':
      return id ? { pathname: '/family/convocatoria', params: { eventId: id } } : null;
    case 'new_message':
      return id ? { pathname: '/family/mensaje', params: { conversationId: id } } : null;
    case 'play_published':
      return id ? { pathname: '/family/jugada', params: { playId: id } } : null;
    case 'development_report_published':
      return { pathname: '/family/mi-informe' };
    case 'event_updated':
    case 'training_cancelled':
    case 'training_reinstated':
    case 'player_promoted':
      // Sin vista de evento por jugador → al calendario (igual que la web).
      return { pathname: '/family/calendario' };
    case 'training_reminder':
      // Sin event_id en el payload → a la lista de Entrenamientos (Jose).
      return { pathname: '/family/entrenamientos' };
    default:
      // play_approved/updated/rejected, exercise_rejected,
      // attendance_pending_reminder, training_approval_requested/approved/
      // rejected, evaluation_campaign_launched, goal (fuera del feed) → sin destino.
      return null;
  }
}

/**
 * D6 — Destino de navegación al TOCAR una fila de NOVEDADES en el área DIRECCIÓN.
 * El feed del director reusa `NovedadesScreen` (familia), pero `familyFeedTarget`
 * enruta a `/family/...`, área vetada al director por AreaGuard (lo rebotaría). Este
 * resolver enruta DENTRO de `/direction`. De momento solo la novedad propia de
 * dirección tiene destino; el resto → null (fila informativa, no navega — nunca un
 * rebote al home).
 *  · erasure_requested → lista de supresiones (el director la ve en lectura; el dato
 *    sensible vive ahí, no en el feed). Sin id: va a la lista, no a un detalle.
 */
export function directionFeedTarget(type: string): FamilyTarget {
  switch (type) {
    case 'erasure_requested':
      return { pathname: '/direction/supresiones' };
    default:
      return null;
  }
}

/** Tipo de evento del calendario/eventos → detalle en el área familia. */
export function familyEventTarget(ev: {
  id: string;
  type: string;
  title: string;
  starts_at: string;
  location_name?: string | null;
}): FamilyTarget {
  switch (ev.type) {
    case 'training':
      return {
        pathname: '/family/entrenamiento',
        params: {
          title: ev.title ?? '',
          startsAt: ev.starts_at,
          locationName: ev.location_name ?? '',
        },
      };
    case 'match':
    case 'friendly':
    case 'tournament':
      return { pathname: '/family/convocatoria', params: { eventId: ev.id } };
    default:
      // 'other' (y cualquier tipo sin destino claro) → fila no clicable.
      return null;
  }
}

/**
 * Bug 17/14 — Espejo de `familyEventTarget` para el área STAFF. Mismo shape de
 * destino pero a las rutas del área staff, para que las listas de eventos
 * compartidas (calendario, inicio) enruten DENTRO del área correcta y no reboten
 * en el AreaGuard: un entrenamiento abre su marcado de asistencia (pasar lista) y
 * un partido/amistoso/torneo abre la convocatoria del staff. `other` → no clicable.
 * Solo necesita `id` y `type` (ambas rutas toman `eventId`).
 */
export function staffEventTarget(ev: { id: string; type: string }): FamilyTarget {
  switch (ev.type) {
    case 'training':
      return { pathname: '/staff/asistencia-sesion', params: { eventId: ev.id } };
    case 'match':
    case 'friendly':
    case 'tournament':
      return { pathname: '/staff/convocatoria', params: { eventId: ev.id } };
    default:
      return null;
  }
}

/**
 * D1b-4 — Espejo de `familyEventTarget`/`staffEventTarget` para el área DIRECCIÓN.
 * Los targets de familia/staff enrutan a `/family` y `/staff`, áreas vetadas al
 * director por AreaGuard (usarlos lo rebota al home); este enruta a `/direction`.
 * El director ve lo que ve el entrenador (decisión ③, cerrada):
 *  · partido (match/friendly/tournament) → detalle de convocatoria read-only (D1b-2).
 *  · entreno (training) → visor de sesión read-only (D1b-3). El evento del calendario
 *    trae `has_session` pero NO el id de la sesión, así que:
 *      - has_session=true  → `/direction/sesion` por `eventId` (esa ruta resuelve el
 *        id; y si NO resuelve —sesión borrada/carrera— cae al detalle de entreno con
 *        los params title/startsAt/locationName que van aquí de más).
 *      - has_session=false → `/direction/entrenamiento` (detalle de entreno sin sesión).
 *  · cualquier otro tipo ('other') / sin destino → null: la fila NO navega (ni pantalla
 *    rota ni rebote al home).
 */
export function directionEventTarget(ev: {
  id: string;
  type: string;
  title: string;
  starts_at: string;
  location_name?: string | null;
  has_session?: boolean;
}): FamilyTarget {
  switch (ev.type) {
    case 'training': {
      const trainingParams = {
        title: ev.title ?? '',
        startsAt: ev.starts_at,
        locationName: ev.location_name ?? '',
      };
      // Con sesión → visor (resolución eventId→sessionId en la ruta, con fallback al
      // detalle de entreno usando estos mismos params). Sin sesión → detalle directo.
      return ev.has_session
        ? { pathname: '/direction/sesion', params: { eventId: ev.id, ...trainingParams } }
        : { pathname: '/direction/entrenamiento', params: trainingParams };
    }
    case 'match':
    case 'friendly':
    case 'tournament':
      return { pathname: '/direction/convocatoria', params: { eventId: ev.id } };
    default:
      return null;
  }
}
