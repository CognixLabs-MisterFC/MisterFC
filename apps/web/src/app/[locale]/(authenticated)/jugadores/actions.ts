'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  assignPlayerToTeamSchema,
  createPlayerSchema,
  createSupabaseAdminClient,
  createSupabaseServerClient,
  getCurrentUserClubs,
  inviteEmailMetadata,
  isEmailAlreadyExistsError,
  invitePlayerTutorSchema,
  inviteSpectatorSchema,
  type PlayerTutorRelation,
  clearPlayerPhotoFromClient,
  removeSpectatorFromClient,
  resolveActiveClub,
  setPlayerPhotoPathFromClient,
  updatePlayerSchema,
  inviteLink,
  inviteLinkBase,
  pendingCoversEmail,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { linkInvitedUser } from '@/lib/link-invited-user';
import { performSpectatorInvite } from '@/lib/invite-spectator';
import { performSelfInvite } from '@/lib/invite-self';
import { sendOrRenewTutorInvitation } from '@/lib/invite-tutor';
import { invitationEmailPort, inviteRecipientPort } from '@/lib/email/invite-ports';
import { loadPendingInvitePlayers } from './queries';
import { pendingInvitationsForEmail } from '@/lib/pending-invitation';

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
    phone: formData.get('phone'),
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
  | 'phone_invalid'
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
  /**
   * BUG 3 · B-2 — el correo del tutor ya es de alguien del club. El jugador SÍ
   * se creó; lo que NO se hizo es mandar una invitación a quien ya está dentro.
   * La pantalla lo dice y ofrece vincularle el jugador.
   */
  existingMember?: {
    membershipId: string;
    fullName: string;
    clubRole: string;
    relation: 'parent' | 'guardian';
  };
  /**
   * El jugador se creó y su invitación TAMBIÉN, pero no salió correo: ese correo ya
   * tenía una invitación pendiente y su enlace cubre igualmente a este hijo. Hay que
   * decirlo: quien da de alta se queda esperando un correo que no va a llegar.
   */
  coveredByPending?: { email: string };
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
    'phone_invalid',
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

  // BUG 3 · B-2 — ¿el correo del tutor ya es de alguien de este club? Si lo es,
  // NO se le invita: mandarle un correo para entrar donde ya está es el absurdo
  // que abre esta serie. Se avisa y se ofrece vincularle el jugador.
  //
  // La pregunta NO se puede hacer con una consulta normal: `profiles` no guarda
  // el correo y `auth.users` no lo puede leer un cliente de la app. La contesta
  // `club_member_by_email` (mig 20261086000000), gateada al mismo conjunto que
  // puede crear jugadores.
  //
  // Si la RPC falla —permisos, red—, se sigue por el camino de siempre: invitar.
  // El alta no se queda a medias por un fallo del atajo.
  const { data: memberRows, error: memberErr } = await supabase.rpc(
    'club_member_by_email',
    { p_club_id: clubId, p_email: invite_email },
  );
  if (memberErr) {
    Sentry.captureException(memberErr, {
      tags: { feature: 'invitations', step: 'create_player_member_lookup' },
      extra: { player_id: created.id },
    });
  }
  const existing = memberErr ? null : (memberRows ?? [])[0];

  if (existing) {
    revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
    return {
      success: true,
      playerId: created.id,
      existingMember: {
        membershipId: existing.membership_id,
        fullName: existing.full_name ?? '—',
        clubRole: existing.role,
        relation: player_relation,
      },
    };
  }

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
    } else if (invite.ok.covered) {
      // La invitación de este hijo existe, pero el correo NO salió: el tutor ya
      // tenía una pendiente y su enlace cubre a los dos. Se devuelve para poder
      // decirlo — si no, quien acaba de dar de alta espera un correo que no llega.
      revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
      return {
        success: true,
        playerId: created.id,
        coveredByPending: { email: invite.ok.email },
      };
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

  // Si el formulario no traía el campo del teléfono (su lectura falló y no se
  // pintó), la clave se cae del UPDATE: `parsed.data.phone` valdría null y
  // borraría el número guardado. Un fallo de lectura no puede convertirse en un
  // borrado.
  const payload = { ...parsed.data };
  if (!formData.has('phone')) delete (payload as { phone?: string | null }).phone;

  // Sin `.select()` encadenado: pedir la fila de vuelta sería LEER `phone`, que
  // está cerrada, y el UPDATE entero fallaría con 42501.
  const { error } = await supabase.from('players').update(payload).eq('id', playerId);

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

// F14-3b — la foto solo la escribe el tutor vinculado. La RPC set_player_photo
// (SECURITY DEFINER) valida `user_is_tutor_of_player` y toca solo photo_url.
// O2-5 C2 — la validación del path + invocación + mapeo de error viven en core
// (`setPlayerPhotoPathFromClient` / `clearPlayerPhotoFromClient`); aquí solo se revalida.
export async function updatePlayerPhotoPath(
  playerId: string,
  path: string
): Promise<PhotoActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await setPlayerPhotoPathFromClient(supabase, playerId, path);
  if ('ok' in res) {
    revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
    revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
    return { success: true };
  }
  return { success: false, error: res.error };
}

