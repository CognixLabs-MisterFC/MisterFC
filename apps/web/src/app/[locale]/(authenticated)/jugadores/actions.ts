'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  createPlayerSchema,
  createSupabaseServerClient,
  getCurrentUserClubs,
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
