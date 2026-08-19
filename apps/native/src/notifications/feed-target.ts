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
