import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { formatPlayerNameNatural } from '../utils/name';
import { PLAYER_PHOTO_SIGN_TTL_SECONDS } from '../player-profile/sensitive';

/**
 * Imagen-2 — Lo que hace falta para PINTAR el aviso `image_consent_revoked` que
 * escribe el trigger de Imagen-1 (migs 20261087/20261088): el nombre del jugador y
 * LA FOTO de su ficha.
 *
 * Por qué hace falta resolverlo aquí y no viene en el aviso: el payload lleva solo
 * ids (`player_id`, `club_id`, `consent_type`) porque `notifications.payload` es
 * inmutable por trigger (BC-7a). Un nombre escrito ahí no se podría limpiar al
 * anonimizar, y el aviso acabaría siendo el último rastro de un menor borrado. Así
 * que el nombre y la foto se resuelven EN LECTURA, cada vez que se pinta la fila:
 * si el jugador desaparece, el aviso se queda genérico y no queda rastro de nadie.
 *
 * Por qué la foto y no solo el texto: dentro de MisterFC un jugador tiene
 * EXACTAMENTE una foto suya, la de su ficha (medido: no hay otra columna de imagen
 * de persona en todo el esquema). El club no tiene que buscar qué retirar — se le
 * enseña, y el aviso lleva a donde se quita.
 *
 * Quién puede ver qué NO lo decide este helper: lo deciden la RLS de `players` y la
 * policy del bucket privado `player-photos`. A quien no alcance, la fila le sale sin
 * nombre y sin foto (texto genérico, que sigue siendo cierto), nunca con un error.
 */

type DbClient = SupabaseClient<Database>;

/** `notification_type` del aviso de retirada del permiso de imagen (Imagen-1). */
export const IMAGE_CONSENT_REVOKED = 'image_consent_revoked';

/** Jugador de un aviso de retirada, resuelto en lectura. */
export type ImageConsentPlayer = {
  playerId: string;
  /** "Nombre Apellido" (orden natural: la fila se lee, no se ordena). */
  name: string;
  /** URL FIRMADA de la foto de la ficha (TTL corto), o null si no hay o no alcanza. */
  photoUrl: string | null;
};

/** Jugadores resueltos, por `player_id`. */
export type ImageConsentPlayers = ReadonlyMap<string, ImageConsentPlayer>;

/** Mapa vacío reutilizable: evita construir uno por render cuando no hay avisos. */
export const NO_IMAGE_CONSENT_PLAYERS: ImageConsentPlayers = new Map();

function asRecord(payload: unknown): Record<string, unknown> | null {
  return payload != null && typeof payload === 'object' && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

/** `player_id` del payload de un aviso de retirada, o undefined. */
export function imageConsentPlayerId(type: string, payload: unknown): string | undefined {
  if (type !== IMAGE_CONSENT_REVOKED) return undefined;
  const v = asRecord(payload)?.player_id;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Ids de jugador de las filas de retirada de una página de feed, SIN repetir.
 * Vacío (lo normal) → el caller se ahorra la consulta entera.
 */
export function imageConsentPlayerIds(
  rows: readonly { type: string; payload: unknown }[],
): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const id = imageConsentPlayerId(row.type, row.payload);
    if (id) ids.add(id);
  }
  return [...ids];
}

/**
 * Resuelve nombre + foto firmada de los jugadores de los avisos de retirada.
 *
 * Una consulta y una firma EN LOTE para toda la página del feed, y solo si hay
 * avisos de este tipo: el feed se pinta en cada carga de Inicio y no puede pagar una
 * consulta por fila. Los ids que la RLS no deje leer simplemente no salen en el mapa.
 */
export async function loadImageConsentPlayersFromClient(
  supabase: DbClient,
  playerIds: readonly string[],
  ttlSeconds: number = PLAYER_PHOTO_SIGN_TTL_SECONDS,
): Promise<ImageConsentPlayers> {
  if (playerIds.length === 0) return NO_IMAGE_CONSENT_PLAYERS;

  const { data: rows } = await supabase
    .from('players')
    .select('id, first_name, last_name, photo_url')
    .in('id', [...playerIds]);
  if (!rows || rows.length === 0) return NO_IMAGE_CONSENT_PLAYERS;

  // Firma en lote de las que tienen foto. Si la firma falla, la fila se queda con
  // nombre y sin foto: el aviso sigue siendo útil.
  const paths = rows
    .map((r) => r.photo_url)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  const signed = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signedList } = await supabase.storage
      .from('player-photos')
      .createSignedUrls(paths, ttlSeconds);
    for (const s of signedList ?? []) {
      if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl);
    }
  }

  const out = new Map<string, ImageConsentPlayer>();
  for (const r of rows) {
    out.set(r.id, {
      playerId: r.id,
      name: formatPlayerNameNatural(r.first_name, r.last_name),
      photoUrl: r.photo_url ? (signed.get(r.photo_url) ?? null) : null,
    });
  }
  return out;
}

/**
 * Payload del aviso + `player_name` resuelto, para que `notificationFeedText` pueda
 * decir de quién es sin que ese nombre se haya guardado nunca en la fila (BC-7a).
 * Devuelve el payload TAL CUAL si no es un aviso de retirada o si no hay jugador.
 */
export function withImageConsentPlayerName(
  type: string,
  payload: unknown,
  players: ImageConsentPlayers,
): unknown {
  const id = imageConsentPlayerId(type, payload);
  if (!id) return payload;
  const player = players.get(id);
  if (!player || player.name.length === 0) return payload;
  return { ...(asRecord(payload) ?? {}), player_name: player.name };
}

/** Jugador (nombre + foto) de una fila de aviso, o null si no es de este tipo. */
export function imageConsentPlayerOf(
  type: string,
  payload: unknown,
  players: ImageConsentPlayers,
): ImageConsentPlayer | null {
  const id = imageConsentPlayerId(type, payload);
  return id ? (players.get(id) ?? null) : null;
}
