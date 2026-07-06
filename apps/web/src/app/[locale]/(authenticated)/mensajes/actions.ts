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

// ─────────────────────────────────────────────────────────────────────────────
// F5B-3 — Chat de EQUIPO (grupo). Modelo team_conversations/team_messages (F5B-2).
// ─────────────────────────────────────────────────────────────────────────────

export type OpenTeamConversationResult = {
  ok?: { conversation_id: string };
  error?: 'forbidden' | 'no_active_club' | 'team_not_in_club' | 'generic';
};

/**
 * Abre (o crea si no existe) el hilo de grupo del equipo. Idempotente por
 * UNIQUE(team_id): si ya existe, devuelve el existente. Crear el hilo lo permite
 * la RLS solo a staff del equipo o admin/director (para jugadores/familia sin
 * hilo aún → 'forbidden'). El club_id lo fija el trigger; lo pasamos por
 * coherencia de tipos.
 */
export async function createTeamConversation(
  locale: string,
  teamId: string,
): Promise<OpenTeamConversationResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // ¿Ya existe? La RLS SELECT devuelve la fila solo si el user es miembro.
  const { data: existing } = await supabase
    .from('team_conversations')
    .select('id')
    .eq('team_id', teamId)
    .maybeSingle();
  if (existing?.id) return { ok: { conversation_id: existing.id } };

  const { data: created, error: insErr } = await supabase
    .from('team_conversations')
    .insert({ club_id: clubId, team_id: teamId })
    .select('id')
    .single();

  if (insErr || !created) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    // 23503/trigger cross-club, etc.
    if (insErr?.message?.includes('team_conversation_team_not_found')) {
      return { error: 'team_not_in_club' };
    }
    Sentry.captureException(insErr ?? new Error('insert returned null'), {
      tags: { feature: 'messaging', step: 'create_team_conversation' },
      extra: { team_id: teamId, club_id: clubId },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/equipo/${teamId}`);
  return { ok: { conversation_id: created.id } };
}

export type SendTeamMessageResult = {
  ok?: { message_id: string };
  error?:
    | 'forbidden'
    | 'invalid_payload'
    | 'rate_limited'
    | 'conversation_not_found'
    | 'generic';
};

/**
 * Envía un mensaje al hilo de grupo. La RLS de team_messages valida la
 * pertenencia (bidireccional — todo miembro escribe); el trigger fuerza sender =
 * auth.uid(). Tras insertar, notifica al resto de miembros derivados vía
 * team_chat_member_profile_ids (fan-out), respetando notification_preferences.
 *
 * NOTA F5B-4: aquí el director recibe como cualquiera. El filtrado observer
 * (excluir directores que solo vigilan) se añadirá filtrando `recipients` antes
 * del fan-out; el punto de extensión ya está aislado abajo.
 */
export async function sendTeamMessage(
  locale: string,
  input: { team_conversation_id: string; body: string },
): Promise<SendTeamMessageResult> {
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  if (
    !input.team_conversation_id ||
    body.length === 0 ||
    body.length > 2000
  ) {
    return { error: 'invalid_payload' };
  }

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Resolver la conversación (RLS: solo miembro la ve) + el team para el fan-out.
  const { data: conv } = await supabase
    .from('team_conversations')
    .select('id, team_id, teams!inner(name)')
    .eq('id', input.team_conversation_id)
    .maybeSingle();
  if (!conv) return { error: 'conversation_not_found' };
  const teamName =
    (conv as unknown as { teams: { name: string } }).teams?.name ?? '';

  // Rate limit por emisor (mismo límite que el 1:1), contando team_messages.
  const windowStartIso = new Date(
    Date.now() - MESSAGE_RATE_LIMIT.windowSeconds * 1000,
  ).toISOString();
  const { count } = await supabase
    .from('team_messages')
    .select('id', { count: 'exact', head: true })
    .eq('sender_profile_id', ctx.user.id)
    .gte('created_at', windowStartIso);
  if ((count ?? 0) >= MESSAGE_RATE_LIMIT.maxMessages) {
    return { error: 'rate_limited' };
  }

  const { data: inserted, error: insErr } = await supabase
    .from('team_messages')
    .insert({
      team_conversation_id: input.team_conversation_id,
      sender_profile_id: ctx.user.id,
      body,
    })
    .select('id')
    .single();

  if (insErr || !inserted) {
    if (insErr?.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr ?? new Error('insert returned null'), {
      tags: { feature: 'messaging', step: 'send_team_message' },
      extra: { team_conversation_id: input.team_conversation_id },
    });
    return { error: 'generic' };
  }

  // Fan-out a los miembros derivados MENOS el emisor. team_chat_member_profile_ids
  // (SECURITY DEFINER) devuelve staff ∪ jugador/familia vigentes ∪ directores.
  try {
    const { data: memberIds } = await supabase.rpc(
      'team_chat_member_profile_ids',
      { p_team_id: conv.team_id },
    );
    const recipients = ((memberIds ?? []) as string[]).filter(
      (id) => id !== ctx.user.id,
    );
    // [F5B-4] Punto de extensión: aquí se filtrarán los directores en modo
    // observer antes del fan-out.
    if (recipients.length > 0) {
      const senderName = ctx.profile.full_name ?? 'Mensaje nuevo';
      const preview = body.slice(0, 140);
      const deepLink = `/${locale}/mensajes/equipo/${conv.team_id}`;
      const { emitNotificationFanOut } = await import('@/lib/notify-bus');
      await emitNotificationFanOut(
        recipients.map((u) => ({ user_id: u })),
        {
          type: 'new_message',
          in_app_payload: {
            team_conversation_id: input.team_conversation_id,
            message_id: inserted.id,
            team_id: conv.team_id,
            sender_profile_id: ctx.user.id,
            deep_link: deepLink,
          },
          push_payload: {
            title: teamName ? `${teamName}` : senderName,
            body: `${senderName}: ${preview}`,
            deep_link: deepLink,
            tag: `team_conversation:${input.team_conversation_id}`,
          },
          dedupe_base_prefix: `new_message:${inserted.id}`,
        },
      );
    }
  } catch (notifyErr) {
    Sentry.captureException(notifyErr, {
      tags: { feature: 'messaging', step: 'notify_team' },
      extra: { message_id: inserted.id },
    });
  }

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/equipo/${conv.team_id}`);
  return { ok: { message_id: inserted.id } };
}

