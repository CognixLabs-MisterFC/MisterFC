/**
 * F4.7 — Helpers para componer y validar `dedupe_key` de la tabla
 * `notifications`.
 *
 * Política: la dedupe_key es la única protección contra doble envío
 * del MISMO concepto si el cron corre dos veces. La componemos como:
 *
 *   `<type>:<channel>:<event_id>:<day_bucket>:<user_id>`
 *
 *  - type:        notification_type enum (string literal de Postgres).
 *  - channel:     notification_channel enum (in_app/push/email).
 *  - event_id:    UUID del evento ancla.
 *  - day_bucket:  YYYY-MM-DD (UTC). Granularidad diaria — el cron solo
 *                 fira 1×/día por concepto, así que choca solo si se
 *                 reintenta dentro del mismo día.
 *  - user_id:     UUID del destinatario.
 *
 * Validación: alphabet seguro, longitud máxima razonable (255 chars) y
 * estructura exacta de 5 segmentos. Si alguno faltase, throws.
 */

export type NotificationType =
  | 'match_callup_reminder'
  | 'attendance_pending_reminder'
  | 'training_reminder';

export type NotificationChannel = 'in_app' | 'push' | 'email';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_BUCKET_RE = /^\d{4}-\d{2}-\d{2}$/;

export function buildDedupeKey(args: {
  type: NotificationType;
  channel: NotificationChannel;
  event_id: string;
  day_bucket: string;
  user_id: string;
}): string {
  const { type, channel, event_id, day_bucket, user_id } = args;
  if (!UUID_RE.test(event_id)) {
    throw new Error('dedupe_key:event_id_invalid');
  }
  if (!UUID_RE.test(user_id)) {
    throw new Error('dedupe_key:user_id_invalid');
  }
  if (!DAY_BUCKET_RE.test(day_bucket)) {
    throw new Error('dedupe_key:day_bucket_invalid');
  }
  const key = `${type}:${channel}:${event_id}:${day_bucket}:${user_id}`;
  if (key.length > 255) {
    // Postgres `text` admite cualquier longitud; el limite es defensivo
    // contra typos accidentales (ej. concatenar dos UUIDs).
    throw new Error('dedupe_key:too_long');
  }
  return key;
}

/**
 * Parse inverso. Útil para tests y debugging. Devuelve null si la clave
 * no encaja con el formato esperado — nunca lanza.
 */
export function parseDedupeKey(key: string): {
  type: string;
  channel: string;
  event_id: string;
  day_bucket: string;
  user_id: string;
} | null {
  const parts = key.split(':');
  if (parts.length !== 5) return null;
  const [type, channel, event_id, day_bucket, user_id] = parts;
  if (!type || !channel || !event_id || !day_bucket || !user_id) return null;
  return { type, channel, event_id, day_bucket, user_id };
}

/**
 * Bucket diario en zona horaria del proyecto (Europe/Madrid). El cron
 * fira al amanecer Madrid; el bucket es el día Madrid en formato ISO
 * YYYY-MM-DD.
 *
 * Usamos `Intl.DateTimeFormat` para evitar dependencia de date-fns
 * (coherente con ADR-0006).
 */
export function dayBucketMadrid(ref: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Madrid',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ref);
  // en-CA → "YYYY-MM-DD" literal.
  return parts;
}
