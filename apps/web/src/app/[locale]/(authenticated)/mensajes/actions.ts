'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  sendMessageSchema,
  startConversationSchema,
  MESSAGE_RATE_LIMIT,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import { userCanMessageInClub } from '@/lib/messaging-permissions';

export type StartConversationResult = {
  ok?: { conversation_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'player_not_in_club'
    | 'no_active_club'
    | 'generic';
};

/**
 * Abre (o reusa) una conversación 1:1 entre el coach (auth.uid()) y un
 * jugador del club activo. Idempotente por UNIQUE (coach_profile_id,
 * player_id) — si ya existe, devuelve la misma.
 *
 * Permisos: admin/coord/principal por rol; ayudante con cap on, O
 * ayudante con team_staff.staff_role='entrenador_principal' (caso F2.6 —
 * ver `userCanMessageInClub`). RLS es la autoridad final.
 */
export async function startConversation(
  locale: string,
  input: { player_id: string },
): Promise<StartConversationResult> {
  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  // Verificar que el player pertenece al club activo (defensa en profundidad;
  // el trigger conversations_same_club_trg también lo verifica).
  const { data: player } = await supabase
    .from('players')
    .select('id, club_id')
    .eq('id', parsed.data.player_id)
    .maybeSingle();
  if (!player || player.club_id !== clubId) {
    return { error: 'player_not_in_club' };
  }

  // UPSERT por (coach_profile_id, player_id) UNIQUE. Si ya existe, .select()
  // devuelve la fila existente.
  const { data: existing } = await supabase
    .from('conversations')
    .select('id')
    .eq('coach_profile_id', ctx.user.id)
    .eq('player_id', parsed.data.player_id)
    .maybeSingle();

  if (existing?.id) {
    return { ok: { conversation_id: existing.id } };
  }

  const { data: created, error: insErr } = await supabase
    .from('conversations')
    .insert({
      club_id: clubId,
      player_id: parsed.data.player_id,
      coach_profile_id: ctx.user.id,
    })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr ?? new Error('insert returned null'), {
      tags: { feature: 'messaging', step: 'start_conversation' },
      extra: { player_id: parsed.data.player_id, club_id: clubId },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/jugadores/${parsed.data.player_id}`);
  return { ok: { conversation_id: created.id } };
}

export type SendMessageResult = {
  ok?: { message_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'rate_limited'
    | 'conversation_not_found'
    | 'generic';
};

/**
 * Envía un mensaje a una conversación existente. El sender se fuerza a
 * auth.uid() vía trigger BD; aquí también lo hacemos por explicitud. Rate
 * limit: 30 / 5 min por sender (ADR D7 del spec 5.0). Tras inserto válido,
 * crea fila en notifications para la otra parte (Lote B la enviará por push).
 */
export async function sendMessage(
  locale: string,
  input: { conversation_id: string; body: string },
): Promise<SendMessageResult> {
  const parsed = sendMessageSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Verificar que la conversation existe Y el user es participant (RLS lo
  // bloquearía igualmente; el SELECT permite devolver error semántico).
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, club_id, player_id, coach_profile_id')
    .eq('id', parsed.data.conversation_id)
    .maybeSingle();
  if (!conv) return { error: 'conversation_not_found' };

  // Rate limit: contar mensajes propios en los últimos 5 min.
  const windowStartIso = new Date(
    Date.now() - MESSAGE_RATE_LIMIT.windowSeconds * 1000,
  ).toISOString();
  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_profile_id', ctx.user.id)
    .gte('sent_at', windowStartIso);
  if ((count ?? 0) >= MESSAGE_RATE_LIMIT.maxMessages) {
    return { error: 'rate_limited' };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('messages')
    .insert({
      conversation_id: parsed.data.conversation_id,
      sender_profile_id: ctx.user.id,
      body: parsed.data.body,
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr ?? new Error('insert returned null'), {
      tags: { feature: 'messaging', step: 'send_message' },
      extra: { conversation_id: parsed.data.conversation_id },
    });
    return { error: 'generic' };
  }

  // F5.7 — Notificación al otro participante. Para la conversación
  // coach<>player: si el sender es el coach, recipient son todas las
  // accounts del player (jugador + familia). Si el sender es la familia o
  // el propio jugador, recipient es el coach.
  try {
    const { data: convExtra } = await supabase
      .from('conversations')
      .select('coach_profile_id, player_id')
      .eq('id', parsed.data.conversation_id)
      .maybeSingle();

    if (convExtra) {
      const recipientUserIds: string[] = [];
      if (convExtra.coach_profile_id === ctx.user.id) {
        // Coach → familia / jugador
        const { data: pas } = await supabase
          .from('player_accounts')
          .select('profile_id')
          .eq('player_id', convExtra.player_id);
        for (const r of pas ?? []) {
          if (r.profile_id) recipientUserIds.push(r.profile_id as string);
        }
      } else {
        // Family / player → coach
        recipientUserIds.push(convExtra.coach_profile_id);
      }

      const senderName = ctx.profile.full_name ?? 'Mensaje nuevo';
      const preview = parsed.data.body.slice(0, 140);
      const { emitNotificationFanOut } = await import('@/lib/notify-bus');
      await emitNotificationFanOut(
        recipientUserIds.map((u) => ({ user_id: u })),
        {
          type: 'new_message',
          in_app_payload: {
            conversation_id: parsed.data.conversation_id,
            message_id: inserted.id,
            sender_profile_id: ctx.user.id,
            deep_link: `/${locale}/mensajes/${parsed.data.conversation_id}`,
          },
          push_payload: {
            title: senderName,
            body: preview,
            deep_link: `/${locale}/mensajes/${parsed.data.conversation_id}`,
            tag: `conversation:${parsed.data.conversation_id}`,
          },
          dedupe_base_prefix: `new_message:${inserted.id}`,
        },
      );
    }
  } catch (notifyErr) {
    Sentry.captureException(notifyErr, {
      tags: { feature: 'messaging', step: 'notify' },
      extra: { message_id: inserted.id },
    });
  }

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/${parsed.data.conversation_id}`);
  return { ok: { message_id: inserted.id } };
}

export type MarkReadResult = { ok?: true; error?: 'forbidden' | 'generic' };

/**
 * Marca como leídos todos los mensajes de la conversación que NO ha enviado
 * el user actual (es decir, los recibidos por él/ella). Idempotente: si ya
 * están leídos, el UPDATE no afecta filas.
 */
export async function markConversationRead(
  locale: string,
  conversationId: string,
): Promise<MarkReadResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error: updErr } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .is('read_at', null)
    .neq('sender_profile_id', ctx.user.id);

  if (updErr) {
    if (updErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(updErr, {
      tags: { feature: 'messaging', step: 'mark_read' },
      extra: { conversation_id: conversationId },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/${conversationId}`);
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// listMessageablePlayers (F5B-1) — jugadores del club con los que el user puede
// iniciar un chat 1:1, para el selector con buscador de /mensajes.
// ─────────────────────────────────────────────────────────────────────────────

export type MessageablePlayer = {
  id: string;
  first_name: string;
  last_name: string | null;
};

export type ListMessageablePlayersResult = {
  players?: MessageablePlayer[];
  error?: 'forbidden' | 'generic';
};

/**
 * Devuelve los jugadores ACTIVOS del club activo (baja `left_club_at IS NULL`),
 * ordenados por nombre, para el selector "Nueva conversación". Solo lectura.
 *
 * Alcance: se gatea con `userCanMessageInClub` (mismo criterio que el botón de
 * la ficha del jugador) y se lee con el cliente del user → la RLS
 * `players_select_member` limita a los jugadores visibles del club. NO crea
 * nada; la conversación se abre después con `startConversation` (idempotente).
 *
 * El buscador filtra en cliente sobre esta lista (los clubs de la beta son
 * pequeños; se cap­a a 500 para acotar el payload). Si un club creciera mucho,
 * migrar a búsqueda por término en servidor.
 */
export async function listMessageablePlayers(): Promise<ListMessageablePlayersResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name')
    .eq('club_id', clubId)
    .is('left_club_at', null)
    .order('first_name', { ascending: true })
    .order('last_name', { ascending: true })
    .limit(500);

  if (error) {
    Sentry.captureException(error, {
      tags: { feature: 'messaging', step: 'list_messageable_players' },
      extra: { club_id: clubId },
    });
    return { error: 'generic' };
  }

  return { players: (data ?? []) as MessageablePlayer[] };
}
