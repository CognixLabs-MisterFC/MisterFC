'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  teamSchema,
  teamCreateSchema,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type TeamFormState = {
  error?:
    | 'name_required'
    | 'name_too_long'
    | 'format_invalid'
    | 'color_invalid'
    | 'division_invalid'
    | 'category_invalid'
    | 'season_invalid'
    | 'no_active_club'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

async function activeClubId(): Promise<string | null> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) return null;
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;
  const { active } = resolveActiveClub(clubs, cookieValue);
  return active?.club.id ?? null;
}

function mapTeamError(message: string | undefined): TeamFormState {
  if (
    message === 'name_required' ||
    message === 'name_too_long' ||
    message === 'format_invalid' ||
    message === 'color_invalid' ||
    message === 'division_invalid' ||
    message === 'category_invalid' ||
    message === 'season_invalid'
  ) {
    return { error: message };
  }
  return { error: 'generic' };
}

type Supa = ReturnType<typeof createSupabaseServerClient>;

/**
 * F7.6c — valida que la división elegida exista para la categoría (su `kind`) en
 * el catálogo `substitution_regimes`. true si es válida o si no se eligió división
 * (opcional). Si la categoría no tiene divisiones (kind sin filas), solo es válido
 * NO elegir división.
 */
async function isDivisionValid(
  supabase: Supa,
  categoryKind: string | null,
  division: string | undefined,
): Promise<boolean> {
  if (!division) return true; // división opcional
  if (!categoryKind) return false; // hay división pero la categoría no tiene catálogo
  const { data } = await supabase
    .from('substitution_regimes')
    .select('division')
    .eq('category_kind', categoryKind)
    .eq('division', division)
    .maybeSingle();
  return data != null;
}

/**
 * Rework A (A4) — alta de equipo desde /equipos: temporada + categoría + división
 * + nombre. La categoría debe pertenecer al club activo; `club_id` lo pone el
 * trigger teams_derive_from_category. `season` la aporta SIEMPRE este flujo.
 */
