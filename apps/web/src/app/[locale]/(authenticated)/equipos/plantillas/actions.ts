'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  categoryTemplateSchema,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CategoryTemplateFormState = {
  error?:
    | 'name_required'
    | 'name_too_long'
    | 'kind_invalid'
    | 'half_duration_invalid'
    | 'name_duplicate'
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

function mapError(message: string | undefined): CategoryTemplateFormState {
  if (
    message === 'name_required' ||
    message === 'name_too_long' ||
    message === 'kind_invalid' ||
    message === 'half_duration_invalid'
  ) {
    return { error: message };
  }
  return { error: 'generic' };
}

function parse(formData: FormData) {
  return categoryTemplateSchema.safeParse({
    name: formData.get('name'),
    kind: formData.get('kind') ?? undefined,
    half_duration_minutes: formData.get('half_duration_minutes'),
  });
}

type Supa = ReturnType<typeof createSupabaseServerClient>;

/**
 * Unicidad suave por nombre dentro del club (case-insensitive), para no crear
 * duplicados antes de que A6 ponga la constraint `unique(club_id, lower(name))`.
 * `excludeId` excluye la propia fila en el renombrado.
 */
async function nameTaken(
  supabase: Supa,
  clubId: string,
  name: string,
  excludeId?: string,
): Promise<boolean> {
  let q = supabase
    .from('categories')
    .select('id')
    .eq('club_id', clubId)
    .ilike('name', name);
  if (excludeId) q = q.neq('id', excludeId);
  const { data } = await q.limit(1);
  return (data?.length ?? 0) > 0;
}

export async function createCategoryTemplate(
  _prev: CategoryTemplateFormState,
  formData: FormData,
): Promise<CategoryTemplateFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return mapError(parsed.error.issues[0]?.message);

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (await nameTaken(supabase, clubId, parsed.data.name)) {
    return { error: 'name_duplicate' };
  }

  // Categoría-plantilla permanente: SIN season ni order_idx (nullable desde A4).
  const { error } = await supabase.from('categories').insert({
    club_id: clubId,
    name: parsed.data.name,
    kind: parsed.data.kind,
    half_duration_minutes: parsed.data.half_duration_minutes,
  });

  if (error) return { error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos/plantillas', 'page');
  return { success: true };
}

export async function updateCategoryTemplate(
  categoryId: string,
  _prev: CategoryTemplateFormState,
  formData: FormData,
): Promise<CategoryTemplateFormState> {
  const parsed = parse(formData);
  if (!parsed.success) return mapError(parsed.error.issues[0]?.message);

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  if (await nameTaken(supabase, clubId, parsed.data.name, categoryId)) {
    return { error: 'name_duplicate' };
  }

  const { error } = await supabase
    .from('categories')
    .update({
      name: parsed.data.name,
      kind: parsed.data.kind,
      half_duration_minutes: parsed.data.half_duration_minutes,
    })
    .eq('id', categoryId)
    .eq('club_id', clubId);

  if (error) return { error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos/plantillas', 'page');
  return { success: true };
}

export type DeleteCategoryTemplateResult =
  | { success: true }
  | { success: false; error: 'has_teams' | 'forbidden' | 'generic' };

export async function deleteCategoryTemplate(
  categoryId: string,
): Promise<DeleteCategoryTemplateResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // No borrar una plantilla con equipos colgando (en cualquier temporada): el FK
  // teams.category_id es NOT NULL y la cascada borraría equipos. Avisamos.
  const { count } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);
  if ((count ?? 0) > 0) return { success: false, error: 'has_teams' };

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId);
  if (error) return { success: false, error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos/plantillas', 'page');
  return { success: true };
}
