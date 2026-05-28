'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  categorySchema,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CategoryFormState = {
  error?:
    | 'name_required'
    | 'name_too_long'
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

function parseCategoryFormData(formData: FormData) {
  return categorySchema.safeParse({
    name: formData.get('name'),
    season: formData.get('season'),
    order_idx: formData.get('order_idx') ?? 0,
  });
}

function mapCategoryError(message: string | undefined): CategoryFormState {
  if (
    message === 'name_required' ||
    message === 'name_too_long' ||
    message === 'season_invalid'
  ) {
    return { error: message };
  }
  return { error: 'generic' };
}

export async function createCategory(
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const parsed = parseCategoryFormData(formData);
  if (!parsed.success) {
    return mapCategoryError(parsed.error.issues[0]?.message);
  }

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.from('categories').insert({
    club_id: clubId,
    name: parsed.data.name,
    season: parsed.data.season,
    order_idx: parsed.data.order_idx,
  });

  if (error) {
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/categorias', 'page');
  return { success: true };
}

export async function updateCategory(
  categoryId: string,
  _prev: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const parsed = parseCategoryFormData(formData);
  if (!parsed.success) {
    return mapCategoryError(parsed.error.issues[0]?.message);
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('categories')
    .update({
      name: parsed.data.name,
      season: parsed.data.season,
      order_idx: parsed.data.order_idx,
    })
    .eq('id', categoryId);

  if (error) {
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/categorias', 'page');
  return { success: true };
}

export type DeleteCategoryResult =
  | { success: true }
  | { success: false; error: 'forbidden' | 'generic' };

export async function deleteCategory(
  categoryId: string
): Promise<DeleteCategoryResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId);

  if (error) {
    return { success: false, error: 'generic' };
  }
  revalidatePath('/[locale]/(authenticated)/categorias', 'page');
  return { success: true };
}
