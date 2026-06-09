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
