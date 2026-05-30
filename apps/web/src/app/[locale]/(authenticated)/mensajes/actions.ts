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

export type StartConversationResult = {
  ok?: { conversation_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'player_not_in_club'
    | 'no_active_club'
    | 'generic';
};

const ROLES_THAT_CAN_MESSAGE: ReadonlyArray<string> = [
  'admin_club',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante', // requiere can_message_families — verificado abajo
];

/**
 * Abre (o reusa) una conversación 1:1 entre el coach (auth.uid()) y un
 * jugador del club activo. Idempotente por UNIQUE (coach_profile_id,
 * player_id) — si ya existe, devuelve la misma.
 *
 * Permisos: admin/coord/principal pueden por rol; ayudante necesita la
 * capability `can_message_families` granted en su membership del club.
 * La RLS también lo bloquea por defensa en profundidad.
 */
export async function startConversation(
  locale: string,
  input: { player_id: string },
): Promise<StartConversationResult> {
  const parsed = startConversationSchema.safeParse(input);
  if (!parsed.success) return { error: 'invalid_payload' };

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };
  if (!ROLES_THAT_CAN_MESSAGE.includes(ctx.activeClub.role)) {
    return { error: 'forbidden' };
  }

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Ayudante: verificar capability.
  if (ctx.activeClub.role === 'entrenador_ayudante') {
    const { data: cap } = await supabase
      .from('capabilities')
      .select('granted')
      .eq('membership_id', ctx.activeClub.membershipId)
      .eq('capability_name', 'can_message_families')
      .maybeSingle();
    if (!cap?.granted) return { error: 'forbidden' };
  }

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