export async function createTeam(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = teamCreateSchema.safeParse({
    category_id: formData.get('category_id'),
    season: formData.get('season'),
    name: formData.get('name'),
    format: formData.get('format'),
    color: formData.get('color'),
    division: formData.get('division') ?? undefined,
  });
  if (!parsed.success) {
    return mapTeamError(parsed.error.issues[0]?.message);
  }

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // La categoría (plantilla) debe existir y ser del club activo.
  const { data: cat } = await supabase
    .from('categories')
    .select('id, kind, club_id')
    .eq('id', parsed.data.category_id)
    .maybeSingle();
  if (!cat || cat.club_id !== clubId) return { error: 'category_invalid' };

  const division = parsed.data.division;
  if (!(await isDivisionValid(supabase, (cat.kind as string | null) ?? null, division))) {
    return { error: 'division_invalid' };
  }

  // club_id es NOT NULL en el tipo Insert; el trigger teams_derive_from_category
  // lo re-fuerza desde la categoría igualmente. Lo pasamos para satisfacer el tipo
  // (coincide con el club activo, ya validado contra cat.club_id).
  const { error } = await supabase.from('teams').insert({
    category_id: parsed.data.category_id,
    club_id: clubId,
    season: parsed.data.season,
    name: parsed.data.name,
    format: parsed.data.format,
    color: parsed.data.color,
    division: division ?? null,
  });

  if (error) return { error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos', 'page');
  return { success: true };
}

export async function updateTeam(
  teamId: string,
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const parsed = teamSchema.safeParse({
    name: formData.get('name'),
    format: formData.get('format'),
    color: formData.get('color'),
    division: formData.get('division') ?? undefined,
  });
  if (!parsed.success) {
    return mapTeamError(parsed.error.issues[0]?.message);
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Régimen de cambios (7.6c): valida la división contra el kind de la categoría
  // del equipo.
  const { data: team } = await supabase
    .from('teams')
    .select('categories!inner(kind)')
    .eq('id', teamId)
    .maybeSingle();
  type Shape = { categories: { kind: string | null } } | null;
  const categoryKind = (team as unknown as Shape)?.categories?.kind ?? null;
  const division = parsed.data.division;
  if (!(await isDivisionValid(supabase, categoryKind, division))) {
    return { error: 'division_invalid' };
  }

  const { error } = await supabase
    .from('teams')
    .update({
      name: parsed.data.name,
      format: parsed.data.format,
      color: parsed.data.color,
      division: division ?? null,
    })
    .eq('id', teamId);

  if (error) return { error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos', 'page');
  return { success: true };
}

export type DeleteTeamResult =
  | { success: true }
  | { success: false; error: 'generic' };

export async function deleteTeam(teamId: string): Promise<DeleteTeamResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.from('teams').delete().eq('id', teamId);
  if (error) return { success: false, error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos', 'page');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rework C · C6 — abrir temporada nueva (+ clonar equipos de la activa).
// ─────────────────────────────────────────────────────────────────────────────

export type OpenSeasonState = {
  ok?: { season: string };
  error?: 'no_active_club' | 'forbidden' | 'no_active_season' | 'generic';
};

/**
 * Abre (o reanuda) la temporada `upcoming` del club y clona la estructura de
 * equipos de la activa hacia ella. Delega en la función SQL `open_next_season`
 * (SECURITY DEFINER, idempotente, solo admin_club, no destructiva). Devuelve el
 * label de la upcoming para que el cliente cambie el filtro a esa temporada.
 */
export async function openNextSeason(): Promise<OpenSeasonState> {
  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data, error } = await supabase.rpc('open_next_season', {
    p_club_id: clubId,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('no_active_season')) return { error: 'no_active_season' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/equipos', 'page');
  return { ok: { season: data as string } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rework C (C7) — reasignación de jugadores en bloque (asistente de mapeo)
// ─────────────────────────────────────────────────────────────────────────────

export type PlacePlayersState = {
  ok?: { placed: number };
  error?:
    | 'no_active_club'
    | 'no_players'
    | 'forbidden'
    | 'dest_team_invalid'
    | 'dest_not_upcoming'
    | 'generic';
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coloca un checklist de jugadores en un equipo de la temporada `upcoming`,
 * abriendo su membresía activa SIN cerrar ni tocar las de la temporada activa.
 * Delega en la función SQL `place_players_in_upcoming` (SECURITY DEFINER, solo
 * admin_club, solo equipos upcoming, idempotente, solo INSERT). Devuelve cuántos
 * jugadores se colocaron de verdad (los ya colocados se saltan).
 */
export async function placePlayersInUpcoming(
  destTeamId: string,
  playerIds: string[],
): Promise<PlacePlayersState> {
  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  if (!UUID_RE.test(destTeamId)) return { error: 'dest_team_invalid' };
  const ids = [...new Set(playerIds)].filter((id) => UUID_RE.test(id));
  if (ids.length === 0) return { error: 'no_players' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data, error } = await supabase.rpc('place_players_in_upcoming', {
    p_club_id: clubId,
    p_dest_team_id: destTeamId,
    p_player_ids: ids,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('dest_not_upcoming')) return { error: 'dest_not_upcoming' };
    if (msg.includes('dest_team_invalid')) return { error: 'dest_team_invalid' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/equipos/reasignacion', 'page');
  return { ok: { placed: (data as number) ?? 0 } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rework C (C8) — finalizar temporada (cierre del rollover)
// ─────────────────────────────────────────────────────────────────────────────

export type FinalizeSeasonState = {
  ok?: { season: string };
  error?:
    | 'no_active_club'
    | 'cutoff_required'
    | 'cutoff_invalid'
    | 'cutoff_too_early'
    | 'forbidden'
    | 'no_active_season'
    | 'no_upcoming'
    | 'generic';
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Finaliza el rollover atómicamente: cierra las membresías abiertas de la
 * temporada activa a `cutoff`, marca la activa `finalized` y la upcoming
 * `active`. Delega en la función SQL `finalize_active_season` (SECURITY DEFINER,
 * solo admin_club, exige una upcoming). Devuelve el label de la nueva activa.
 */
export async function finalizeSeason(
  cutoff: string,
): Promise<FinalizeSeasonState> {
  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  if (!cutoff) return { error: 'cutoff_required' };
  if (!DATE_RE.test(cutoff) || Number.isNaN(new Date(cutoff).getTime())) {
    return { error: 'cutoff_invalid' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data, error } = await supabase.rpc('finalize_active_season', {
    p_club_id: clubId,
    p_cutoff: cutoff,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('no_upcoming')) return { error: 'no_upcoming' };
    if (msg.includes('no_active_season')) return { error: 'no_active_season' };
    if (msg.includes('cutoff_too_early')) return { error: 'cutoff_too_early' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/equipos', 'page');
  return { ok: { season: data as string } };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rework C (C9) — desasignar jugador colocado por error en la reasignación
// ─────────────────────────────────────────────────────────────────────────────

export type UnplacePlayerState = {
  ok?: { removed: number };
  error?:
    | 'no_active_club'
    | 'team_invalid'
    | 'not_upcoming'
    | 'forbidden'
    | 'generic';
};

/**
 * Deshace una colocación de C7: quita la membresía abierta del jugador en un
 * equipo de la temporada `upcoming` (DELETE, sin histórico). Delega en la función
 * SQL `unplace_player_from_upcoming` (SECURITY DEFINER, solo admin_club, SOLO
 * equipos upcoming — jamás active/finalized, idempotente).
 */
export async function unplacePlayerFromUpcoming(
  teamId: string,
  playerId: string,
): Promise<UnplacePlayerState> {
  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };
  if (!UUID_RE.test(teamId) || !UUID_RE.test(playerId)) {
    return { error: 'team_invalid' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { data, error } = await supabase.rpc('unplace_player_from_upcoming', {
    p_club_id: clubId,
    p_team_id: teamId,
    p_player_id: playerId,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('not_upcoming')) return { error: 'not_upcoming' };
    if (msg.includes('team_invalid')) return { error: 'team_invalid' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/equipos/reasignacion', 'page');
  return { ok: { removed: (data as number) ?? 0 } };
}
