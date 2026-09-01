/**
 * F14 — Qué jugadores de un conjunto están "Sin app" (Slices B y C: roster de
 * equipo y detalle de convocatoria).
 *
 * La REGLA vive una sola vez en `family-link.ts` (`hasLinkedFamily`); esto es solo
 * el FETCH del único hecho que la alimenta: `player_accounts`. UNA query.
 *
 * POR QUÉ UNA FUNCIÓN APARTE Y NO UN EMBED EN LOS LOADERS EXISTENTES:
 * los loaders de roster (`getTeamRosterStatsFromClient`) y de convocatoria los
 * COMPARTEN staff y FAMILIA. Un embed dentro de ellos engordaría también la lectura
 * de la familia (listas largas: plantilla del equipo) para pintar algo que la
 * familia NO ve. Con una consulta aparte, el que no pinta marcador no la llama y su
 * query queda EXACTAMENTE como estaba.
 *
 * QUIÉN PUEDE LLAMARLA: pantallas de STAFF/DIRECCIÓN. La RLS de `player_accounts`
 * solo deja leer al staff del club (admin/director/entrenadores) o al coordinador
 * del equipo; un tutor solo ve las cuentas de SUS hijos, así que desde una pantalla
 * de familia el resultado sería falso (todos "Sin app"). Es una razón más para no
 * llamarla desde ahí.
 *
 * DEVUELVE los ids SIN app (no un mapa de todos): así, si la query falla o la RLS
 * tapa filas, la lista sale vacía y NO se pinta marcador — mejor no decir nada que
 * marcar a quien sí tiene app. Y es JSON puro, que la caché offline de la app
 * serializa sin traducción.
 *
 * SOLO PRESENTACIÓN: nada gatea convocatoria/asistencia/estadísticas por esto.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { hasLinkedFamily } from './family-link';

type DbClient = SupabaseClient<Database>;

/** ids de jugadores cuya familia NO ha entrado en la app (marcador "Sin app"). */
export type PlayersWithoutApp = string[];

export async function getPlayersWithoutAppFromClient(
  supabase: DbClient,
  playerIds: readonly string[],
  /** Sumidero de errores del caller (native: Sentry), como el resto de loaders. */
  onError?: (err: unknown) => void,
): Promise<PlayersWithoutApp> {
  if (playerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('players')
    .select('id, player_accounts(profile_id)')
    .in('id', playerIds as string[]);
  if (error) onError?.(error);

  type Row = { id: string; player_accounts: Array<{ profile_id: string }> | null };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => !hasLinkedFamily(r.player_accounts))
    .map((r) => r.id);
}

/**
 * Igual, pero para el ROSTER ACTIVO de un equipo, sin necesitar los ids antes:
 * `team_members` (activos, mismo filtro que `getTeamRosterStatsFromClient`) →
 * `players` → `player_accounts`. UNA query.
 *
 * Existe además de la versión por ids porque las pantallas nativas de roster
 * cachean esta lectura POR EQUIPO, en una entrada aparte de la del roster: así la
 * pantalla que NO pinta marcador (plantilla de familia) no cambia ni una query.
 */
export async function getTeamPlayersWithoutAppFromClient(
  supabase: DbClient,
  teamId: string,
  onError?: (err: unknown) => void,
): Promise<PlayersWithoutApp> {
  const { data, error } = await supabase
    .from('team_members')
    .select('player_id, players!inner(id, player_accounts(profile_id))')
    .eq('team_id', teamId)
    .is('left_at', null);
  if (error) onError?.(error);

  type Row = {
    player_id: string;
    players: { player_accounts: Array<{ profile_id: string }> | null };
  };

  return ((data ?? []) as unknown as Row[])
    .filter((r) => !hasLinkedFamily(r.players.player_accounts))
    .map((r) => r.player_id);
}