export async function clearPlayerPhotoPath(
  playerId: string
): Promise<PhotoActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await clearPlayerPhotoFromClient(supabase, playerId);
  if ('ok' in res) {
    revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
    revalidatePath('/[locale]/(authenticated)/jugadores', 'page');
    return { success: true };
  }
  return { success: false, error: res.error };
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
  ok?: {
    email: string;
    /** No salió correo: ese correo ya tenía una invitación pendiente que lo cubre. */
    covered: boolean;
  };
  /**
   * BUG 3 · B-2 (hueco hermano de #646) — el correo ya es de alguien del club:
   * NO se ha invitado a nadie. El diálogo lo dice y ofrece el vínculo directo.
   */
  existingMember?: {
    membershipId: string;
    fullName: string;
    clubRole: string;
    relation: PlayerTutorRelation;
  };
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

  // BUG 3 · B-2 — antes de invitar preguntamos si ese correo ya es de alguien
  // del club. Si lo es, la invitación no sirve de nada: esa persona ya tiene
  // cuenta, y el correo que recibiría la manda a crear otra. Se avisa y se
  // ofrece vincularla a la ficha, igual que hace el alta de jugador (#646).
  //
  // La pregunta no se puede hacer con una consulta normal: `profiles` no guarda
  // el correo y `auth.users` no lo puede leer un cliente de la app. La contesta
  // `club_member_by_email` (mig 20261086000000), gateada a cuerpo técnico.
  //
  // Si la RPC falla —permisos, red—, se sigue por el camino de siempre: se
  // invita. El botón no se queda muerto por un fallo del atajo.
  const { data: memberRows, error: memberErr } = await supabase.rpc(
    'club_member_by_email',
    { p_club_id: player.club_id as string, p_email: parsed.data.email }
  );
  if (memberErr) {
    Sentry.captureException(memberErr, {
      tags: { feature: 'invitations', step: 'invite_tutor_member_lookup' },
      extra: { player_id: player.id },
    });
  }
  const existing = memberErr ? null : (memberRows ?? [])[0];
  if (existing) {
    return {
      existingMember: {
        membershipId: existing.membership_id,
        fullName: existing.full_name ?? '—',
        clubRole: existing.role,
        relation: parsed.data.relation,
      },
    };
  }

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
 * `invite_spectator` (SECURITY DEFINER); aquí solo mapeamos el error y delegamos en
 * `performSpectatorInvite` (core), que desde Correo-B1 crea la cuenta con
 * `createUser` y manda el correo por Resend, en el idioma del destinatario. El
 * seguidor NO obtiene membership ni player_account: el accept crea SOLO
 * player_spectators.
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

  // El enlace sale SIEMPRE de misterfc.es, no del host de la peticion: es el unico
  // dominio con assetlinks.json y AASA, y el unico que la app acepta. Ver WEB_ORIGIN.
  const linkBase = inviteLinkBase(locale);

  // Lógica compartida con el route handler nativo (O2-5 F2): RPC como el usuario
  // (gate tutor/self antes de crear) + email con admin DESPUÉS + fallback
  // email-ya-existe. El flag `existing` no aplica en web → se ignora (comportamiento
  // idéntico: ambos caminos son éxito).
  const admin = createSupabaseAdminClient();
  const res = await performSpectatorInvite(supabase, admin, {
    playerId,
    email: parsed.data.email,
    linkBase,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath(`/[locale]/(authenticated)/jugadores/${playerId}`, 'page');
  return { ok: { email: res.ok.email } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Invitar al PROPIO JUGADOR a tener cuenta (MN-5)
// ─────────────────────────────────────────────────────────────────────────────

export type InviteSelfState = {
  error?:
    | 'email_invalid'
    | 'email_too_long'
    | 'forbidden'
    | 'erased'
    | 'already_linked'
    | 'email_relation_conflict'
    | 'consents_required'
    | 'no_active_season'
    | 'generic';
  ok?: { email: string };
};

/**
 * MN-5 — El TUTOR invita a su hijo a tener su propia cuenta. Esa invitación ES la
 * autorización (decisión 1 de Jose), y por eso solo puede cursarla quien ya es
 * tutor del jugador: el gate lo impone la RPC `invite_player_self` (SECURITY
 * DEFINER), no esta pantalla.
 *
 * La RELACIÓN no viaja desde el cliente. El formulario manda solo el email; la RPC
 * escribe `player_relation='self'`. Es lo que impide que esta acción se convierta
 * en otra puerta para el agujero de `invite_email`.
 */
export async function inviteSelfForPlayer(
  locale: string,
  playerId: string,
  _prev: InviteSelfState,
  formData: FormData
): Promise<InviteSelfState> {
  const parsed = inviteSpectatorSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'email_invalid' || code === 'email_too_long') return { error: code };
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: 'forbidden' };

  // El enlace sale SIEMPRE de misterfc.es, no del host de la peticion: es el unico
  // dominio con assetlinks.json y AASA, y el unico que la app acepta. Ver WEB_ORIGIN.
  const linkBase = inviteLinkBase(locale);

  const admin = createSupabaseAdminClient();
  const res = await performSelfInvite(supabase, admin, {
    playerId,
    email: parsed.data.email,
    linkBase,
    locale,
  });
  if ('error' in res) return { error: res.error };

  revalidatePath('/[locale]/(authenticated)/perfil', 'page');
  return { ok: { email: res.ok.email } };
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

  // La lógica (auth + RPC remove_spectator + mapeo de error) vive en core; aquí
  // solo se registra en Sentry el error crudo y se revalida (server-only).
  const res = await removeSpectatorFromClient(
    supabase,
    playerId,
    spectatorProfileId
  );

  if ('error' in res) {
    if (res.error === 'forbidden') return { error: 'forbidden' };
    Sentry.captureException(res.raw, {
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
  /**
   * `linked`  = ese correo ya era de alguien del club: no se le invitó, se le
   *             vinculó el jugador.
   * `covered` = ese correo ya tenía una invitación pendiente: la invitación de
   *             este hijo SÍ se creó, pero no salió un segundo correo. El enlace
   *             que el padre ya tiene cubre a los dos.
   * Las dos son la misma regla: un correo pertenece a UNA familia y se le escribe
   * UNA vez.
   */
  status: 'sent' | 'linked' | 'covered' | 'error';
  /**
   * Motivo cuando status='error':
   *   forbidden | insert_failed | send_failed | link_failed | member_link_failed
   * `link_failed` es «el correo salió pero no se pudo enlazar la cuenta»;
   * `member_link_failed` es «ya estaba en el club y no se pudo vincular la ficha».
   */
  reason?: string;
  /** Nombre de la persona a la que se vinculó (solo con status='linked'). */
  linked_to?: string;
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
 *  · Un correo que falle NO tumba el lote: se registra en su fila y se sigue.
 *    Además, si el envío de un grupo falla, se BORRAN sus invitaciones recién
 *    insertadas para que el grupo vuelva a estar pendiente y sea reintentable (si no,
 *    quedarían "pendientes vigentes" bloqueando el reintento 7 días).
 *  · Correo-B6 — el correo sale por Resend, EN EL IDIOMA DEL PADRE (su perfil si lo
 *    tiene, el de quien importa si no). Antes lo mandaba GoTrue con la plantilla
 *    única del dashboard, que no puede leer `profiles.locale`: una importación de 80
 *    familias salía entera en castellano.
 *  · Enlazado invited_user_id: cuando la cuenta es NUESTRA, se enlaza su id en
 *    TODAS las filas del grupo (un padre con N hijos = N invitaciones, una cuenta),
 *    con el guard de #540. Si el enlazado falla la fila va a error 'link_failed' PERO
 *    NO se borra: el email ya salió y borrar dejaría muerto su enlace; el invitado
 *    completa igual vía el cinturón #539 (invite_pending en user_metadata).
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

  const admin = createSupabaseAdminClient();

  const rows: BatchInviteRow[] = [];
  let sentEmails = 0;

  for (const group of pending.emails) {
    // 0) ¿Ese correo ya es de alguien de ESTE club? Un correo pertenece a UNA
    //    familia: si ya está dentro, no se le invita —mandarle un correo para
    //    entrar donde ya está es el absurdo que abrió esta serie— y se le vincula
    //    el hijo directamente.
    //
    //    Es la cuarta puerta del mismo guard: `createPlayer` (#646), el botón de la
    //    ficha (#647) y `/invitations` (#648) ya lo hacían; la importación se quedó
    //    fuera, y es justo la que invita de 100 en 100. El correo del 22-09-2026 a
    //    la dirección del propio `admin_club` del club salió por aquí.
    //
    //    A diferencia de las otras tres, aquí NO se pregunta y se ofrece: se vincula
    //    y se sigue. Un lote no puede pararse a hacer una pregunta por familia.
    //
    //    Si la RPC falla —permisos, red—, se sigue por el camino de siempre e
    //    invita: el lote no se queda a medias por un fallo del atajo.
    const { data: memberRows, error: memberErr } = await supabase.rpc(
      'club_member_by_email',
      { p_club_id: clubId, p_email: group.email },
    );
    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { feature: 'invitations', step: 'batch_member_lookup' },
        extra: { club_id: clubId },
      });
    }
    const member = memberErr ? null : (memberRows ?? [])[0];

    if (member) {
      // Vínculo directo, un jugador a la vez: el `player_accounts` de cada hijo con
      // el perfil que ya está en el club. `relation: 'parent'`, el mismo valor que
      // llevaría la invitación que NO se manda.
      for (const playerId of group.player_ids) {
        const { error: linkErr } = await supabase.from('player_accounts').insert({
          player_id: playerId,
          profile_id: member.profile_id,
          relation: 'parent',
        });
        if (linkErr && linkErr.code !== '23505') {
          // 23505 = UNIQUE (player_id, profile_id): ya estaban vinculados. Eso es el
          // resultado que buscábamos, no un error.
          const reason = linkErr.code === '42501' ? 'forbidden' : 'member_link_failed';
          rows.push({ player_id: playerId, email: group.email, status: 'error', reason });
          if (linkErr.code !== '42501') {
            Sentry.captureException(linkErr, {
              tags: { feature: 'invitations', step: 'batch_link_member' },
              extra: { club_id: clubId, player_id: playerId },
            });
          }
          continue;
        }
        rows.push({
          player_id: playerId,
          email: group.email,
          status: 'linked',
          linked_to: member.full_name ?? undefined,
        });
      }
      // Ni invitación ni correo para esta familia.
      continue;
    }

    // 0b) ¿Y ya tiene una invitación pendiente? Se pregunta ANTES de insertar, para
    //     que la respuesta no incluya las filas que este lote está a punto de crear.
    //     Decide SOLO si sale correo: las invitaciones de estos hijos se crean igual,
    //     porque son las que los meten en el lote que `accept_pending_invitations`
    //     procesa cuando el padre entre por el enlace que ya recibió.
    const pendingForEmail = await pendingInvitationsForEmail(
      supabase,
      clubId,
      group.email,
      'batch_pending_lookup',
    );
    const covered = pendingCoversEmail(pendingForEmail);

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

    // 2) UN solo correo por grupo, con la primera invitación como ancla (el accept
    //    aceptará todas las pendientes de ese email en el club de un clic).
    //
    //    Correo-B6 — antes esto era UNA llamada, `inviteUserByEmail`, que creaba la
    //    cuenta Y mandaba el correo con la plantilla del dashboard de Supabase.
    //    Ahora son tres pasos, y el orden ES la garantía: buscar al destinatario →
    //    cuenta y ENLAZADO → correo al final. Con el correo en medio, un enlazado que
    //    fallara dejaría al padre con un enlace que le pide una contraseña que nunca
    //    fijó.
    const anchor = inserted[0]!;
    const redirectTo = inviteLink(locale, anchor.token);
    let sendReason: string | null = null;
    // Cuenta NUESTRA: la que creamos ahora o la que creamos en un lote anterior y
    // nadie reclamó. Solo esas se enlazan. La cuenta propia de un padre que ya usa
    // la app NO se toca: inicia sesión con su contraseña.
    let ownAccount = false;
    let invitedUserId: string | null = null;

    let found: Awaited<ReturnType<ReturnType<typeof inviteRecipientPort>>> = null;
    try {
      found = await inviteRecipientPort(admin)(group.email);
    } catch (thrown) {
      // La búsqueda no tumba el grupo: se sigue por el camino de "no tiene cuenta",
      // que es el normal, y `createUser` dirá la verdad después.
      Sentry.captureException(thrown, {
        tags: { feature: 'invitations', step: 'batch_lookup_recipient' },
        extra: { club_id: clubId, invitation_id: anchor.id },
      });
    }
    // El idioma del padre si tiene perfil; si no, el de quien lanza la importación.
    const emailLocale = found?.locale ?? locale;

    try {
      if (found && !found.invitePending) {
        // Cuenta suya de verdad: ni se toca ni se enlaza.
      } else if (found && found.invitePending) {
        // Cuenta de una invitación anterior que nadie reclamó. Se enlaza ÉSA: sin
        // esto, reimportar a la misma familia la deja pidiendo una contraseña que no
        // existe (la trampa de agosto de 2026).
        ownAccount = true;
        invitedUserId = found.userId;
      } else {
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email: group.email,
          // Su correo ES su prueba. Sin esto GoTrue le niega el login al fijar la
          // contraseña en /invite (BUG-4).
          email_confirm: true,
          // La importación crea invitaciones de FAMILIA: el mismo texto que la ficha
          // del jugador, no el de cuerpo técnico.
          user_metadata: inviteEmailMetadata({
            invitationId: anchor.id,
            kind: 'tutor',
            locale: emailLocale,
          }),
        });

        if (createErr) {
          if (isEmailAlreadyExistsError(createErr)) {
            // Carrera con la búsqueda de arriba. La cuenta es suya: no se enlaza y el
            // correo sale igual.
            Sentry.captureMessage('[invitations] createUser: el correo ya tenía cuenta (batch)', {
              level: 'warning',
              tags: { feature: 'invitations', step: 'batch_create_race' },
              extra: { club_id: clubId, invitation_id: anchor.id },
            });
          } else {
            sendReason = 'send_failed';
            Sentry.captureException(createErr, {
              tags: { feature: 'invitations', step: 'batch_invite' },
              extra: { club_id: clubId, invitation_id: anchor.id },
            });
          }
        } else {
          ownAccount = true;
          invitedUserId = created?.user?.id ?? null;
        }
      }
    } catch (thrown) {
      sendReason = 'send_failed';
      Sentry.captureException(thrown, {
        tags: { feature: 'invitations', step: 'batch_invite' },
        extra: { club_id: clubId, invitation_id: anchor.id },
      });
    }

    // 3) ENLAZADO, antes del correo. Un padre con N hijos = N invitaciones y UNA
    //    cuenta: se enlazan todas. Los que no se puedan enlazar van a 'link_failed'
    //    pero NO se borran: el correo sale igual y el invitado completa por el
    //    cinturón (#539, invite_pending en user_metadata).
    const linkFailed = new Set<string>();
    if (!sendReason && ownAccount) {
      if (!invitedUserId) {
        // #535: creación OK pero sin user.id → antes MUDO.
        Sentry.captureMessage('[invitations] createUser sin user.id (batch)', {
          level: 'error',
          tags: { feature: 'invitations', step: 'batch_invite_missing_id' },
          extra: { club_id: clubId, invitation_id: anchor.id },
        });
        for (const r of inserted) linkFailed.add(r.player_id);
      } else {
        for (const r of inserted) {
          // Enlaza y EXIGE 1 fila afectada (guard #540): un UPDATE de cero filas no da
          // error en PostgREST y dejaría invited_user_id NULL en silencio.
          const linkRes = await linkInvitedUser(admin, r.id, invitedUserId, {
            feature: 'invitations',
            step: 'batch_invite_link',
          });
          if (!linkRes.ok) linkFailed.add(r.player_id);
        }
      }
    }

    // 4) El correo, LO ÚLTIMO, en el idioma del destinatario — y solo si toca.
    //    A una persona se le escribe UNA vez: si ya tenía una invitación pendiente,
    //    su enlace procesa también estos hijos al aceptarlo.
    if (!sendReason && !covered) {
      const { error: mailErr } = await invitationEmailPort('tutor')({
        to: group.email,
        url: redirectTo,
        locale: emailLocale,
      });
      if (mailErr) {
        sendReason = 'send_failed';
        Sentry.captureException(mailErr, {
          tags: { feature: 'invitations', step: 'batch_send_email' },
          extra: { club_id: clubId, invitation_id: anchor.id },
        });
      }
    }

    if (sendReason) {
      // El correo no salió: borra las invitaciones recién creadas del grupo para que
      // vuelva a estar pendiente y reintentable (si no, K-1 lo ocultaría 7 días).
      //
      // La CUENTA que se acabara de crear NO se borra, y es a propósito: al
      // reintentar, la búsqueda la encuentra sin reclamar y enlaza la invitación
      // nueva a ella. Borrarla sería destruir una cuenta ajena por un fallo de
      // correo. Lo único que queda rancio es el `invitation_id` de su
      // `user_metadata`, que apunta a una fila borrada y ya no lo lee nadie: el
      // enrutado de /invite mira `invite_pending` y `invited_user_id`.
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
    } else if (covered) {
      // Invitaciones creadas y enlazadas, sin correo nuevo. NO cuenta como enviado:
      // quien importa no debe quedarse esperando un correo que no va a llegar.
      for (const r of inserted) {
        if (linkFailed.has(r.player_id)) {
          rows.push({ player_id: r.player_id, email: group.email, status: 'error', reason: 'link_failed' });
          continue;
        }
        rows.push({ player_id: r.player_id, email: group.email, status: 'covered' });
      }
    } else {
      // El correo SÍ salió: cuenta como enviado a efectos del resumen del lote.
      sentEmails++;
      for (const r of inserted) {
        if (linkFailed.has(r.player_id)) {
          rows.push({ player_id: r.player_id, email: group.email, status: 'error', reason: 'link_failed' });
          continue;
        }
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
