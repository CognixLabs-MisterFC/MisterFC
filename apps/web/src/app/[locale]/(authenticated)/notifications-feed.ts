/**
 * F13.9a — Mapper REUSABLE de notificaciones in_app → ítem de feed legible.
 *
 * El `in_app_payload` que escribe el bus (F5.7, ver notify-bus.ts) NO guarda un
 * título legible (eso solo va en el `push_payload`): trae IDs + `deep_link`, y a
 * veces algún campo extra. Aquí se construye el texto a partir del TIPO + los
 * campos que el payload YA contiene — SIN queries adicionales (decisión Regla
 * #11): texto genérico por tipo, enriquecido solo cuando el payload trae el dato
 * (p.ej. `exercise_name`, `title`). No se inventan campos que no existan.
 *
 * El `href` se DERIVA de los IDs del payload (sin locale) porque los `deep_link`
 * guardados son inconsistentes (unos con `/${locale}`, otros con `/es` fijo,
 * otros sin locale); el panel los pinta con el <Link> de next-intl, que añade el
 * locale activo. Si falta el ID, se cae al `deep_link` guardado, normalizado.
 *
 * Es pieza central: la consume el panel de Inicio (13.9a) y, más adelante, la
 * página /novedades (13.9b).
 */

import type { ComponentType } from 'react';
import {
  Bell,
  CalendarClock,
  ClipboardCheck,
  Clapperboard,
  Megaphone,
  MessageSquare,
  XCircle,
} from 'lucide-react';

/** Fila in_app tal como la lee `loadNotificationFeed` (subset de notifications). */
export type InAppNotificationRow = {
  id: string;
  type: string;
  payload: unknown;
  status: string;
  created_at: string;
};

/** Ítem ya listo para pintar (texto traducido + icono + destino + no-leído). */
export type MappedNotification = {
  id: string;
  Icon: ComponentType<{ className?: string }>;
  /** Texto ya traducido. */
  text: string;
  /** Ruta SIN locale para el <Link> de next-intl, o null si no hay destino. */
  href: string | null;
  /** No leído = la fila in_app sigue en `pending`. */
  unread: boolean;
  createdAt: string;
};

/** Función de traducción del namespace `home.feed` (next-intl). */
type Translate = (key: string, values?: Record<string, string>) => string;

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload != null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** Lee un string no vacío del payload, o undefined. */
function str(payload: Record<string, unknown> | null, key: string): string | undefined {
  const v = payload?.[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function iconFor(type: string): ComponentType<{ className?: string }> {
  switch (type) {
    case 'new_announcement':
      return Megaphone;
    case 'callup_published':
    case 'callup_updated':
    case 'match_callup_reminder':
      return ClipboardCheck;
    case 'new_message':
      return MessageSquare;
    case 'play_published':
      return Clapperboard;
    case 'exercise_rejected':
      return XCircle;
    case 'attendance_pending_reminder':
    case 'training_reminder':
    case 'event_updated':
      return CalendarClock;
    default:
      return Bell;
  }
}

/** Texto legible por tipo, enriquecido con campos presentes en el payload. */
function textFor(t: Translate, type: string, payload: Record<string, unknown> | null): string {
  switch (type) {
    case 'new_announcement':
      return t('new_announcement');
    case 'callup_published':
      return t('callup_published');
    case 'callup_updated':
      return t('callup_updated');
    case 'new_message':
      return t('new_message');
    case 'play_published':
      return t('play_published');
    case 'exercise_rejected': {
      const name = str(payload, 'exercise_name');
      return name ? t('exercise_rejected_named', { name }) : t('exercise_rejected');
    }
    case 'match_callup_reminder': {
      const title = str(payload, 'title');
      return title ? t('match_callup_reminder_named', { title }) : t('match_callup_reminder');
    }
    case 'attendance_pending_reminder': {
      const title = str(payload, 'title');
      return title
        ? t('attendance_pending_reminder_named', { title })
        : t('attendance_pending_reminder');
    }
    case 'training_reminder':
      return t('training_reminder');
    case 'event_updated': {
      const title = str(payload, 'title');
      return title ? t('event_updated_named', { title }) : t('event_updated');
    }
    default:
      return t('generic');
  }
}

/** Quita el segmento de locale inicial (es|en|va) de un deep_link guardado. */
function normalizeDeepLink(payload: Record<string, unknown> | null): string | null {
  const dl = str(payload, 'deep_link');
  if (!dl || !dl.startsWith('/')) return null;
  const stripped = dl.replace(/^\/(es|en|va)(?=\/|$)/, '');
  return stripped === '' ? '/' : stripped;
}

/** Destino derivado de los IDs del payload (sin locale); fallback al deep_link. */
function hrefFor(type: string, payload: Record<string, unknown> | null): string | null {
  let derived: string | null = null;
  switch (type) {
    case 'new_announcement': {
      const id = str(payload, 'announcement_id');
      derived = id ? `/anuncios/${id}` : null;
      break;
    }
    case 'exercise_rejected': {
      const id = str(payload, 'exercise_id');
      derived = id ? `/ejercicios/${id}` : null;
      break;
    }
    case 'play_published': {
      const id = str(payload, 'play_id');
      // jugadores/familia → visor read-only del playbook (13.6), no el editor.
      derived = id ? `/mi-equipo/jugadas/${id}` : null;
      break;
    }
    case 'new_message': {
      const id = str(payload, 'conversation_id');
      derived = id ? `/mensajes/${id}` : null;
      break;
    }
    case 'callup_published':
    case 'callup_updated':
    case 'match_callup_reminder': {
      const id = str(payload, 'event_id');
      derived = id ? `/convocatorias/${id}` : null;
      break;
    }
    case 'attendance_pending_reminder': {
      const id = str(payload, 'event_id');
      derived = id ? `/asistencia/${id}` : null;
      break;
    }
    case 'event_updated': {
      // No hay vista de evento por jugador → al calendario (accesible a todos).
      derived = '/calendario';
      break;
    }
    default:
      derived = null;
  }
  return derived ?? normalizeDeepLink(payload);
}

/** Convierte una fila in_app en un ítem de feed listo para pintar. */
export function mapNotification(row: InAppNotificationRow, t: Translate): MappedNotification {
  const payload = asRecord(row.payload);
  return {
    id: row.id,
    Icon: iconFor(row.type),
    text: textFor(t, row.type, payload),
    href: hrefFor(row.type, payload),
    unread: row.status === 'pending',
    createdAt: row.created_at,
  };
}
