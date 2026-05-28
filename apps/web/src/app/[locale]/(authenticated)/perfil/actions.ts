'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createSupabaseServerClient,
  updateProfileSchema,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type UpdateProfileFormState = {
  error?:
    | 'full_name_too_short'
    | 'full_name_too_long'
    | 'date_of_birth_invalid'
    | 'locale_invalid'
    | 'no_session'
    | 'generic';
  success?: boolean;
  /** Si el locale cambió, se redirige al nuevo locale. */
  redirectedLocale?: string;
};

/**
 * Server action: actualiza full_name, date_of_birth y locale del user actual.
 * Si cambia el locale, redirige a /<newLocale>/perfil para que el shell se re-renderice.
 */
export async function updateProfile(
  currentLocale: string,
  _prev: UpdateProfileFormState,
  formData: FormData
): Promise<UpdateProfileFormState> {
  const parsed = updateProfileSchema.safeParse({
    full_name: formData.get('full_name'),
    date_of_birth: formData.get('date_of_birth'),
    locale: formData.get('locale'),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    if (
      issue === 'full_name_too_short' ||
      issue === 'full_name_too_long' ||
      issue === 'date_of_birth_invalid' ||
      issue === 'locale_invalid'
    ) {
      return { error: issue };
    }
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'no_session' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.full_name,
      date_of_birth: parsed.data.date_of_birth,
      locale: parsed.data.locale,
    })
    .eq('id', user.id);

  if (error) {
    return { error: 'generic' };
  }

  const localeChanged = parsed.data.locale !== currentLocale;

  // Sync de la cookie NEXT_LOCALE para que la siguiente request use el nuevo idioma.
  if (localeChanged) {
    const cookieStore = await cookies();
    cookieStore.set('NEXT_LOCALE', parsed.data.locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath('/', 'layout');

  if (localeChanged) {
    redirect(`/${parsed.data.locale}/perfil`);
  }

  return { success: true };
}

export type AvatarActionResult =
  | { success: true; path: string }
  | { success: false; error: 'no_session' | 'invalid_path' | 'generic' };

/**
 * Persiste el path del avatar tras una subida exitosa al bucket.
 * Validación mínima: el path debe empezar por `<auth.uid()>/` (defense in depth;
 * la RLS de storage ya lo hizo).
 */
export async function updateAvatarPath(path: string): Promise<AvatarActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'no_session' };

  if (!path.startsWith(`${user.id}/`)) {
    return { success: false, error: 'invalid_path' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', user.id);

  if (error) return { success: false, error: 'generic' };

  revalidatePath('/', 'layout');
  return { success: true, path };
}

/** Borra el path del avatar en `profiles`. No elimina el objeto del bucket aún. */
export async function clearAvatarPath(): Promise<AvatarActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'no_session' };

  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', user.id);

  if (error) return { success: false, error: 'generic' };

  revalidatePath('/', 'layout');
  return { success: true, path: '' };
}
