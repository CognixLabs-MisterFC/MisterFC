'use server';

import { cookies, headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  assignPlayerToTeamSchema,
  createPlayerSchema,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  getCurrentUserClubs,
  invitePlayerTutorSchema,
  inviteSpectatorSchema,
  resolveActiveClub,
  updatePlayerSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { loadPendingInvitePlayers } from './queries';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function activeClubId(): Promise<string | null> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) return null;
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;
  const { active } = resolveActiveClub(clubs, cookieValue);
  return active?.club.id ?? null;
}

function readPositionsSecondary(formData: FormData): string[] {
  const raw = formData.getAll('positions_secondary');
  return raw.map((v) => String(v)).filter((v) => v.length > 0);
}

function parseCreatePlayerData(formData: FormData) {
  return createPlayerSchema.safeParse({
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    date_of_birth: formData.get('date_of_birth'),
    dorsal: formData.get('dorsal'),
    position_main: formData.get('position_main'),
    positions_secondary: readPositionsSecondary(formData),
    foot: formData.get('foot'),
    height_cm: formData.get('height_cm'),
    weight_kg: formData.get('weight_kg'),
    origin: formData.get('origin'),
    team_id: formData.get('team_id'),
    invite_email: formData.get('invite_email'),
    player_relation: formData.get('player_relation'),
  });
}

