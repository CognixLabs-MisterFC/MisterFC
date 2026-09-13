import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * O2-5 C2 — GESTIÓN SENSIBLE del hijo (foto · datos médicos · derecho al olvido),
 * extraída de apps/web:
 *   - foto:   `jugadores/actions.ts` (set/clear vía RPC `set_player_photo`)
 *   - médica: `mi-ficha/medical-actions.ts` (`set_player_medical`) + lectura
 *             `get_player_medical` y gates (`perfil/page.tsx`)
 *   - olvido: `mi-ficha/erasure-actions.ts` (`request_player_erasure`) — SOLICITUD
 *
 * Todas las escrituras pasan OBLIGATORIAMENTE por RPC SECURITY DEFINER: player_medical
 * y players.photo_url están cerradas al cliente; la RPC valida el helper que le toca
 * (MN-1: `user_manages_player` la foto, `user_manages_player_sensitive` la médica, más
 * el consentimiento de escritura) y la auditoría la ponen los triggers.
 * Aquí solo se invoca y se mapea el error. El write-guard (sin conexión) es del caller.
 *
 * El EXPEDIENTE PDF NO se extrae: se genera en un Route Handler server-side (sesión
 * cookie del tutor + `record_data_export`); la app no puede invocarlo con su sesión
 * token y duplicar la generación está prohibido. Requiere infra server (follow-up).
 */
type DbClient = SupabaseClient<Database>;

/** Resultado común de una escritura sensible. `forbidden` = la RPC rechazó (no tutor /
 * sin consentimiento); `generic` acarrea el error crudo para que el caller lo registre. */
export type SensitiveWriteResult =
  | { ok: true }
  | { error: 'forbidden' }
  | { error: 'generic'; raw: unknown };

function mapWriteError(error: { message?: string } | null): SensitiveWriteResult {
  if (!error) return { ok: true };
  const msg = (error.message ?? '').toLowerCase();
  if (msg.includes('forbidden')) return { error: 'forbidden' };
  return { error: 'generic', raw: error };
}

// ── Gates de gestión ────────────────────────────────────────────────────────

/**
 * MN-6 — Permisos de gestión del jugador activo, para condicionar la UI.
 *
 * Son TRES, y no uno, porque en la base de datos son tres. MN-1 partió la
 * superficie en dos —COMPARTIDA y RESERVADA— y dejó 18 objetos apuntando a un
 * helper o al otro; esto es el espejo exacto de ese reparto:
 *
 *   canManage          → `user_manages_player`            (tutor O el jugador)
 *                        foto · seguidores · contacto de los tutores
 *   canManageSensitive → `user_manages_player_sensitive`  (tutor; el jugador SOLO
 *                        si ya es mayor de edad)
 *                        médica · supresión del jugador · export RGPD · consentimientos
 *   canWriteMedical    → lo anterior Y consentimiento de escritura vigente
 *
 * ANTES ERA UN SOLO BOOLEANO, `isTutor`, y salía de `user_is_tutor_of_player`. Al
 * estrechar MN-1 ese helper a parent/guardian, el booleano se llevó por delante al
 * JUGADOR ADULTO de su propia ficha: la 20261038 existe justamente para que gestione
 * lo suyo, y el SQL se lo sigue permitiendo, pero la interfaz dejó de pintárselo. Un
 * solo nombre no podía responder a dos preguntas distintas.
 *
 * Y preguntar por `user_manages_player_sensitive` en vez de por la edad tiene un
 * efecto que sale gratis: la regla «al cumplir 18 se abre solo» vale también para la
 * interfaz, sin trigger, sin cron y sin nada que recordar.
 */
export type PlayerManagementAccess = {
  /** Superficie COMPARTIDA: foto, seguidores, contacto. */
  canManage: boolean;
  /** Superficie RESERVADA: médica, supresión, export RGPD, consentimientos. */
  canManageSensitive: boolean;
  /** RESERVADA + consentimiento de escritura médica vigente. */
  canWriteMedical: boolean;
};

export async function getPlayerManagementAccessFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<PlayerManagementAccess> {
  const [{ data: manages }, { data: sensitive }, { data: medicalConsent }] =
    await Promise.all([
      supabase.rpc('user_manages_player', { p_player_id: playerId }),
      supabase.rpc('user_manages_player_sensitive', { p_player_id: playerId }),
      supabase.rpc('user_has_medical_consent_write', { p_player_id: playerId }),
    ]);
  const canManageSensitive = Boolean(sensitive);
  return {
    canManage: Boolean(manages),
    canManageSensitive,
    // El consentimiento NO abre por sí solo la médica: sin la superficie reservada
    // no hay escritura, y `set_player_medical` exige las dos cosas.
    canWriteMedical: canManageSensitive && Boolean(medicalConsent),
  };
}

// ── Datos médicos ─────────────────────────────────────────────────────────────

/** Los 4 campos médicos (todos opcionales). Cerrados al cliente: se leen por la RPC
 * `get_player_medical` (gate de LECTURA propio) y se escriben por `set_player_medical`. */
export type PlayerMedical = {
  allergies: string | null;
  medication: string | null;
  medical_conditions: string | null;
  emergency_contact: string | null;
};

export async function getPlayerMedicalFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<PlayerMedical | null> {
  const { data } = await supabase.rpc('get_player_medical', {
    p_player_id: playerId,
    p_ip: undefined,
    p_user_agent: undefined,
  });
  const row = data?.[0];
  if (!row) return null;
  return {
    allergies: row.allergies ?? null,
    medication: row.medication ?? null,
    medical_conditions: row.medical_conditions ?? null,
    emergency_contact: row.emergency_contact ?? null,
  };
}

