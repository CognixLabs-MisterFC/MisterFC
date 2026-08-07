'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  createSupabaseServerClient,
  updateProfileFromClient,
  updateAvatarPathFromClient,
  clearAvatarPathFromClient,
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
 * La validación + escritura viven en core (`updateProfileFromClient`, reutilizado
 * por la app nativa); aquí queda SOLO lo específico de la web: resolver la sesión,
 * sincronizar la cookie NEXT_LOCALE y redirigir cuando cambia el idioma.
 */
export async function updateProfile(
  currentLocale: string,
  _prev: UpdateProfileFormState,
  formData: FormData
): Promise<UpdateProfileFormState> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'no_session' };
  }

  const result = await updateProfileFromClient(supabase, user.id, {
    full_name: formData.get('full_name'),
    date_of_birth: formData.get('date_of_birth'),
    locale: formData.get('locale'),
  });
  if (!result.success) {
    return { error: result.error };
  }

  const localeChanged = result.locale !== currentLocale;

  // Sync de la cookie NEXT_LOCALE para que la siguiente request use el nuevo idioma.
  if (localeChanged) {
    const cookieStore = await cookies();
    cookieStore.set('NEXT_LOCALE', result.locale, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  revalidatePath('/', 'layout');

  if (localeChanged) {
    redirect(`/${result.locale}/perfil`);
  }

  return { success: true };
}

export type AvatarActionResult =
  | { success: true; path: string }
  | { success: false; error: 'no_session' | 'invalid_path' | 'generic' };

/**
 * Persiste el path del avatar tras una subida exitosa al bucket. La validación
 * (`<auth.uid()>/…`, defense in depth) y el UPDATE viven en core; aquí solo la
 * sesión y el revalidate.
 */
export async function updateAvatarPath(path: string): Promise<AvatarActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'no_session' };

  const result = await updateAvatarPathFromClient(supabase, user.id, path);
  if (!result.success) return { success: false, error: result.error };

  revalidatePath('/', 'layout');
  return { success: true, path: result.path };
}

/** Borra el path del avatar en `profiles`. No elimina el objeto del bucket aún. */
export async function clearAvatarPath(): Promise<AvatarActionResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'no_session' };

  const result = await clearAvatarPathFromClient(supabase, user.id);
  if (!result.success) return { success: false, error: result.error };

  revalidatePath('/', 'layout');
  return { success: true, path: '' };
}
