import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';

/**
 * Las NOTAS del cuerpo técnico sobre un jugador (`player_notes`): lo que un
 * entrenador apunta de un crío —«empieza a mirar antes de recibir», «viene
 * tocado del tobillo»— y que lee el resto del cuerpo técnico de su equipo.
 *
 * La tabla SÍ es legible por el cliente (a diferencia de `player_medical`), y la
 * RLS es la autoridad: `user_can_access_player_notes` = admin/director del club o
 * cuerpo técnico ACTUAL del jugador. Familia no entra, ni el propio jugador.
 *
 * Y justo por eso la lectura no puede ser un `select` a secas. Quien no pasa la
 * RLS no recibe un error: recibe CERO FILAS, que es exactamente lo mismo que
 * recibe un entrenador cuyo jugador todavía no tiene ninguna nota. Las dos cosas
 * pintadas igual dicen «sin notas todavía» a quien en realidad no tiene acceso —y,
 * peor, le dirían lo mismo si la consulta se hubiera roto. Por eso se pregunta por
 * la puerta APARTE, y el resultado distingue tres cosas:
 *
 *   ok:true      → hay acceso; `notes` vacío significa que no hay notas,
 *   forbidden    → quien mira no es cuerpo técnico de este jugador: no se pinta,
 *   error        → algo se rompió: la pantalla lo DICE, no finge un vacío.
 *
 * Es la misma figura que `getPlayerContactFromClient` (player-contact/reads), y lo
 * es a propósito: las dos superficies reservadas de la ficha responden igual.
 */
type DbClient = SupabaseClient<Database>;

export type PlayerNote = {
  id: string;
  note: string;
  /** ISO, tal y como viene de la columna `created_at`. La pinta el caller. */
  createdAt: string;
  /** Quien la escribió. Puede ser null si el perfil ya no es legible. */
  authorName: string | null;
};

export type PlayerNotesResult =
  | { ok: true; notes: PlayerNote[] }
  | { ok: false; reason: 'forbidden' | 'error' };

/** Forma de la fila con el autor embebido. PostgREST la devuelve como objeto. */
type NoteRow = {
  id: string;
  note: string;
  created_at: string;
  profiles: { full_name: string | null } | null;
};

/**
 * Notas de un jugador, de la más reciente a la más antigua.
 *
 * La PUERTA y las FILAS se piden A LA VEZ. Podrían encadenarse —preguntar, y solo
 * entonces leer—, que es lo que hace la web; aquí van en paralelo porque esto lo
 * consume una ficha que se abre en un campo de fútbol, donde el segundo viaje de
 * ida y vuelta se nota. El coste de equivocarse es una consulta tirada para quien
 * no tiene acceso, y esa consulta no le devuelve nada: la RLS es la misma.
 *
 * Lo que NO se puede hacer es al revés —deducir la puerta de las filas—, que es
 * de donde viene todo el comentario de arriba.
 */
export async function getPlayerNotesFromClient(
  supabase: DbClient,
  playerId: string,
): Promise<PlayerNotesResult> {
  const [gate, rows] = await Promise.all([
    supabase.rpc('user_can_access_player_notes', { p_player_id: playerId }),
    supabase
      .from('player_notes')
      .select('id, note, created_at, profiles!player_notes_author_profile_id_fkey(full_name)')
      .eq('player_id', playerId)
      .order('created_at', { ascending: false }),
  ]);

  if (gate.error) return { ok: false, reason: 'error' };
  if (!gate.data) return { ok: false, reason: 'forbidden' };
  if (rows.error) return { ok: false, reason: 'error' };

  const notes = ((rows.data ?? []) as unknown as NoteRow[]).map((r) => ({
    id: r.id,
    note: r.note,
    createdAt: r.created_at,
    authorName: r.profiles?.full_name ?? null,
  }));
  return { ok: true, notes };
}
