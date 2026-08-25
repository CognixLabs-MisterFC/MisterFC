import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  sendDirectMessageFromClient,
  sendTeamMessageFromClient,
  sendStaffMessageFromClient,
  type Database,
  type SendMessageOutcome,
  type SendTeamMessageOutcome,
  type SendStaffMessageOutcome,
} from '@misterfc/core';
import { emitNotificationFanOut } from '@/lib/notify-bus';

export type { SendMessageOutcome, SendTeamMessageOutcome, SendStaffMessageOutcome };

/**
 * O2-5 F3 — Wrapper web del envío de mensajes (core). Único punto que inyecta el
 * fan-out real (`emitNotificationFanOut`, service-role) y el logger de Sentry. Lo
 * usan la Server Action web (cookie) y el route handler nativo (bearer): misma
 * lógica, mismo fan-out, mismo logging. Extraído SIN cambiar el comportamiento web.
 *
 * El fan-out se pasa como callback → el INSERT ocurre como el usuario (RLS) y el
 * service-role solo entra en este callback, DESPUÉS del insert.
 */

const sentryLog =
  (feature: string) =>
  (error: unknown, step: string, extra: Record<string, unknown>) =>
    Sentry.captureException(error, { tags: { feature, step }, extra });

export function sendDirectMessage(
  supabase: SupabaseClient<Database>,
  args: {
    conversationId: string;
    body: string;
    senderId: string;
    senderName: string | null;
    locale: string;
  },
): Promise<SendMessageOutcome> {
  return sendDirectMessageFromClient(
    supabase,
    args,
    (recipients, payload) => emitNotificationFanOut(recipients, payload),
    sentryLog('messaging'),
  );
}

export function sendTeamMessage(
  supabase: SupabaseClient<Database>,
  args: {
    teamConversationId: string;
    body: string;
    senderId: string;
    senderName: string | null;
    locale: string;
  },
): Promise<SendTeamMessageOutcome> {
  return sendTeamMessageFromClient(
    supabase,
    args,
    (recipients, payload) => emitNotificationFanOut(recipients, payload),
    sentryLog('messaging'),
  );
}

// O2-12 — Envío de mensaje privado entre STAFF. Mismo patrón: inserta como el usuario
// (RLS) y el fan-out (service-role) solo notifica al OTRO participante, DESPUÉS del
// insert. Lo consume el route handler nativo (bearer); la web de usuario no lo usa.
export function sendStaffMessage(
  supabase: SupabaseClient<Database>,
  args: {
    conversationId: string;
    body: string;
    senderId: string;
    senderName: string | null;
    locale: string;
  },
): Promise<SendStaffMessageOutcome> {
  return sendStaffMessageFromClient(
    supabase,
    args,
    (recipients, payload) => emitNotificationFanOut(recipients, payload),
    sentryLog('messaging'),
  );
}
