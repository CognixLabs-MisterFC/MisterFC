'use server';

import { revalidatePath } from 'next/cache';
import { teamSchema, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type TeamFormState = {
  error?:
    | 'name_required'
    | 'name_too_long'
    | 'format_invalid'
    | 'color_invalid'
    | 'division_invalid'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

function parseTeamFormData(formData: FormData) {
  return teamSchema.safeParse({
    name: formData.get('name'),
    format: formData.get('format'),
    color: formData.get('color'),
    division: formData.get('division') ?? undefined,
  });
}

function mapTeamError(message: string | undefined): TeamFormState {
  if (
    message === 'name_required' ||
    message === 'name_too_long' ||
    message === 'format_invalid' ||
    message === 'color_invalid' ||
    message === 'division_invalid'
  ) {
    return { error: message };
  }
  return { error: 'generic' };
}

type Supa = ReturnType<typeof createSupabaseServerClient>;

/**
 * F7.6c — valida que la división elegida exista para la categoría (su `kind`)
 * en el catálogo `substitution_regimes`. Devuelve true si es válida o si no se
 * eligió división (opcional). Si la categoría no tiene divisiones (kind sin
 * filas, p.ej. adultas), solo es válido NO elegir división.
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

export async function createTeam(
  categoryId: string,
  _prev: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  const parsed = parseTeamFormData(formData);
  if (!parsed.success) {
    return mapTeamError(parsed.error.issues[0]?.message);
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Régimen de cambios (7.6c): la división debe ser válida para la categoría.
  const { data: cat } = await supabase
    .from('categories')
    .select('kind')
    .eq('id', categoryId)
    .maybeSingle();
  const division = parsed.data.division;
  if (!(await isDivisionValid(supabase, (cat?.kind as string | null) ?? null, division))) {
    return { error: 'division_invalid' };
  }

  const { error } = await supabase.from('teams').insert({
    category_id: categoryId,
    name: parsed.data.name,
    format: parsed.data.format,
    color: parsed.data.color,
    division: division ?? null,
  });

  if (error) return { error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/categorias/[categoryId]', 'page');
  return { success: true };
}

export async function updateTeam(
  teamId: string,
  _prev: TeamFormState,
  formData: FormData
): Promise<TeamFormState> {
  const parsed = parseTeamFormData(formData);
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
  revalidatePath('/[locale]/(authenticated)/categorias/[categoryId]', 'page');
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
  revalidatePath('/[locale]/(authenticated)/categorias/[categoryId]', 'page');
  return { success: true };
}
