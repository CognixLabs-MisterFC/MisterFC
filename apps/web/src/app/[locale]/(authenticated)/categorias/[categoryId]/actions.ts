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
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

function parseTeamFormData(formData: FormData) {
  return teamSchema.safeParse({
    name: formData.get('name'),
    format: formData.get('format'),
    color: formData.get('color'),
  });
}

function mapTeamError(message: string | undefined): TeamFormState {
  if (
    message === 'name_required' ||
    message === 'name_too_long' ||
    message === 'format_invalid' ||
    message === 'color_invalid'
  ) {
    return { error: message };
  }
  return { error: 'generic' };
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

  const { error } = await supabase.from('teams').insert({
    category_id: categoryId,
    name: parsed.data.name,
    format: parsed.data.format,
    color: parsed.data.color,
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

  const { error } = await supabase
    .from('teams')
    .update({
      name: parsed.data.name,
      format: parsed.data.format,
      color: parsed.data.color,
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