function parseUpdatePlayerData(formData: FormData) {
  return updatePlayerSchema.safeParse({
    first_name: formData.get('first_name'),
    last_name: formData.get('last_name'),
    date_of_birth: formData.get('date_of_birth'),
    dorsal: formData.get('dorsal'),
    position_main: formData.get('position_main'),
    positions_secondary: readPositionsSecondary(formData),
    foot: formData.get('foot'),
    height_cm: formData.get('height_cm'),
    weight_kg: formData.get('weight_kg'),
    origin: formData.get('origin'),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type PlayerFormError =
  | 'first_name_required'
  | 'first_name_too_long'
  | 'last_name_required'
  | 'last_name_too_long'
  | 'date_of_birth_required'
  | 'date_of_birth_invalid'
  | 'dorsal_invalid'
  | 'position_invalid'
  | 'positions_secondary_too_many'
  | 'foot_invalid'
  | 'height_cm_invalid'
  | 'weight_kg_invalid'
  | 'origin_too_long'
  | 'team_invalid'
  // Rework B2 (2026-07): email + relación de tutor + equipo obligatorios.
  | 'team_required'
  | 'email_required'
  | 'email_invalid'
  | 'email_too_long'
  | 'relation_required'
  | 'no_active_club'
  | 'forbidden'
  | 'generic';

export type PlayerFormState = {
  error?: PlayerFormError;
  success?: boolean;
  playerId?: string;
};

function mapPlayerError(message: string | undefined): PlayerFormError {
  const known: PlayerFormError[] = [
    'first_name_required',
    'first_name_too_long',
    'last_name_required',
    'last_name_too_long',
    'date_of_birth_required',
    'date_of_birth_invalid',
    'dorsal_invalid',
    'position_invalid',
    'positions_secondary_too_many',
    'foot_invalid',
    'height_cm_invalid',
    'weight_kg_invalid',
    'origin_too_long',
    'team_invalid',
    'team_required',
    'email_required',
    'email_invalid',
    'email_too_long',
    'relation_required',
  ];
  if (message && known.includes(message as PlayerFormError)) {
    return message as PlayerFormError;
  }
  return 'generic';
}

// ─────────────────────────────────────────────────────────────────────────────
// Circuito ÚNICO de invitación de tutor (rework B2) — reutilizado por el alta
// manual (createPlayer) y el botón de la ficha (inviteTutorForPlayer).
// ─────────────────────────────────────────────────────────────────────────────

type TutorInviteResult =
  | { ok: { email: string } }
  | { error: 'forbidden' | 'generic' };

/**
 * Envía —o RENUEVA— la invitación de tutor de un jugador. Anti-duplicado:
 *   1. Si ya hay una invitación VIGENTE (accepted_at IS NULL y no expirada) para
 *      el player, se RENUEVA (token nuevo + expiración +7d + email/relación del
 *      formulario) en vez de crear otra fila.
 *   2. Si no la hay, se INSERTA una nueva.
 *   3. Se envía el email con inviteUserByEmail; si el email ya está registrado,
 *      fallback a resetPasswordForEmail con el mismo redirectTo.
 * El permiso lo impone la RLS de `invitations` (INSERT admin/director; UPDATE
 * admin_club) — si el actor no puede, devuelve 'forbidden'.
 */
async function sendOrRenewTutorInvitation(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  locale: string,
  params: {
    playerId: string;
    clubId: string;
    email: string;
    relation: 'parent' | 'guardian';
    createdBy: string;
  },
): Promise<TutorInviteResult> {
  const { playerId, clubId, email, relation, createdBy } = params;

  // 1) ¿Invitación vigente para este jugador? (no aceptada y no caducada)
  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from('invitations')
    .select('id')
    .eq('player_id', playerId)
    .is('accepted_at', null)
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let invite: { id: string; token: string } | null = null;

  if (existing?.id) {
    // 1a) Renovar la existente: token nuevo + +7d, y actualiza email/relación al
    //     último valor del formulario. NO crea una segunda fila.
    const renewedExpiry = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const { data: renewed, error: updErr } = await supabase
      .from('invitations')
      .update({
        email,
        player_relation: relation,
        token: crypto.randomUUID(),
        expires_at: renewedExpiry,
      })
      .eq('id', existing.id)
      .select('id, token')
      .single();
    if (updErr) {
      if (updErr.code === '42501') return { error: 'forbidden' };
      Sentry.captureException(updErr, {
        tags: { feature: 'invitations', step: 'renew_tutor' },
        extra: { player_id: playerId, invitation_id: existing.id },
      });
      return { error: 'generic' };
    }
    invite = renewed as { id: string; token: string };
  } else {
    // 1b) Sin invitación vigente → crear.
    const { data: inserted, error: insErr } = await supabase
      .from('invitations')
      .insert({
        email,
        role: 'jugador',
        club_id: clubId,
        player_id: playerId,
        player_relation: relation,
        created_by: createdBy,
      })
      .select('id, token')
      .single();
    if (insErr) {
      if (insErr.code === '42501') return { error: 'forbidden' };
      Sentry.captureException(insErr, {
        tags: { feature: 'invitations', step: 'insert_tutor' },
        extra: { player_id: playerId, relation },
      });
      return { error: 'generic' };
    }
    invite = inserted as { id: string; token: string };
  }

  if (!invite) return { error: 'generic' };

  // 2) Enviar el email (mismo redirectTo directo a /invite/{token}).
  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const redirectTo = `${proto}://${host}/${locale}/invite/${invite.token}`;

  const admin = createSupabaseAdminClient();
  try {
    const { data: inviteData, error: invErr } =
      await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo,
        data: { invite_pending: true, invitation_id: invite.id },
      });
    if (invErr) {
      const msg = invErr.message?.toLowerCase() ?? '';
      const alreadyExists =
        ('code' in invErr && invErr.code === 'email_exists') ||
        msg.includes('already been registered') ||
        msg.includes('already exists');
      if (alreadyExists) {
        // Email ya registrado → mismo vehículo de redirect (patrón sendInvitation).
        // invited_user_id se deja como esté: es un invitee EXISTENTE (inicia
        // sesión con su contraseña); no lo creamos nosotros.
        const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
          email,
          { redirectTo },
        );
        if (resetErr) {
          Sentry.captureException(resetErr, {
            tags: { feature: 'invitations', step: 'reset_fallback_tutor' },
            extra: { invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
      } else {
        Sentry.captureException(invErr, {
          tags: { feature: 'invitations', step: 'inviteUserByEmail_tutor' },
          extra: { invitation_id: invite.id },
        });
        return { error: 'generic' };
      }
    } else {
      // Cuenta creada por nosotros para esta invitación (aún no reclamada).
      // Enlazamos su auth.users.id en invitations.invited_user_id — MISMO patrón
      // que el circuito de staff (invitations/actions.ts): chooseInviteForm lo usa
      // para enrutar al form set_password (pedir contraseña). Sin esto el invitee
      // nuevo caía en quick/sign_in y nunca fijaba contraseña.
      const invitedUserId = inviteData?.user?.id ?? null;
      if (invitedUserId) {
        const { error: linkErr } = await admin
          .from('invitations')
          .update({ invited_user_id: invitedUserId })
          .eq('id', invite.id);
        if (linkErr) {
          // No fatal para el envío: se registra. Sin invited_user_id el accept
          // trataría al invitee como existente (peor UX pero no rompe).
          Sentry.captureException(linkErr, {
            tags: { feature: 'invitations', step: 'link_invited_user_tutor' },
            extra: { invitation_id: invite.id },
          });
        }
      }
    }
  } catch (thrown) {
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'inviteUserByEmail_tutor_thrown' },
      extra: { invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  return { ok: { email } };
}

// ─────────────────────────────────────────────────────────────────────────────
// createPlayer (F2.3)
// ─────────────────────────────────────────────────────────────────────────────

export async function createPlayer(
  locale: string,
  _prev: PlayerFormState,
  formData: FormData
): Promise<PlayerFormState> {
  const parsed = parseCreatePlayerData(formData);
  if (!parsed.success) {
    return { error: mapPlayerError(parsed.error.issues[0]?.message) };
  }

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { team_id, positions_secondary, invite_email, player_relation, ...playerFields } =
    parsed.data;

  const insertPayload = {
    club_id: clubId,
    first_name: playerFields.first_name,
    last_name: playerFields.last_name,
    date_of_birth: playerFields.date_of_birth,
    dorsal: playerFields.dorsal,
    position_main: playerFields.position_main,
    positions_secondary,
    foot: playerFields.foot,
    height_cm: playerFields.height_cm,
    weight_kg: playerFields.weight_kg,
    origin: playerFields.origin,
    // Rework B2 — email del tutor persistido; deja al jugador invitable aunque
    // el envío automático de abajo fallara.
    invite_email,
  };

  const { data: created, error } = await supabase
    .from('players')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error || !created) {
    return { error: 'generic' };
  }

  // Equipo OBLIGATORIO (rework B2): siempre hay team_id. Si el insert de
  // team_members falla, no abortamos — el jugador queda creado y reasignable.
  await supabase.from('team_members').insert({
    player_id: created.id,
    team_id,
  });

  // Invitación AUTOMÁTICA al crear, mismo circuito que la ficha (con
  // anti-duplicado). Si el envío falla, el jugador YA está creado: NO abortamos
  // el alta; registramos y lo dejamos invitable para reintento desde la ficha.
  if (user) {
    const invite = await sendOrRenewTutorInvitation(supabase, locale, {
      playerId: created.id,
      clubId,
      email: invite_email,
      relation: player_relation,
      createdBy: user.id,
    });
    if ('error' in invite) {
      Sentry.captureException(
        new Error('auto-invite failed on create player'),
        {
          tags: { feature: 'invitations', step: 'create_player_autoinvite' },
          extra: { player_id: created.id, reason: invite.error },
        },
      );
    }
  }

  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  return { success: true, playerId: created.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// updatePlayer (F2.2)
// ─────────────────────────────────────────────────────────────────────────────

export async function updatePlayer(
  playerId: string,
  _prev: PlayerFormState,
  formData: FormData
): Promise<PlayerFormState> {
  const parsed = parseUpdatePlayerData(formData);
  if (!parsed.success) {
    return { error: mapPlayerError(parsed.error.issues[0]?.message) };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('players')
    .update(parsed.data)
    .eq('id', playerId);

  if (error) {
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  return { success: true, playerId };
}

// F14-4 — updateMedicalNotes retirado: la médica salió de players a player_medical
// y solo la escribe el TUTOR (RLS + RPC del alta / mi-ficha). El staff no escribe.

// ─────────────────────────────────────────────────────────────────────────────
// Photo path actions (F2.2)
// ─────────────────────────────────────────────────────────────────────────────

export type PhotoActionResult =
  | { success: true }
  | { success: false; error: 'forbidden' | 'generic' };

export async function updatePlayerPhotoPath(
  playerId: string,
  path: string
): Promise<PhotoActionResult> {
  // Validación mínima del path: debe empezar por <playerId>/ para que el
  // path persistido no pueda apuntar a una carpeta de otro jugador.
  if (!path || !path.startsWith(`${playerId}/`) || path.length > 200) {
    return { success: false, error: 'forbidden' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // F14-3b — la foto solo la escribe el tutor vinculado. La RPC set_player_photo
  // (SECURITY DEFINER) valida `user_is_tutor_of_player` y toca solo photo_url.
  const { error } = await supabase.rpc('set_player_photo', {
    p_player_id: playerId,
    p_path: path,
  });

  if (error) {
    const forbidden = (error.message ?? '').includes('forbidden');
    return { success: false, error: forbidden ? 'forbidden' : 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  return { success: true };
}

export async function clearPlayerPhotoPath(
  playerId: string
): Promise<PhotoActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // F14-3b — retirar la foto (path NULL) también es exclusivo del tutor.
  const { error } = await supabase.rpc('set_player_photo', {
    p_player_id: playerId,
    p_path: null,
  });

  if (error) {
    const forbidden = (error.message ?? '').includes('forbidden');
    return { success: false, error: forbidden ? 'forbidden' : 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Asignar/mover jugador a un equipo (F2.5)
// ─────────────────────────────────────────────────────────────────────────────

export type AssignToTeamState = {
  error?:
    | 'team_invalid'
    | 'dorsal_invalid'
    | 'position_invalid'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

export async function assignPlayerToTeam(
  playerId: string,
  _prev: AssignToTeamState,
  formData: FormData
): Promise<AssignToTeamState> {
  const parsed = assignPlayerToTeamSchema.safeParse({
    team_id: formData.get('team_id'),
    dorsal_in_team: formData.get('dorsal_in_team'),
    position_in_team: formData.get('position_in_team'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (
      code === 'team_invalid' ||
      code === 'dorsal_invalid' ||
      code === 'position_invalid'
    ) {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const today = new Date().toISOString().slice(0, 10);

  // Cerrar el team_member activo (cualquier equipo) con left_at = today.
  // Si no había activo, no-op.
  const { error: closeErr } = await supabase
    .from('team_members')
    .update({ left_at: today })
    .eq('player_id', playerId)
    .is('left_at', null);

  if (closeErr) {
    if (closeErr.code === '42501') return { error: 'forbidden' };
    return { error: 'generic' };
  }

  // Insertar nuevo. El índice parcial UNIQUE (player_id, team_id) WHERE left_at
  // IS NULL ya garantiza que no haya duplicados activos.
  const { error: insErr } = await supabase.from('team_members').insert({
    player_id: playerId,
    team_id: parsed.data.team_id,
    joined_at: today,
    dorsal_in_team: parsed.data.dorsal_in_team,
    position_in_team: parsed.data.position_in_team,
  });

  if (insErr) {
    if (insErr.code === '42501') return { error: 'forbidden' };
    if (insErr.code === '23505') {
      // Ya estaba activo en ese equipo (raro: el cierre anterior debería
      // haberlo desactivado). Devolvemos success para que el caller no rompa.
      revalidatePath(
        `/[locale]/(authenticated)/jugadores/${playerId}`,
        'page'
      );
      revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
      return { success: true };
    }
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  // F2.10: el listado global también muestra la pertenencia activa al equipo,
  // así que se invalida tras cada movimiento individual desde la tabla.
  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitar tutor para un jugador (F2.4)
// ─────────────────────────────────────────────────────────────────────────────

export type InviteTutorState = {
  error?:
    | 'email_invalid'
    | 'email_too_long'
    | 'relation_invalid'
    | 'forbidden'
    | 'generic';
  ok?: { email: string };
};

export async function inviteTutorForPlayer(
  locale: string,
  playerId: string,
  _prev: InviteTutorState,
  formData: FormData
): Promise<InviteTutorState> {
  const parsed = invitePlayerTutorSchema.safeParse({
    email: formData.get('email'),
    relation: formData.get('relation'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'email_invalid' || code === 'email_too_long') {
      return { error: code };
    }
    if (code === 'relation_invalid') return { error: 'relation_invalid' };
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // Cargar club del jugador (la RLS rechazará si el user no pertenece).
  const { data: player } = await supabase
    .from('players')
    .select('id, club_id')
    .eq('id', playerId)
    .maybeSingle();
  if (!player) return { error: 'forbidden' };

  // Circuito único (con anti-duplicado): si ya hay una invitación vigente para
  // este jugador, la renueva y reenvía; si no, la crea. La RLS de `invitations`
  // (INSERT admin/director; UPDATE admin_club) impone el permiso → 'forbidden'.
  const result = await sendOrRenewTutorInvitation(supabase, locale, {
    playerId: player.id,
    clubId: player.club_id,
    email: parsed.data.email,
    relation: parsed.data.relation,
    createdBy: user.id,
  });
  if ('error' in result) return { error: result.error };

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  return { ok: result.ok };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitar SEGUIDOR/espectador para un jugador (F14C-2)
// ─────────────────────────────────────────────────────────────────────────────

export type InviteSpectatorState = {
  error?: 'email_invalid' | 'email_too_long' | 'forbidden' | 'generic';
  ok?: { email: string };
};

/**
 * F14C-2 — El tutor del jugador o el propio jugador (self) invitan a un SEGUIDOR
 * (abuelo/familiar) por email. El gate (tutor/self) lo impone el RPC
 * `invite_spectator` (SECURITY DEFINER); aquí solo mapeamos el error y enviamos el
 * email reutilizando la maquinaria de invitaciones (inviteUserByEmail con
 * invitation_id, patrón inviteTutorForPlayer). El seguidor NO obtiene membership ni
 * player_account: el accept crea SOLO player_spectators.
 */
export async function inviteSpectatorForPlayer(
  locale: string,
  playerId: string,
  _prev: InviteSpectatorState,
  formData: FormData
): Promise<InviteSpectatorState> {
  const parsed = inviteSpectatorSchema.safeParse({
    email: formData.get('email'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'email_invalid' || code === 'email_too_long') {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // Crear la invitación de seguidor vía RPC: el gate tutor/self vive ahí.
  const { data: invite, error: rpcErr } = await supabase
    .rpc('invite_spectator', {
      p_player_id: playerId,
      p_email: parsed.data.email,
    })
    .single();

  if (rpcErr) {
    const msg = rpcErr.message?.toLowerCase() ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('invalid_email')) return { error: 'email_invalid' };
    Sentry.captureException(rpcErr, {
      tags: { feature: 'invitations', step: 'invite_spectator' },
      extra: { player_id: playerId },
    });
    return { error: 'generic' };
  }
  if (!invite) return { error: 'generic' };

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const redirectTo = `${proto}://${host}/${locale}/invite/${invite.token}`;

  const admin = createSupabaseAdminClient();
  try {
    const { error: invErr } = await admin.auth.admin.inviteUserByEmail(
      parsed.data.email,
      {
        redirectTo,
        data: { invite_pending: true, invitation_id: invite.id },
      }
    );

    if (invErr) {
      const msg = invErr.message?.toLowerCase() ?? '';
      const alreadyExists =
        ('code' in invErr && invErr.code === 'email_exists') ||
        msg.includes('already been registered') ||
        msg.includes('already exists');

      if (alreadyExists) {
        const { error: resetErr } =
          await supabase.auth.resetPasswordForEmail(parsed.data.email, {
            redirectTo,
          });
        if (resetErr) {
          Sentry.captureException(resetErr, {
            tags: { feature: 'invitations', step: 'reset_fallback_spectator' },
            extra: { invitation_id: invite.id },
          });
          return { error: 'generic' };
        }
      } else {
        Sentry.captureException(invErr, {
          tags: { feature: 'invitations', step: 'inviteUserByEmail_spectator' },
          extra: { invitation_id: invite.id },
        });
        return { error: 'generic' };
      }
    }
  } catch (thrown) {
    Sentry.captureException(thrown, {
      tags: { feature: 'invitations', step: 'inviteUserByEmail_spectator_thrown' },
      extra: { invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  return { ok: { email: parsed.data.email } };
}

export type RemoveSpectatorState = {
  error?: 'forbidden' | 'generic';
  ok?: true;
};

/**
 * F14C-5 — Revoca (elimina) a un seguidor de un jugador. Envuelve el RPC
 * `remove_spectator` (SECURITY DEFINER), cuyo gate (tutor del jugador O el propio
 * jugador self) es la autoridad real; aquí solo mapeamos el error y revalidamos.
 * Al borrar la fila de player_spectators, el seguidor pierde su acceso deportivo
 * a ese jugador (F14C-3).
 */
export async function removeSpectatorForPlayer(
  playerId: string,
  spectatorProfileId: string
): Promise<RemoveSpectatorState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  const { error } = await supabase.rpc('remove_spectator', {
    p_player_id: playerId,
    p_spectator_profile_id: spectatorProfileId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('forbidden') || msg.includes('no_session')) {
      return { error: 'forbidden' };
    }
    Sentry.captureException(error, {
      tags: { feature: 'invitations', step: 'remove_spectator' },
      extra: { player_id: playerId },
    });
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/mi-ficha/seguidores', 'page');
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rework C (C11a) — baja / reactivar de jugador (no destructivo)
// ─────────────────────────────────────────────────────────────────────────────

export type LeftClubState = {
  ok?: { active: boolean };
  error?: 'no_active_club' | 'player_invalid' | 'forbidden' | 'generic';
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Da de baja o reactiva a un jugador (Rework C · C11a). No destructivo: solo
 * fija/limpia `players.left_club_at` (+ razón); jamás toca team_members/stats/
 * eventos. Delega en la función SQL `set_player_left_club` (SECURITY DEFINER,
 * solo admin_club, idempotente, reversible).
 *
 * - reactivate=true → reactivar (left_club_at = NULL).
 * - reactivate=false → baja con `leftAt` (default hoy) + `reason` opcional.
 */
export async function setPlayerLeftClub(
  playerId: string,
  opts: { reactivate: boolean; leftAt?: string; reason?: string },
): Promise<LeftClubState> {
  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  let leftAt: string | null;
  if (opts.reactivate) {
    leftAt = null;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    leftAt = opts.leftAt && DATE_ONLY_RE.test(opts.leftAt) ? opts.leftAt : today;
  }
  const reason =
    opts.reactivate || !opts.reason || opts.reason.trim().length === 0
      ? null
      : opts.reason.trim().slice(0, 500);

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // El typegen de Supabase no expresa args nullables, pero la función SQL acepta
  // NULL: p_left_at NULL = reactivar; p_reason NULL = sin razón.
  const { error } = await supabase.rpc('set_player_left_club', {
    p_club_id: clubId,
    p_player_id: playerId,
    p_left_at: leftAt as unknown as string,
    p_reason: reason as unknown as string,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('player_invalid')) return { error: 'player_invalid' };
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
  return { ok: { active: opts.reactivate } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitar EN LOTE a los jugadores pendientes (F14K-2)
// ─────────────────────────────────────────────────────────────────────────────

/** Tope de EMAILS distintos por lote. Por debajo del 100/h de Supabase y del
 *  100/día de Resend gratis; superarlo obliga a Jose a dividir la selección. */
const MAX_BATCH_EMAILS = 100;

export type BatchInviteRow = {
  player_id: string;
  email: string;
  status: 'sent' | 'error';
  /** Motivo cuando status='error' (forbidden | insert_failed | send_failed). */
  reason?: string;
};

export type BatchInviteResult = {
  error?: 'forbidden' | 'too_many_emails' | 'generic';
  /** Nº de EMAILS distintos del lote (la medida del tope, no jugadores). */
  count_emails: number;
  /** Tope aplicado (100). */
  limit: number;
  /** Nº de emails (grupos) enviados OK. */
  sent_emails: number;
  /** Jugadores pedidos (botón 1) que YA no cumplen el criterio → no se invitan. */
  skipped: { player_id: string }[];
  /** Reporte por jugador. */
  rows: BatchInviteRow[];
};

/**
 * F14K-2 — Motor de envío en lote. Invita a los jugadores PENDIENTES del club,
 * agrupando por email (un solo email por padre, N filas de invitación por hijos).
 *
 * Reglas (K-2):
 *  · Recalcula los pendientes con loadPendingInvitePlayers (NO se fía de la lista
 *    del cliente): sin cuenta, sin invitación pendiente vigente, erased_at null.
 *  · Agrupa por email (summarizePendingInvites, vía loadPendingInvitePlayers).
 *    player_relation='parent' en cada fila.
 *  · Tope de 100 EMAILS distintos: si se supera, NO envía nada → 'too_many_emails'
 *    con el número, para que la UI (K-3) obligue a reducir. No trocea solo.
 *  · Idempotencia: la query ya excluye a los que tienen invitación pendiente
 *    vigente ("comprobar antes"); un doble-clic simultáneo, en el peor caso, crea
 *    una invitación duplicada que accept_pending_invitations absorbe (player_accounts
 *    tiene on conflict do nothing).
 *  · Un inviteUserByEmail que falle NO tumba el lote: se registra en su fila y se
 *    sigue. Además, si el envío de un grupo falla, se BORRAN sus invitaciones recién
 *    insertadas para que el grupo vuelva a estar pendiente y sea reintentable (si no,
 *    quedarían "pendientes vigentes" bloqueando el reintento 7 días).
 *
 * Permiso: admin_club o director (coordinador NO). La RLS de invitations reimpone
 * el gate en el insert.
 */
export async function inviteBatch(
  locale: string,
  clubId: string,
  playerIds?: string[],
): Promise<BatchInviteResult> {
  const base = (error?: BatchInviteResult['error']): BatchInviteResult => ({
    error,
    count_emails: 0,
    limit: MAX_BATCH_EMAILS,
    sent_emails: 0,
    skipped: [],
    rows: [],
  });

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return base('forbidden');

  // Rol del caller EN ESTE club (y, de paso, que sea miembro). Solo admin/director.
  const clubs = await getCurrentUserClubs(adapter);
  const role = clubs.find((c) => c.club.id === clubId)?.role;
  if (role !== 'admin_club' && role !== 'director') {
    return base('forbidden');
  }

  // Recalcula pendientes server-side (autoridad; ignora cualquier lista sin revalidar).
  const pending = await loadPendingInvitePlayers(
    clubId,
    role,
    playerIds ? { playerIds } : {},
  );

  // skipped: pedidos (botón 1) que ya no son pendientes (con cuenta / ya invitados /
  // sin email / suprimidos). Solo tiene sentido cuando se pasó una lista explícita.
  const skipped = playerIds
    ? (() => {
        const stillPending = new Set(pending.players.map((p) => p.player_id));
        return playerIds
          .filter((id) => !stillPending.has(id))
          .map((id) => ({ player_id: id }));
      })()
    : [];

  // Tope de 100 EMAILS distintos: NO envía nada si se supera (Jose divide a mano).
  if (pending.count_emails > MAX_BATCH_EMAILS) {
    return {
      error: 'too_many_emails',
      count_emails: pending.count_emails,
      limit: MAX_BATCH_EMAILS,
      sent_emails: 0,
      skipped,
      rows: [],
    };
  }

  if (pending.count_emails === 0) {
    return { ...base(), skipped };
  }

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  const admin = createSupabaseAdminClient();

  const rows: BatchInviteRow[] = [];
  let sentEmails = 0;

  for (const group of pending.emails) {
    // 1) Una invitación por jugador del grupo (relation='parent'). token y
    //    expires_at (now()+7d) los pone el default de la tabla.
    const inserted: { player_id: string; id: string; token: string }[] = [];

    for (const playerId of group.player_ids) {
      const { data: inv, error: insErr } = await supabase
        .from('invitations')
        .insert({
          email: group.email,
          role: 'jugador',
          club_id: clubId,
          player_id: playerId,
          player_relation: 'parent',
          created_by: user.id,
        })
        .select('id, token')
        .single();

      if (insErr || !inv) {
        const reason = insErr?.code === '42501' ? 'forbidden' : 'insert_failed';
        rows.push({ player_id: playerId, email: group.email, status: 'error', reason });
        if (insErr?.code !== '42501') {
          Sentry.captureException(insErr ?? new Error('insert returned null'), {
            tags: { feature: 'invitations', step: 'batch_invite' },
            extra: { club_id: clubId, player_id: playerId },
          });
        }
        continue;
      }
      inserted.push({ player_id: playerId, id: inv.id as string, token: inv.token as string });
    }

    // Si ningún insert del grupo salió, no hay email que enviar.
    if (inserted.length === 0) continue;

    // 2) UN solo email por grupo, con la primera invitación como ancla (accept
    //    aceptará todas las pendientes de ese email en el club de un clic).
    const anchor = inserted[0]!;
    const redirectTo = `${proto}://${host}/${locale}/invite/${anchor.token}`;
    let sendReason: string | null = null;

    try {
      const { error: invErr } = await admin.auth.admin.inviteUserByEmail(group.email, {
        redirectTo,
        data: { invite_pending: true, invitation_id: anchor.id },
      });
      if (invErr) {
        const msg = invErr.message?.toLowerCase() ?? '';
        const alreadyExists =
          ('code' in invErr && invErr.code === 'email_exists') ||
          msg.includes('already been registered') ||
          msg.includes('already exists');
        if (alreadyExists) {
          // Email ya registrado → mismo redirectTo vía reset (patrón de inviteTutorForPlayer).
          const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
            group.email,
            { redirectTo },
          );
          if (resetErr) {
            sendReason = 'send_failed';
            Sentry.captureException(resetErr, {
              tags: { feature: 'invitations', step: 'batch_invite' },
              extra: { club_id: clubId, invitation_id: anchor.id },
            });
          }
        } else {
          sendReason = 'send_failed';
          Sentry.captureException(invErr, {
            tags: { feature: 'invitations', step: 'batch_invite' },
            extra: { club_id: clubId, invitation_id: anchor.id },
          });
        }
      }
    } catch (thrown) {
      sendReason = 'send_failed';
      Sentry.captureException(thrown, {
        tags: { feature: 'invitations', step: 'batch_invite' },
        extra: { club_id: clubId, invitation_id: anchor.id },
      });
    }

    if (sendReason) {
      // El envío falló: borra las invitaciones recién creadas del grupo para que
      // vuelva a estar pendiente y reintentable (si no, K-1 lo ocultaría 7 días).
      const { error: delErr } = await admin
        .from('invitations')
        .delete()
        .in('id', inserted.map((r) => r.id));
      if (delErr) {
        Sentry.captureException(delErr, {
          tags: { feature: 'invitations', step: 'batch_invite' },
          extra: { club_id: clubId, invitation_id: anchor.id },
        });
      }
      for (const r of inserted) {
        rows.push({ player_id: r.player_id, email: group.email, status: 'error', reason: sendReason });
      }
    } else {
      sentEmails++;
      for (const r of inserted) {
        rows.push({ player_id: r.player_id, email: group.email, status: 'sent' });
      }
    }
  }

  revalidatePath('/[locale]/(authenticated)/jugadores', 'page');

  return {
    count_emails: pending.count_emails,
    limit: MAX_BATCH_EMAILS,
    sent_emails: sentEmails,
    skipped,
    rows,
  };
}
