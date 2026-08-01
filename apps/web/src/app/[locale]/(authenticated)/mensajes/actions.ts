'use server';

import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  createSupabaseServerClient,
  getConversationMessagesFromClient,
  getTeamMessagesFromClient,
  sendMessageSchema,
  startConversationSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadShellContext } from '@/lib/auth-shell';
import {
  sendDirectMessage,
  sendTeamMessage as sendTeamMessageWrapped,
} from '@/lib/send-message';
import { userCanMessageInClub } from '@/lib/messaging-permissions';
import { getActiveSeasonLabel } from '@/lib/active-season';

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

  // Orquestación compartida con el route handler nativo (O2-5 F3): insert como el
  // usuario (RLS = gate) + fan-out DESPUÉS. El wrapper inyecta el fan-out real
  // (service-role) y Sentry. Comportamiento web idéntico.
  const res = await sendDirectMessage(supabase, {
    conversationId: parsed.data.conversation_id,
    body: parsed.data.body,
    senderId: ctx.user.id,
    senderName: ctx.profile.full_name ?? null,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/${parsed.data.conversation_id}`);
  return { ok: { message_id: res.ok.message.id } };
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
    .is('erased_at', null) // F14-7: no se puede mensajear a un jugador suprimido
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
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Orquestación compartida (O2-5 F3): insert como el usuario (RLS = gate) +
  // fan-out a los miembros derivados DESPUÉS. Wrapper inyecta fan-out + Sentry.
  const res = await sendTeamMessageWrapped(supabase, {
    teamConversationId: input.team_conversation_id,
    body: input.body,
    senderId: ctx.user.id,
    senderName: ctx.profile.full_name ?? null,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/${locale}/mensajes`);
  revalidatePath(`/${locale}/mensajes/equipo/${res.ok.teamId}`);
  return { ok: { message_id: res.ok.message.id } };
}

export type MessageableTeam = { id: string; name: string };
export type ListMessageableTeamsResult = {
  teams?: MessageableTeam[];
  error?: 'forbidden' | 'generic';
};

/**
 * Equipos del club para el selector "Chat de equipo" de /mensajes (P2b). Gated
 * por userCanMessageInClub (staff/dirección — a los jugadores/familia les basta
 * el listado de /mensajes, que ya muestra sus grupos). El gate real de crear/abrir
 * lo impone la RLS de team_conversations + la página del hilo; esto solo decide
 * QUÉ ofrecer para no acabar en callejones sin salida.
 *
 * Bug 1 (temporada): `teams` es una fila POR TEMPORADA desde Rework A
 * (unique(club_id, name, season)), así que sin filtrar por temporada el mismo
 * equipo aparece repetido una vez por temporada. Se acota a la temporada ACTIVA
 * del club (seasons.status='active'), igual que el hub de Equipos.
 *
 * Bug 2 (scope por rol): quien tiene chat de TODOS los equipos del club es, por
 * la RLS de F5B-2 (user_is_admin_or_director), solo admin_club/director. El resto
 * (coordinador y entrenadores) solo es miembro del chat de los equipos que
 * ENTRENA (team_staff). Por eso se ramifica: admin/director ven todos los equipos
 * de la temporada activa; los demás, solo los que entrenan en esa temporada —
 * ofrecer más los llevaría a un hilo que la RLS no les deja abrir.
 */
export async function listMessageableTeams(): Promise<ListMessageableTeamsResult> {
  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const clubId = ctx.activeClub.club.id;
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const canMessage = await userCanMessageInClub(supabase, ctx);
  if (!canMessage) return { error: 'forbidden' };

  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  // El rol del user en el club activo ya viene resuelto en el contexto de sesión
  // (ctx.activeClub.role). Alineamos "ve todos" con la RLS: admin_club/director.
  const isAdminDir =
    ctx.activeClub.role === 'admin_club' || ctx.activeClub.role === 'director';

  // Base: equipos del club en la temporada activa (columna denormalizada
  // teams.club_id, disponible desde A1; sin join a categories).
  let query = supabase
    .from('teams')
    .select('id, name')
    .eq('club_id', clubId)
    .eq('season', activeSeason);

  if (!isAdminDir) {
    // Solo los equipos que el usuario entrena (team_staff activo). team_staff
    // apunta a la fila de team de su temporada, así que el .in() combinado con
    // .eq('season', activeSeason) deja únicamente sus equipos de la activa.
    const { data: staffRows, error: staffError } = await supabase
      .from('team_staff')
      .select('team_id')
      .eq('membership_id', ctx.activeClub.membershipId)
      .is('left_at', null);

    if (staffError) {
      Sentry.captureException(staffError, {
        tags: { feature: 'messaging', step: 'list_messageable_teams_staff' },
        extra: { club_id: clubId },
      });
      return { error: 'generic' };
    }

    const teamIds = (staffRows ?? []).map((r) => r.team_id as string);
    if (teamIds.length === 0) return { teams: [] };
    query = query.in('id', teamIds);
  }

  const { data, error } = await query
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
  // O2-5 E2a — el fetch se extrajo a core (misma query + RLS) para compartirlo
  // con la app nativa. Comportamiento idéntico.
  return getConversationMessagesFromClient(supabase, conversationId);
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
  // O2-5 E2a — el fetch se extrajo a core (misma query + RLS). Idéntico.
  return getTeamMessagesFromClient(supabase, teamConversationId);
}

// ─────────────────────────────────────────────────────────────────────────────
// F5B-4 — Supervisión: el director activa/desactiva su participación en un chat.
// ─────────────────────────────────────────────────────────────────────────────

export type TeamChatMode = 'observer' | 'active';
export type SetTeamChatParticipationResult = {
  ok?: { mode: TeamChatMode };
  error?: 'forbidden' | 'invalid_payload' | 'generic';
};

/**
 * Fija el modo de participación del director/admin en el chat de un equipo:
 * 'active' (escribe + recibe notificaciones) u 'observer' (solo lee). Upsert en
 * team_chat_participation. SOLO para admin/director (staff/jugadores participan
 * por pertenencia derivada y no usan esta tabla). La RLS de la tabla es la
 * autoridad final; aquí filtramos por rol para no intentar escrituras que la RLS
 * rechazaría.
 */
export async function setTeamChatParticipation(
  locale: string,
  input: { team_id: string; mode: TeamChatMode },
): Promise<SetTeamChatParticipationResult> {
  if (
    !input.team_id ||
    (input.mode !== 'observer' && input.mode !== 'active')
  ) {
    return { error: 'invalid_payload' };
  }

  const ctx = await loadShellContext();
  if (!ctx) return { error: 'forbidden' };

  const isAdminDir =
    ctx.activeClub.role === 'admin_club' || ctx.activeClub.role === 'director';
  if (!isAdminDir) return { error: 'forbidden' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('team_chat_participation')
    .upsert(
      {
        profile_id: ctx.user.id,
        team_id: input.team_id,
        mode: input.mode,
      },
      { onConflict: 'profile_id,team_id' },
    );

  if (error) {
    if (error.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(error, {
      tags: { feature: 'messaging', step: 'set_team_chat_participation' },
      extra: { team_id: input.team_id },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/${locale}/mensajes/equipo/${input.team_id}`);
  return { ok: { mode: input.mode } };
}
