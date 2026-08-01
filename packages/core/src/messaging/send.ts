/**
 * O2-5 F3 — Envío de mensajes (1:1 y equipo), orquestación framework-agnóstica.
 *
 * Extraída de las Server Actions web `sendMessage` / `sendTeamMessage`
 * (apps/web/.../mensajes/actions.ts) para compartirla con el route handler nativo
 * (bearer). La web pasa a delegar (wrapper con Sentry), comportamiento idéntico.
 *
 * ORDEN = GARANTÍA DE SEGURIDAD:
 *   1. El INSERT en messages/team_messages se hace con el cliente RLS del usuario.
 *      La RLS exige ser participante → un no-participante ni ve la conversación
 *      (SELECT vacío → conversation_not_found) ni puede insertar (42501 → forbidden).
 *   2. El FAN-OUT (service-role: campana + push) es un callback INYECTADO que solo
 *      se invoca DESPUÉS de un insert exitoso. Nunca antes, nunca como service-role
 *      para el insert. Core no importa Sentry ni el admin client: ambos se inyectan.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { sendMessageSchema, MESSAGE_RATE_LIMIT } from '../schemas/messaging';
import type { ConversationMessage, TeamThreadMessage } from './queries';

type Sb = SupabaseClient<Database>;

/**
 * Fan-out inyectado (web: `emitNotificationFanOut` de notify-bus, service-role).
 * Core solo lo llama tras el insert; su implementación (campana + push blindado en
 * O2-4) vive en la web.
 */
export type MessageFanOut = (
  recipients: ReadonlyArray<{ user_id: string }>,
  payload: {
    type: 'new_message';
    in_app_payload: Record<string, string>;
    push_payload: { title: string; body: string; deep_link: string; tag: string };
    dedupe_base_prefix: string;
  },
) => Promise<unknown>;

/** Sumidero de errores para el caller (web: Sentry). */
export type SendMessageLogger = (
  error: unknown,
  step: string,
  extra: Record<string, unknown>,
) => void;

export type SendMessageOutcome =
  | { ok: { message: ConversationMessage } }
  | {
      error:
        | 'invalid_payload'
        | 'conversation_not_found'
        | 'rate_limited'
        | 'forbidden'
        | 'generic';
    };

export type SendTeamMessageOutcome =
  | { ok: { message: TeamThreadMessage; teamId: string } }
  | {
      error:
        | 'invalid_payload'
        | 'conversation_not_found'
        | 'rate_limited'
        | 'forbidden'
        | 'generic';
    };

const noopLog: SendMessageLogger = () => {};

/**
 * Envía un mensaje 1:1. Insert como el usuario (RLS = gate) + fan-out al otro lado
 * (coach → cuentas del jugador; familia/jugador → coach) DESPUÉS del insert.
 */
export async function sendDirectMessageFromClient(
  supabase: Sb,
  args: {
    conversationId: string;
    body: string;
    senderId: string;
    senderName: string | null;
    locale: string;
  },
  fanOut: MessageFanOut,
  logError?: SendMessageLogger,
): Promise<SendMessageOutcome> {
  const log = logError ?? noopLog;
  const parsed = sendMessageSchema.safeParse({
    conversation_id: args.conversationId,
    body: args.body,
  });
  if (!parsed.success) return { error: 'invalid_payload' };

  // La conversación (RLS: solo participante la ve). Vacío → not_found (también el
  // caso de un no-participante, al que la RLS oculta la fila).
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, club_id, player_id, coach_profile_id')
    .eq('id', parsed.data.conversation_id)
    .maybeSingle();
  if (!conv) return { error: 'conversation_not_found' };

  // Rate limit por emisor (30 / 5 min).
  const windowStartIso = new Date(
    Date.now() - MESSAGE_RATE_LIMIT.windowSeconds * 1000,
  ).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_profile_id', args.senderId)
    .gte('sent_at', windowStartIso);
  if ((count ?? 0) >= MESSAGE_RATE_LIMIT.maxMessages) {
    return { error: 'rate_limited' };
  }

  // INSERT COMO EL USUARIO (RLS = gate). 42501 → forbidden (defensa secundaria).
  const { data: inserted, error: insErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: parsed.data.conversation_id,
      sender_profile_id: args.senderId,
      body: parsed.data.body,
    })
    .select('id, sender_profile_id, body, sent_at, read_at')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    log(insErr ?? new Error('insert returned null'), 'send_message', {
      conversation_id: parsed.data.conversation_id,
    });
    return { error: 'generic' };
  }

  // FAN-OUT DESPUÉS del insert exitoso. Nunca frena el envío (try/catch → log).
  try {
    const recipientUserIds: string[] = [];
    if (conv.coach_profile_id === args.senderId) {
      // Coach → familia / jugador (todas las cuentas del jugador).
      const { data: pas } = await supabase
        .from('player_accounts')
        .select('profile_id')
        .eq('player_id', conv.player_id);
      for (const r of pas ?? []) {
        if (r.profile_id) recipientUserIds.push(r.profile_id as string);
      }
    } else {
      // Familia / jugador → coach.
      recipientUserIds.push(conv.coach_profile_id);
    }

    if (recipientUserIds.length > 0) {
      const preview = parsed.data.body.slice(0, 140);
      const deepLink = `/${args.locale}/mensajes/${parsed.data.conversation_id}`;
      await fanOut(
        recipientUserIds.map((u) => ({ user_id: u })),
        {
          type: 'new_message',
          in_app_payload: {
            conversation_id: parsed.data.conversation_id,
            message_id: inserted.id,
            sender_profile_id: args.senderId,
            deep_link: deepLink,
          },
          push_payload: {
            title: args.senderName ?? 'Mensaje nuevo',
            body: preview,
            deep_link: deepLink,
            tag: `conversation:${parsed.data.conversation_id}`,
          },
          dedupe_base_prefix: `new_message:${inserted.id}`,
        },
      );
    }
  } catch (notifyErr) {
    log(notifyErr, 'notify', { message_id: inserted.id });
  }

  return { ok: { message: inserted as ConversationMessage } };
}