/** Normaliza un campo médico igual que el web (trim, vacío → null, tope 2000). */
function cleanMedicalField(v: string | null): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 2000) : null;
}

export async function setPlayerMedicalFromClient(
  supabase: DbClient,
  playerId: string,
  fields: PlayerMedical,
): Promise<SensitiveWriteResult> {
  const { error } = await supabase.rpc('set_player_medical', {
    p_player_id: playerId,
    // La firma tipa los campos como string, pero la RPC acepta NULL (el web pasa null).
    p_allergies: cleanMedicalField(fields.allergies) as unknown as string,
    p_medication: cleanMedicalField(fields.medication) as unknown as string,
    p_medical_conditions: cleanMedicalField(fields.medical_conditions) as unknown as string,
    p_emergency_contact: cleanMedicalField(fields.emergency_contact) as unknown as string,
  });
  return mapWriteError(error);
}

// ── Foto del jugador ───────────────────────────────────────────────────────────

/** TTL por defecto de la URL firmada de la foto (10 min; misma que el uploader web). */
export const PLAYER_PHOTO_SIGN_TTL_SECONDS = 600;

/** Lee la ruta de la foto en Storage (`players.photo_url`), o null. La firma el caller. */
export async function getPlayerPhotoPathFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('players')
    .select('photo_url')
    .eq('id', playerId)
    .maybeSingle();
  return data?.photo_url ?? null;
}

/** Firma la ruta del bucket privado `player-photos` (TTL corto). null si no hay/falla. */
export async function signPlayerPhotoFromClient(
  supabase: DbClient,
  path: string,
  ttlSeconds: number = PLAYER_PHOTO_SIGN_TTL_SECONDS,
): Promise<string | null> {
  const { data } = await supabase.storage
    .from('player-photos')
    .createSignedUrl(path, ttlSeconds);
  return data?.signedUrl ?? null;
}

/**
 * Elimina un objeto del bucket de fotos, BEST-EFFORT.
 *
 * Va DESPUÉS de la RPC y nunca la revierte: si el borrado falla, lo que el tutor pidió
 * ya está aplicado y solo queda un huérfano. Mismo criterio que `decidePlayerErasureFromClient`,
 * que también borra el objeto fuera de la transacción porque `storage.protect_delete`
 * impide hacerlo por SQL.
 *
 * No hace falta service-role: `player_photos_delete_tutor` deja borrar al mismo tutor
 * que ya puede subir y reemplazar.
 */
async function removePhotoObject(supabase: DbClient, path: string | null): Promise<void> {
  if (!path) return;
  try {
    await supabase.storage.from('player-photos').remove([path]);
  } catch {
    // Huérfano en el bucket, nada más. La columna ya está bien.
  }
}

/** Ruta que tiene guardada la foto ahora mismo (para poder borrar el objeto viejo). */
async function currentPhotoPath(supabase: DbClient, playerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('players')
    .select('photo_url')
    .eq('id', playerId)
    .maybeSingle();
  // Si no se puede leer, NO se borra nada: preferimos un huérfano a borrar de más.
  if (error) return null;
  return data?.photo_url ?? null;
}

/** Persiste la ruta de la foto tras subirla al bucket (RPC `set_player_photo`, gate tutor).
 * Valida que el path cuelga de `<playerId>/` (defensa; la RLS de storage ya lo impone).
 * Cambiar de foto sube un objeto NUEVO, así que el anterior se retira aquí. */
export async function setPlayerPhotoPathFromClient(
  supabase: DbClient,
  playerId: string,
  path: string,
): Promise<SensitiveWriteResult> {
  if (!path || !path.startsWith(`${playerId}/`) || path.length > 200) {
    return { error: 'forbidden' };
  }
  const previous = await currentPhotoPath(supabase, playerId);
  const { error } = await supabase.rpc('set_player_photo', {
    p_player_id: playerId,
    p_path: path,
  });
  const result = mapWriteError(error);
  // Solo si la RPC fue bien y la ruta CAMBIÓ.
  if (!error && previous && previous !== path) await removePhotoObject(supabase, previous);
  return result;
}

/**
 * Retira la foto: `photo_url` → NULL **y** borra el objeto del bucket.
 *
 * La pantalla dice "quitar foto" y quien la pulsa entiende que la foto desaparece; si
 * solo se desreferenciaba, el fichero seguía vivo en Storage.
 */
export async function clearPlayerPhotoFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<SensitiveWriteResult> {
  const previous = await currentPhotoPath(supabase, playerId);
  const { error } = await supabase.rpc('set_player_photo', {
    p_player_id: playerId,
    p_path: null as unknown as string,
  });
  const result = mapWriteError(error);
  if (!error) await removePhotoObject(supabase, previous);
  return result;
}

// ── Derecho al olvido (SOLICITUD) ───────────────────────────────────────────────

/** Crea una SOLICITUD de supresión del jugador (RPC `request_player_erasure`, idempotente).
 * NO borra nada: la aprobación la toma admin_club/director. El caller confirma dos veces. */
export async function requestPlayerErasureFromClient(
  supabase: DbClient,
  playerId: string,
  reason: string | null,
): Promise<SensitiveWriteResult> {
  const trimmed = reason && reason.trim().length > 0 ? reason.trim().slice(0, 500) : undefined;
  const { error } = await supabase.rpc('request_player_erasure', {
    p_player_id: playerId,
    p_reason: trimmed,
  });
  return mapWriteError(error);
}
