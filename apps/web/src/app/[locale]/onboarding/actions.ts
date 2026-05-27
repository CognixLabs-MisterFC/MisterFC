'use server';

import { redirect } from 'next/navigation';
import {
  createClubSchema,
  createSupabaseServerClient,
  nameToSlug,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CreateClubFormState = {
  error?: 'name_required' | 'slug_collision' | 'already_in_a_club' | 'generic';
};

/**
 * Server Action: crea un club nuevo + membership admin_club para el user actual.
 *
 * Llamada única a la RPC `create_club_with_admin` (SECURITY DEFINER, atómica).
 * Esa función:
 *   - exige auth.uid() != null
 *   - exige que el user no tenga ya memberships
 *   - valida name/slug/locale
 *   - inserta club y membership en una sola transacción
 *
 * La tabla `clubs` está cerrada a INSERT directo desde cliente (policy
 * clubs_insert_forbidden), así que este es el único path autorizado para
 * crear un club en Fase 1.
 */
export async function createClub(
  locale: string,
  _prev: CreateClubFormState,
  formData: FormData
): Promise<CreateClubFormState> {
  const parsed = createClubSchema.safeParse({
    name: formData.get('name'),
    locale: formData.get('club_locale'),
  });

  if (!parsed.success) {
    return { error: 'name_required' };
  }

  const slug = nameToSlug(parsed.data.name);
  if (slug.length === 0) {
    return { error: 'name_required' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/${locale}/signin`);
  }

  const { error } = await supabase.rpc('create_club_with_admin', {
    p_name: parsed.data.name,
    p_slug: slug,
    p_locale: parsed.data.locale,
  });

  if (error) {
    // Postgres unique_violation sobre clubs.slug
    if (error.code === '23505') {
      return { error: 'slug_collision' };
    }
    // Excepciones explícitas de la función (errcode P0001 con MESSAGE específico)
    if (error.message?.includes('already_in_a_club')) {
      return { error: 'already_in_a_club' };
    }
    return { error: 'generic' };
  }

  redirect(`/${locale}`);
}
