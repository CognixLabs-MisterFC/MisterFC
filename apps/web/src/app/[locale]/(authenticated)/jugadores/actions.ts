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
  resolveActiveClub,
  updatePlayerSchema,
  updateMedicalNotesSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

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
  ];
  if (message && known.includes(message as PlayerFormError)) {
    return message as PlayerFormError;
  }
  return 'generic';
}

// ─────────────────────────────────────────────────────────────────────────────
// createPlayer (F2.3)
// ─────────────────────────────────────────────────────────────────────────────

export async function createPlayer(
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

  const { team_id, positions_secondary, ...playerFields } = parsed.data;

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
  };

  const { data: created, error } = await supabase
    .from('players')
    .insert(insertPayload)
    .select('id')
    .single();

  if (error || !created) {
    return { error: 'generic' };
  }

  if (team_id) {
    // Asignar al equipo. Si falla, no abortamos el alta — el jugador queda
    // creado sin equipo y el caller puede asignar después desde la ficha.
    await supabase.from('team_members').insert({
      player_id: created.id,
      team_id,
    });
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

// ─────────────────────────────────────────────────────────────────────────────
// updateMedicalNotes (F2.2) — visibilidad: helper SQL la enforza vía RPC
// ─────────────────────────────────────────────────────────────────────────────

export type MedicalNotesState = {
  error?:
    | 'medical_notes_too_long'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

export async function updateMedicalNotes(
  playerId: string,
  _prev: MedicalNotesState,
  formData: FormData
): Promise<MedicalNotesState> {
  const parsed = updateMedicalNotesSchema.safeParse({
    medical_notes: formData.get('medical_notes'),
  });
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message;
    if (msg === 'medical_notes_too_long') return { error: msg };
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Pre-check de autoridad. RLS de UPDATE en players ya filtra por staff;
  // este check adicional sirve para devolver `forbidden` con mensaje claro
  // si un staff sin can_see_medical intenta editar.
  const { data: canSee } = await supabase.rpc('user_can_see_player_medical', {
    p_player_id: playerId,
  });
  if (!canSee) return { error: 'forbidden' };

  const { error } = await supabase
    .from('players')
    .update({ medical_notes: parsed.data.medical_notes })
    .eq('id', playerId);

  if (error) {
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  return { success: true };
}

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

  const { error } = await supabase
    .from('players')
    .update({ photo_url: path })
    .eq('id', playerId);

  if (error) {
    return { success: false, error: 'generic' };
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

  const { error } = await supabase
    .from('players')
    .update({ photo_url: null })
    .eq('id', playerId);

  if (error) {
    return { success: false, error: 'generic' };
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

  // Insertar invitación. La policy `invitations_insert_admin` ya exige
  // admin/coord del club; si el actor no lo es, devuelve error y aquí lo
  // mapeamos a forbidden.
  const { data: invite, error: insErr } = await supabase
    .from('invitations')
    .insert({
      email: parsed.data.email,
      role: 'jugador',
      club_id: player.club_id,
      player_id: player.id,
      player_relation: parsed.data.relation,
      created_by: user.id,
    })
    .select('id, token')
    .single();

  if (insErr) {
    if (insErr.code === '42501') return { error: 'forbidden' };
    Sentry.captureException(insErr, {
      tags: { feature: 'invitations', step: 'insert_tutor' },
      extra: { player_id: player.id, relation: parsed.data.relation },
    });
    return { error: 'generic' };
  }
  if (!invite) return { error: 'generic' };

  const hdrs = await headers();
  const host = hdrs.get('x-forwarded-host') ?? hdrs.get('host') ?? '';
  const proto = hdrs.get('x-forwarded-proto') ?? 'https';
  // redirectTo directo a la página de invitación. Ver nota en
  // invitations/actions.ts para el porqué (allowlist Supabase).
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
        // Reusa resetPasswordForEmail como vehículo del mismo redirectTo
        // cuando el email ya está registrado (mismo patrón que sendInvitation).
        const { error: resetErr } =
          await supabase.auth.resetPasswordForEmail(parsed.data.email, {
            redirectTo,
          });
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
    }
  } catch (thrown) {
    Sentry.captureException(thrown, {
      tags: {
        feature: 'invitations',
        step: 'inviteUserByEmail_tutor_thrown',
      },
      extra: { invitation_id: invite.id },
    });
    return { error: 'generic' };
  }

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  return { ok: { email: parsed.data.email } };
}
