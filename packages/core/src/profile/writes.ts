import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { updateProfileSchema } from '../schemas/profile';

/**
 * Perfil del PROPIO usuario (datos personales + avatar), extraído de apps/web
 * (`perfil/actions.ts`) para reutilizarlo en la app nativa.
 *
 * A diferencia de la gestión sensible del jugador (RPC SECURITY DEFINER, porque
 * `players.photo_url`/médica están cerradas), aquí TODO es escritura RLS DIRECTA
 * sobre la propia fila `profiles` (el usuario es dueño de su fila) y el avatar se
 * sube al bucket `profile-avatars` en la carpeta `<auth.uid()>/` (policy
 * `profile_avatars_insert_own`). NO hay service-role ni route handler.
 *
 * Estas funciones NO resuelven la sesión (el caller pasa `userId`) ni tocan la
 * cookie de locale ni redirigen: esos son efectos WEB que quedan en el wrapper de
 * apps/web. La app nativa persiste `locale` en `profiles` (lo consumen los emails/
 * notificaciones server-side) pero NO cambia el idioma de la UI en caliente.
 */
type DbClient = SupabaseClient<Database>;

/** TTL de la URL firmada del avatar (1 h, igual que la web). */
export const PROFILE_AVATAR_SIGN_TTL_SECONDS = 3600;

// ── Lectura ──────────────────────────────────────────────────────────────────

/** Datos del perfil propios necesarios para poblar el formulario y el avatar. */
export type ProfileData = {
  full_name: string | null;
  date_of_birth: string | null;
  locale: string;
  avatar_url: string | null;
};

/** Lee la fila `profiles` del usuario (RLS: solo la propia y clubmates). null si no hay. */
export async function getProfileFromClient(
  supabase: DbClient,
  userId: string,
): Promise<ProfileData | null> {
  const { data } = await supabase
    .from('profiles')
    .select('full_name, date_of_birth, locale, avatar_url')
    .eq('id', userId)
    .maybeSingle();
  if (!data) return null;
  return {
    full_name: data.full_name ?? null,
    date_of_birth: data.date_of_birth ?? null,
    locale: data.locale ?? 'es',
    avatar_url: data.avatar_url ?? null,
  };
}

/** Firma la ruta del bucket privado `profile-avatars`. null si no hay/falla. */
export async function signAvatarFromClient(
  supabase: DbClient,
  path: string,
  ttlSeconds: number = PROFILE_AVATAR_SIGN_TTL_SECONDS,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from('profile-avatars')
    .createSignedUrl(path, ttlSeconds);
  return data?.signedUrl ?? null;
}

// ── Datos personales ─────────────────────────────────────────────────────────

export type ProfileWriteError =
  | 'full_name_too_short'
  | 'full_name_too_long'
  | 'date_of_birth_invalid'
  | 'locale_invalid'
  | 'generic';

export type UpdateProfileResult =
  | { success: true; locale: string }
  | { success: false; error: ProfileWriteError };

/**
 * Valida (mismo `updateProfileSchema` que la web) y actualiza full_name,
 * date_of_birth y locale de la propia fila. Devuelve el `locale` persistido para
 * que el caller web sincronice la cookie NEXT_LOCALE (efecto web; la app nativa lo
 * ignora). Los códigos de error espejan los de la Server Action.
 */
export async function updateProfileFromClient(
  supabase: DbClient,
  userId: string,
  input: { full_name: unknown; date_of_birth: unknown; locale: unknown },
): Promise<UpdateProfileResult> {
  const parsed = updateProfileSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    if (
      issue === 'full_name_too_short' ||
      issue === 'full_name_too_long' ||
      issue === 'date_of_birth_invalid' ||
      issue === 'locale_invalid'
    ) {
      return { success: false, error: issue };
    }
    return { success: false, error: 'generic' };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      full_name: parsed.data.full_name,
      date_of_birth: parsed.data.date_of_birth,
      locale: parsed.data.locale,
    })
    .eq('id', userId);

  if (error) return { success: false, error: 'generic' };
  return { success: true, locale: parsed.data.locale };
}

// ── Avatar ───────────────────────────────────────────────────────────────────

export type AvatarPathResult =
  | { success: true; path: string }
  | { success: false; error: 'invalid_path' | 'generic' };

/**
 * Persiste la ruta del avatar tras subirlo al bucket. Defensa en profundidad: el
 * path DEBE colgar de `<userId>/` (la RLS de storage ya lo impuso al subir) y no
 * exceder 200 (CHECK de `profiles.avatar_url`).
 */
export async function updateAvatarPathFromClient(
  supabase: DbClient,
  userId: string,
  path: string,
): Promise<AvatarPathResult> {
  if (!path.startsWith(`${userId}/`) || path.length > 200) {
    return { success: false, error: 'invalid_path' };
  }
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userId);
  if (error) return { success: false, error: 'generic' };
  return { success: true, path };
}

/** Borra el path del avatar (`avatar_url` → NULL). No elimina el objeto del bucket. */
export async function clearAvatarPathFromClient(
  supabase: DbClient,
  userId: string,
): Promise<AvatarPathResult> {
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', userId);
  if (error) return { success: false, error: 'generic' };
  return { success: true, path: '' };
}
