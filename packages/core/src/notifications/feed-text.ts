/**
 * Texto legible de una novedad in_app a partir de su TIPO + payload — pieza PURA
 * y COMPARTIDA (web e app nativa). Extraída de `apps/web/.../notifications-feed.ts`
 * (F13.9a), que ahora es un wrapper: la web añade icono (lucide) y deep-link, la
 * app nativa solo el texto.
 *
 * El `in_app_payload` (F5.7, notify-bus) NO trae título legible: son IDs + campos
 * sueltos (`title`, `play_name`, `exercise_name`, `team_name`, `kind`,
 * `is_tournament`). Aquí se compone el texto genérico por tipo, enriquecido SOLO
 * cuando el payload trae el dato (Regla #11: sin queries extra, sin inventar
 * campos). Las claves son RELATIVAS al namespace `home.feed`: cada plataforma pasa
 * su `t` scopeado a `home.feed` (next-intl en web, `useTranslations('home.feed')`
 * en native), así el mismo texto se comparte.
 */

/** Función de traducción del namespace `home.feed`. */
export type FeedTextTranslate = (key: string, values?: Record<string, string>) => string;

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

/** Texto legible por tipo, enriquecido con los campos presentes en el payload. */
export function notificationFeedText(
  t: FeedTextTranslate,
  type: string,
  payload: unknown
): string {
  const p = asRecord(payload);
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
    case 'play_approved': {
      const name = str(p, 'play_name');
      return name ? t('play_approved_named', { name }) : t('play_approved');
    }
    case 'play_updated': {
      const name = str(p, 'play_name');
      return name ? t('play_updated_named', { name }) : t('play_updated');
    }
    case 'play_rejected': {
      const name = str(p, 'play_name');
      return name ? t('play_rejected_named', { name }) : t('play_rejected');
    }
    case 'exercise_rejected': {
      const name = str(p, 'exercise_name');
      return name ? t('exercise_rejected_named', { name }) : t('exercise_rejected');
    }
    case 'match_callup_reminder': {
      const title = str(p, 'title');
      // F13B — recordatorio consolidado de torneo: texto genérico (sin rival/hora).
      if (p?.is_tournament === true) {
        return title
          ? t('match_callup_reminder_tournament', { title })
          : t('match_callup_reminder');
      }
      return title ? t('match_callup_reminder_named', { title }) : t('match_callup_reminder');
    }
    case 'attendance_pending_reminder': {
      const title = str(p, 'title');
      return title
        ? t('attendance_pending_reminder_named', { title })
        : t('attendance_pending_reminder');
    }
    case 'training_reminder':
      return t('training_reminder');
    case 'event_updated': {
      const title = str(p, 'title');
      return title ? t('event_updated_named', { title }) : t('event_updated');
    }
    case 'training_cancelled': {
      const title = str(p, 'title');
      return title ? t('training_cancelled_named', { title }) : t('training_cancelled');
    }
    case 'training_reinstated': {
      const title = str(p, 'title');
      return title ? t('training_reinstated_named', { title }) : t('training_reinstated');
    }
    case 'training_approval_requested': {
      const title = str(p, 'title');
      return title
        ? t('training_approval_requested_named', { title })
        : t('training_approval_requested');
    }
    case 'training_approved': {
      const title = str(p, 'title');
      return title ? t('training_approved_named', { title }) : t('training_approved');
    }
    case 'training_rejected': {
      const title = str(p, 'title');
      return title ? t('training_rejected_named', { title }) : t('training_rejected');
    }
    case 'player_promoted': {
      const team = str(p, 'team_name');
      const key = str(p, 'kind') === 'train'
        ? 'player_promoted_train'
        : 'player_promoted_match';
      return team ? t(`${key}_named`, { team }) : t(key);
    }
    case 'development_report_published':
      return t('development_report_published');
    case 'erasure_requested':
      // D6 — aviso a dirección. RGPD: texto genérico, SIN motivo ni nombre del menor;
      // el dato sensible vive solo en /direction/supresiones (payload lleva player_id
      // para trazabilidad, no se pinta).
      return t('erasure_requested');
    case 'evaluation_campaign_launched':
      return t('evaluation_campaign_launched');
    case 'goal':
      return t('goal');
    default:
      return t('generic');
  }
}