/**
 * Envía un mensaje al hilo de EQUIPO. Insert como el usuario (RLS = gate) + fan-out
 * a los miembros derivados (RPC team_chat_member_profile_ids) menos el emisor.
 */
export async function sendTeamMessageFromClient(
  supabase: Sb,
  args: {
    teamConversationId: string;
    body: string;
    senderId: string;
    senderName: string | null;
    locale: string;
  },
  fanOut: MessageFanOut,
  logError?: SendMessageLogger,
): Promise<SendTeamMessageOutcome> {
  const log = logError ?? noopLog;
  const body = typeof args.body === 'string' ? args.body.trim() : '';
  if (!args.teamConversationId || body.length === 0 || body.length > 2000) {
    return { error: 'invalid_payload' };
  }

  const { data: conv } = await supabase
    .from('team_conversations')
    .select('id, team_id, teams!inner(name)')
    .eq('id', args.teamConversationId)
    .maybeSingle();
  if (!conv) return { error: 'conversation_not_found' };
  const teamName =
    (conv as unknown as { teams: { name: string } }).teams?.name ?? '';

  const windowStartIso = new Date(
    Date.now() - MESSAGE_RATE_LIMIT.windowSeconds * 1000,
  ).toISOString();
  const { count } = await supabase
    .from('team_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_profile_id', args.senderId)
    .gte('created_at', windowStartIso);
  if ((count ?? 0) >= MESSAGE_RATE_LIMIT.maxMessages) {
    return { error: 'rate_limited' };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('team_messages')
    .insert({
      team_conversation_id: args.teamConversationId,
      sender_profile_id: args.senderId,
      body,
    })
    .select('id, sender_profile_id, body, created_at')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    log(insErr ?? new Error('insert returned null'), 'send_team_message', {
      team_conversation_id: args.teamConversationId,
    });
    return { error: 'generic' };
  }

  try {
    const { data: memberIds } = await supabase.rpc(
      'team_chat_member_profile_ids',
      { p_team_id: conv.team_id },
    );
    const recipients = ((memberIds ?? []) as string[]).filter(
      (id) => id !== args.senderId,
    );
    if (recipients.length > 0) {
      const senderName = args.senderName ?? 'Mensaje nuevo';
      const preview = body.slice(0, 140);
      const deepLink = `/${args.locale}/mensajes/equipo/${conv.team_id}`;
      await fanOut(
        recipients.map((u) => ({ user_id: u })),
        {
          type: 'new_message',
          in_app_payload: {
            team_conversation_id: args.teamConversationId,
            message_id: inserted.id,
            team_id: conv.team_id,
            sender_profile_id: args.senderId,
            deep_link: deepLink,
          },
          push_payload: {
            title: teamName ? teamName : senderName,
            body: `${senderName}: ${preview}`,
            deep_link: deepLink,
            tag: `team_conversation:${args.teamConversationId}`,
          },
          dedupe_base_prefix: `new_message:${inserted.id}`,
        },
      );
    }
  } catch (notifyErr) {
    log(notifyErr, 'notify_team', { message_id: inserted.id });
  }

  return {
    ok: {
      message: {
        id: inserted.id,
        sender_profile_id: inserted.sender_profile_id,
        sender_name: args.senderName ?? '',
        body: inserted.body,
        created_at: inserted.created_at,
      },
      teamId: conv.team_id,
    },
  };
}
