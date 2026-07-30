/**
 * O2-4 PR-1 — Emisor Expo Push (servidor).
 *
 * Envía a los `expo_push_tokens` del user vía Expo Push API (`expo-server-sdk`).
 * El envío Expo NO necesita credencial de servidor. NO consulta el gate de
 * preferencias: lo hace el caller (`sendPushToUser` en web-push.ts) UNA sola vez
 * para ambos canales (web + expo). Limpia los tokens `DeviceNotRegistered`.
 *
 * La lógica pura (armar mensajes, clasificar tickets, detectar tokens muertos)
 * vive en `@misterfc/core` (testeable sin red); aquí solo la fontanería del SDK
 * y de Supabase (service role).
 */

import { Expo } from 'expo-server-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildExpoMessages,
  tallyExpoTickets,
  type ChannelResult,
  type Database,
  type ExpoNotificationData,
  type ExpoPushContent,
} from '@misterfc/core';

let expo: Expo | null = null;
function getExpo(): Expo {
  if (!expo) expo = new Expo();
  return expo;
}

/**
 * Envía a TODOS los Expo push tokens del user. Devuelve `null` si no tiene
 * tokens (distinto de `{sent:0}`). Borra los tokens que Expo reporta
 * DeviceNotRegistered (efecto secundario, independiente del status de la fila).
 */
export async function sendExpoToUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  content: ExpoPushContent,
  data: ExpoNotificationData,
): Promise<ChannelResult> {
  const { data: rows } = await supabase
    .from('expo_push_tokens')
    .select('token')
    .eq('user_id', userId);

  const tokens = (rows ?? [])
    .map((r) => r.token)
    .filter((t): t is string => typeof t === 'string' && Expo.isExpoPushToken(t));

  if (tokens.length === 0) return null;

  const messages = buildExpoMessages(tokens, content, data);
  const client = getExpo();
  const chunks = client.chunkPushNotifications(messages);

  // Los tickets vuelven en el MISMO orden que los mensajes (y los tokens). Un
  // chunk que revienta entero cuenta como failed_other para sus tokens.
  const tickets: unknown[] = [];
  for (const chunk of chunks) {
    try {
      const chunkTickets = await client.sendPushNotificationsAsync(chunk);
      for (const t of chunkTickets) tickets.push(t);
    } catch {
      for (let j = 0; j < chunk.length; j++) {
        tickets.push({ status: 'error', details: { error: 'ChunkFailed' } });
      }
    }
  }

  const tally = tallyExpoTickets(tokens, tickets);
  if (tally.dead_tokens.length > 0) {
    await supabase
      .from('expo_push_tokens')
      .delete()
      .in('token', tally.dead_tokens);
  }

  return {
    sent: tally.sent,
    failed_gone: tally.failed_gone,
    failed_other: tally.failed_other,
  };
}
