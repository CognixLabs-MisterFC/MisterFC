'use server';

import { redirect } from 'next/navigation';
import {
  createClubSchema,
  createSupabaseServerClient,
  nameToSlug,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type CreateClubFormState = {
  error?: 'name_required' | 'slug_collision' | 'generic';
};

/**
 * Server Action: crea un club nuevo + membership admin_club para el user actual.
 *
 * Pasos:
 *  1. Validar input con Zod.
 *  2. Derivar slug del nombre. Si queda vacío (input solo símbolos), error.
 *  3. INSERT en clubs. Si choca el unique de slug → error de colisión.
 *  4. INSERT en memberships con role=admin_club.
 *  5. Redirect a `/<locale>`.
 *
 * Si el paso 4 falla, el paso 3 queda hecho (sin transacción cross-tabla aquí).
 * En la práctica las RLS de 1.7 + la cascade ON DELETE permiten reconciliar
 * manualmente desde el dashboard si pasa. Para Fase 2 evaluaremos envolverlo
 * en una RPC `create_club_with_admin` que sea atómica.
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

  const { data: club, error: clubError } = await supabase
    .from('clubs')
    .insert({
      name: parsed.data.name,
      slug,
      locale: parsed.data.locale,
    })
    .select('id')
    .single();

  if (clubError) {
    // Postgres unique_violation
    if (clubError.code === '23505') {
      return { error: 'slug_collision' };
    }
    return { error: 'generic' };
  }

  const { error: membershipError } = await supabase.from('memberships').insert({
    profile_id: user.id,
    club_id: club.id,
    role: 'admin_club',
  });

  if (membershipError) {
    return { error: 'generic' };
  }

  redirect(`/${locale}`);
}