export type MessageableTeam = { id: string; name: string };
export type ListMessageableTeamsResult = {
  teams?: MessageableTeam[];
  error?: 'forbidden' | 'generic';
};

/**
 * Equipos del club para el selector "Chat de equipo" de /mensajes (P2b). Gated
 * por userCanMessageInClub (staff/dirección — a los jugadores/familia les basta
 * el listado de /mensajes, que ya muestra sus grupos). Devuelve los equipos del
 * club activo (RLS teams = miembro del club los ve); el gate real de crear/abrir
 * lo impone la RLS de team_conversations + la página del hilo.
 */
export async function listMessageableTeams(): Promise<ListMessageableTeamsResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, categories!inner(club_id)')
    .eq('categories.club_id', clubId)
    .order('name', { ascending: true })
    .limit(500);

  if (error) {
    Sentry.captureException(error, {
      tags: { feature: 'messaging', step: 'list_messageable_teams' },
      extra: { club_id: clubId },
    });
    return { error: 'generic' };
  }

  const teams = ((data ?? []) as Array<{ id: string; name: string }>).map(
    (t) => ({ id: t.id, name: t.name }),
  );
  return { teams };
}

// ─────────────────────────────────────────────────────────────────────────────
// F5B-3b — Refetch ligero de mensajes para el auto-refresco por polling (~5s).
// Solo lectura; la RLS filtra por pertenencia (1:1 participant / grupo miembro).
// No revalida ni marca leídos: el hilo abierto solo REPINTA lo nuevo.
// ─────────────────────────────────────────────────────────────────────────────

export type ConversationMessage = {
  id: string;
  sender_profile_id: string;
  body: string;
  sent_at: string;
  read_at: string | null;
};

/** Mensajes del hilo 1:1 (para el polling del MessageThread). */
export async function fetchConversationMessages(
  conversationId: string,
): Promise<ConversationMessage[]> {
  const ctx = await loadShellContext();
  if (!ctx) return [];
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('messages')
    .select('id, sender_profile_id, body, sent_at, read_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });

  return (data ?? []) as ConversationMessage[];
}

export type TeamThreadMessage = {
  id: string;
  sender_profile_id: string;
  sender_name: string;
  body: string;
  created_at: string;
};

/** Mensajes del hilo de grupo (para el polling del TeamMessageThread). */
export async function fetchTeamMessages(
  teamConversationId: string,
): Promise<TeamThreadMessage[]> {
  const ctx = await loadShellContext();
  if (!ctx) return [];
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data } = await supabase
    .from('team_messages')
    .select('id, sender_profile_id, body, created_at, profiles!inner(full_name)')
    .eq('team_conversation_id', teamConversationId)
    .order('created_at', { ascending: true });

  type Row = {
    id: string;
    sender_profile_id: string;
    body: string;
    created_at: string;
    profiles: { full_name: string | null };
  };
  return ((data ?? []) as unknown as Row[]).map((m) => ({
    id: m.id,
    sender_profile_id: m.sender_profile_id,
    sender_name: m.profiles?.full_name ?? '',
    body: m.body,
    created_at: m.created_at,
  }));
}
