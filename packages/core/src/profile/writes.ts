import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { updateProfileSchema } from '../schemas/profile';
import { normalizePhone } from '../schemas/phone';

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

/**
 * El teléfono propio. NO sale de `profiles` con un select: desde la migración
 * 20261057000000 la columna no es legible por el cliente (se revocó el SELECT y
 * se reconcedió columna a columna). La única puerta es `get_my_phone()`.
 *
 * Devuelve un resultado con `ok` en vez de un `string | null` a secas, y no es
 * ceremonia: «no tiene teléfono» y «no he podido leerlo» se pintan igual —en
 * blanco— y quien lo pinte podría guardar ese blanco encima del teléfono bueno.
 * Con `ok:false` el formulario sabe que NO debe mandar el campo.
 */
export type MyPhoneResult = { ok: true; phone: string | null } | { ok: false };

export async function getMyPhoneFromClient(supabase: DbClient): Promise<MyPhoneResult> {
  const { data, error } = await supabase.rpc('get_my_phone');
  if (error) return { ok: false };
  return { ok: true, phone: (data as string | null) ?? null };
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
  | 'phone_invalid'
  | 'generic';

export type UpdateProfileResult =
  | { success: true; locale: string }
  | { success: false; error: ProfileWriteError };

/**
 * Actualiza el perfil propio con un update PARCIAL: valida y escribe SOLO las
 * claves PRESENTES en `input` (mismos validadores que la web). Así cada superficie
 * escribe únicamente sus campos y no pisa los demás (p.ej. guardar nombre/fecha no
 * toca `locale`, y cambiar idioma no revierte edits del nombre en curso).
 *
 * La web sigue pasando los tres campos → valida y escribe los tres, comportamiento
 * IDÉNTICO. Devuelve el `locale` persistido (string) para que el caller web
 * sincronice la cookie NEXT_LOCALE; en un update sin `locale` devuelve '' (los
 * callers nativos no lo leen). Los códigos de error espejan los de la Server Action.
 */
export async function updateProfileFromClient(
  supabase: DbClient,
  userId: string,
  input: { full_name?: unknown; date_of_birth?: unknown; locale?: unknown; phone?: unknown },
): Promise<UpdateProfileResult> {
  const parsed = updateProfileSchema.partial().safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]?.message;
    if (
      issue === 'full_name_too_short' ||
      issue === 'full_name_too_long' ||
      issue === 'date_of_birth_invalid' ||
      issue === 'locale_invalid' ||
      issue === 'phone_invalid'
    ) {
      return { success: false, error: issue };
    }
    return { success: false, error: 'generic' };
  }

  // Solo las claves PRESENTES en la entrada llegan al UPDATE.
  const payload: {
    full_name?: string;
    date_of_birth?: string | null;
    locale?: string;
    phone?: string | null;
  } = {};
  if ('full_name' in input) payload.full_name = parsed.data.full_name;
  if ('date_of_birth' in input) payload.date_of_birth = parsed.data.date_of_birth ?? null;
  if ('locale' in input) payload.locale = parsed.data.locale;
  // El vacío va como NULL: el CHECK de la columna rechaza la cadena vacía.
  if ('phone' in input) payload.phone = normalizePhone(parsed.data.phone);

  if (Object.keys(payload).length > 0) {
    // Sin `.select()` encadenado, y no es casualidad: pedir la fila de vuelta
    // sería una LECTURA de `phone`, que está cerrada, y el UPDATE entero
    // fallaría con 42501.
    const { error } = await supabase.from('profiles').update(payload).eq('id', userId);
    if (error) return { success: false, error: 'generic' };
  }

  return { success: true, locale: parsed.data.locale ?? '' };
}

// ── Avatar ───────────────────────────────────────────────────────────────────

export type AvatarPathResult =
  | { success: true; path: string }
  | { success: false; error: 'invalid_path' | 'generic' };

/**
 * Elimina un objeto del bucket de avatares, BEST-EFFORT.
 *
 * Va DESPUÉS de que la columna ya esté escrita y nunca tumba la operación: si el
 * borrado falla, lo que el usuario pidió (quitar o cambiar la foto) ya está hecho y lo
 * único que queda es un objeto huérfano. Mismo criterio que el borrado de la foto en
 * `decidePlayerErasureFromClient`.
 *
 * No hace falta service-role: la política `profile_avatars_delete_own` deja a cada
 * usuario borrar lo que cuelga de su propia carpeta.
 */
async function removeAvatarObject(supabase: DbClient, path: string | null): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from('profile-avatars').remove([path]);
  } catch {
    // Huérfano en el bucket, nada más. La columna ya está bien.
  }
}

/** Ruta que tiene guardada el avatar ahora mismo (para poder borrar el objeto viejo). */
async function currentAvatarPath(supabase: DbClient, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('avatar_url')
    .eq('id', userId)
    .maybeSingle();
  // Si no se puede leer, NO se borra nada: preferimos un huérfano a borrar de más.
  if (error) return null;
  return data?.avatar_url ?? null;
}

/**
 * Persiste la ruta del avatar tras subirlo al bucket. Defensa en profundidad: el
 * path DEBE colgar de `<userId>/` (la RLS de storage ya lo impuso al subir) y no
 * exceder 200 (CHECK de `profiles.avatar_url`).
 *
 * Cambiar de foto sube un objeto NUEVO (nombre con uuid), así que el anterior se
 * queda en el bucket si nadie lo retira: se retira aquí.
 */
export async function updateAvatarPathFromClient(
  supabase: DbClient,
  userId: string,
  path: string,
): Promise<AvatarPathResult> {
  if (!path.startsWith(`${userId}/`) || path.length > 200) {
    return { success: false, error: 'invalid_path' };
  }
  const previous = await currentAvatarPath(supabase, userId);
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: path })
    .eq('id', userId);
  if (error) return { success: false, error: 'generic' };
  // Solo si de verdad cambió: volver a guardar la MISMA ruta no debe borrar la foto.
  if (previous && previous !== path) await removeAvatarObject(supabase, previous);
  return { success: true, path };
}

/**
 * Quita el avatar: `avatar_url` → NULL **y** borra el objeto del bucket.
 *
 * La pantalla dice "quitar foto" y quien la pulsa entiende que la foto desaparece; si
 * solo se desreferenciaba, el fichero seguía vivo en Storage.
 */
export async function clearAvatarPathFromClient(
  supabase: DbClient,
  userId: string,
): Promise<AvatarPathResult> {
  const previous = await currentAvatarPath(supabase, userId);
  const { error } = await supabase
    .from('profiles')
    .update({ avatar_url: null })
    .eq('id', userId);
  if (error) return { success: false, error: 'generic' };
  await removeAvatarObject(supabase, previous);
  return { success: true, path: '' };
}
