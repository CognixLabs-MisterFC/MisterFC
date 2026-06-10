'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  assertCategoryDeletable,
  categoryTemplateSchema,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
  resolveCategoryUpdate,
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

// Rework C · C4 CONTRACT: el alta de categorías se ha retirado. El catálogo es
// fijo (10 estándar sembradas + custom grandfathered); el club solo crea equipos.
// La edición (solo half_duration en estándar) vive en updateCategoryTemplate.

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

  // Cargar la fila para conocer is_standard + valores actuales (C3): en una
  // estándar, name/kind quedan congelados (solo cambia half_duration).
  const { data: existing, error: loadErr } = await supabase
    .from('categories')
    .select('name, kind, is_standard')
    .eq('id', categoryId)
    .eq('club_id', clubId)
    .maybeSingle();
  if (loadErr) return { error: 'generic' };
  if (!existing) return { error: 'generic' };

  const effective = resolveCategoryUpdate({
    isStandard: existing.is_standard,
    existing: { name: existing.name, kind: existing.kind },
    input: {
      name: parsed.data.name,
      kind: parsed.data.kind,
      half_duration_minutes: parsed.data.half_duration_minutes,
    },
  });

  // Solo comprobar unicidad si el nombre cambia (en estándar no cambia nunca).
  if (
    effective.name.toLowerCase() !== existing.name.toLowerCase() &&
    (await nameTaken(supabase, clubId, effective.name, categoryId))
  ) {
    return { error: 'name_duplicate' };
  }

  const { error } = await supabase
    .from('categories')
    .update({
      name: effective.name,
      kind: effective.kind,
      half_duration_minutes: effective.half_duration_minutes,
    })
    .eq('id', categoryId)
    .eq('club_id', clubId);

  if (error) return { error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos/plantillas', 'page');
  return { success: true };
}

export type DeleteCategoryTemplateResult =
  | { success: true }
  | { success: false; error: 'has_teams' | 'is_standard' | 'forbidden' | 'generic' };

export async function deleteCategoryTemplate(
  categoryId: string,
): Promise<DeleteCategoryTemplateResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // C3: las estándar NO se borran; las custom solo si no tienen equipos (el FK
  // teams.category_id es CASCADE → borrar con equipos destruiría histórico; el
  // blindaje a nivel BD llega en C4). El servidor es el contrato final.
  const { data: cat, error: loadErr } = await supabase
    .from('categories')
    .select('is_standard')
    .eq('id', categoryId)
    .maybeSingle();
  if (loadErr) return { success: false, error: 'generic' };
  if (!cat) return { success: false, error: 'generic' };

  const { count } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', categoryId);

  const verdict = assertCategoryDeletable({
    isStandard: cat.is_standard,
    teamsCount: count ?? 0,
  });
  if (verdict !== 'ok') return { success: false, error: verdict };

  const { error } = await supabase
    .from('categories')
    .delete()
    .eq('id', categoryId);
  if (error) return { success: false, error: 'generic' };
  revalidatePath('/[locale]/(authenticated)/equipos/plantillas', 'page');
  return { success: true };
}
