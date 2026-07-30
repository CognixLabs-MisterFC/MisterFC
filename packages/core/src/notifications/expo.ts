/**
 * O2-4 PR-1 — Helpers puros del emisor Expo Push.
 *
 * Sin dependencias de red ni de `expo-server-sdk` (esa vive en apps/web). Aquí:
 *   - `expoDataFromNotification`: construye el `data` del push nativo → type +
 *     IDs del recurso, para que la app derive la ruta (NUNCA la ruta web /es/...).
 *   - `buildExpoMessages`: arma los mensajes Expo (uno por token).
 *   - `tallyExpoTickets` / `isDeviceNotRegistered`: clasifican la respuesta de
 *     Expo (sent/failed) y detectan los tokens muertos a limpiar.
 */

import type { Json } from '../supabase/types';

/**
 * `data` del push nativo. Siempre `type`; luego los IDs del recurso que se
 * encuentren en el payload (event_id, team_id, …). La app usa esto para derivar
 * la ruta con su propio port de `hrefFor(type, ids)`.
 */
export type ExpoNotificationData = { type: string } & Record<string, string>;

/** Claves de ID de recurso que conoce el enrutado (espejo de lo que usa hrefFor). */
const RESOURCE_ID_KEYS = [
  'event_id',
  'team_id',
  'conversation_id',
  'announcement_id',
  'play_id',
  'exercise_id',
  'player_id',
  'development_report_id',
  'campaign_id',
  'report_id',
  'message_id',
] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Último segmento del deep_link SOLO si es un UUID (id de recurso). Tolerante:
 * deep_links planos (`/es/calendario`, `/es/mensajes`) o con locale variable NO
 * tienen id al final → devuelve undefined (no se inventa nada).
 */
function resourceIdFromDeepLink(deepLink: string | undefined): string | undefined {
  if (!deepLink) return undefined;
  const path = deepLink.split(/[?#]/)[0] ?? '';
  const segments = path.split('/').filter((s) => s.length > 0);
  const last = segments[segments.length - 1];
  return last && UUID_RE.test(last) ? last : undefined;
}

/**
 * Construye el `data` del push nativo a partir del `type` + el payload de la fila.
 *
 *  - Eager (bus): se le pasa el `in_app_payload`, que trae event_id/team_id/etc.
 *    → data = { type, event_id, ... } (IDs estructurados).
 *  - Cron drainer: solo tiene el push payload con `deep_link` → se extrae el
 *    resource_id del último segmento SI es un UUID; si el deep_link es plano,
 *    data = { type } a secas (la app abre el destino del type sin id).
 */
export function expoDataFromNotification(
  type: string,
  payload: Json | null | undefined,
): ExpoNotificationData {
  const p = (payload ?? {}) as Record<string, unknown>;
  const data: ExpoNotificationData = { type };

  let hasStructuredId = false;
  for (const k of RESOURCE_ID_KEYS) {
    const v = p[k];
    if (typeof v === 'string' && v.length > 0) {
      data[k] = v;
      hasStructuredId = true;
    }
  }

  if (!hasStructuredId) {
    const rid = resourceIdFromDeepLink(
      typeof p.deep_link === 'string' ? p.deep_link : undefined,
    );
    if (rid) data.resource_id = rid;
  }

  return data;
}

export type ExpoPushContent = { title: string; body: string };

/** Mensaje Expo (estructuralmente compatible con `expo-server-sdk`). */
export type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data: ExpoNotificationData;
  sound: 'default';
  channelId: 'default';
  priority: 'high';
};

/** Un mensaje Expo por token, todos con el mismo contenido + data. */
export function buildExpoMessages(
  tokens: readonly string[],
  content: ExpoPushContent,
  data: ExpoNotificationData,
): ExpoPushMessage[] {
  return tokens.map((to) => ({
    to,
    title: content.title,
    body: content.body,
    data,
    sound: 'default',
    channelId: 'default',
    priority: 'high',
  }));
}

/**
 * ¿Un ticket/receipt de Expo indica DeviceNotRegistered? (token muerto: la app se
 * desinstaló o el token caducó → hay que borrarlo de expo_push_tokens).
 */
export function isDeviceNotRegistered(ticketOrReceipt: unknown): boolean {
  if (!ticketOrReceipt || typeof ticketOrReceipt !== 'object') return false;
  const t = ticketOrReceipt as { status?: unknown; details?: { error?: unknown } };
  return t.status === 'error' && t.details?.error === 'DeviceNotRegistered';
}

export type ExpoSendCounts = {
  sent: number;
  failed_gone: number;
  failed_other: number;
  /** Tokens a borrar de expo_push_tokens (DeviceNotRegistered). */
  dead_tokens: string[];
};

/**
 * Clasifica los tickets de Expo (paralelos a `tokens`, mismo orden): cada `ok` es
 * un envío, cada DeviceNotRegistered es un token muerto (failed_gone + a limpiar),
 * el resto de errores son failed_other (transitorios, se reintentan).
 */
export function tallyExpoTickets(
  tokens: readonly string[],
  tickets: readonly unknown[],
): ExpoSendCounts {
  let sent = 0;
  let failedGone = 0;
  let failedOther = 0;
  const deadTokens: string[] = [];

  tickets.forEach((ticket, i) => {
    const token = tokens[i];
    const status = (ticket as { status?: unknown })?.status;
    if (status === 'ok') {
      sent += 1;
    } else if (isDeviceNotRegistered(ticket)) {
      failedGone += 1;
      if (token) deadTokens.push(token);
    } else {
      failedOther += 1;
    }
  });

  return {
    sent,
    failed_gone: failedGone,
    failed_other: failedOther,
    dead_tokens: deadTokens,
  };
}
