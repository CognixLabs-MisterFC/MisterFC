import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';

/**
 * O2-5 C1 — Seguidores (espectadores) de un jugador. Extraído de
 * `apps/web/.../mi-ficha/seguidores/page.tsx` (listado) y de la acción
 * `removeSpectatorForPlayer` (jugadores/actions.ts). El gate tutor/self lo imponen
 * los RPC SECURITY DEFINER (list_player_spectators / remove_spectator); aquí solo
 * se llama y se mapea. INVITAR no se extrae: su envío de email es server-only
 * (admin client) y no aplica a la app (C1: listar + revocar).
 */
type DbClient = SupabaseClient<Database>;

/** Fila del listado de seguidores (forma cruda del RPC list_player_spectators). */
export type PlayerSpectator = {
  spectator_profile_id: string;
  full_name: string;
  email: string;
  created_at: string;
};

export async function getPlayerSpectatorsFromClient(
  supabase: DbClient,
  playerId: string
): Promise<PlayerSpectator[]> {
  const { data } = await supabase.rpc('list_player_spectators', {
    p_player_id: playerId,
  });
  return (data ?? []) as PlayerSpectator[];
}

export type RemoveSpectatorResult =
  | { ok: true }
  | { error: 'forbidden' }
  | { error: 'generic'; raw: unknown };

/**
 * Revoca un seguidor de un jugador vía RPC `remove_spectator` (gate tutor/self en
 * la DB). Mapea el error a forbidden/generic; en generic devuelve el error crudo
 * (`raw`) para que el caller lo registre (web: Sentry). Escritura → write-guard en
 * el caller nativo.
 */
export async function removeSpectatorFromClient(
  supabase: DbClient,
  playerId: string,
  spectatorProfileId: string
): Promise<RemoveSpectatorResult> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { error: 'forbidden' };

  const { error } = await supabase.rpc('remove_spectator', {
    p_player_id: playerId,
    p_spectator_profile_id: spectatorProfileId,
  });

  if (error) {
    const msg = error.message?.toLowerCase() ?? '';
    if (msg.includes('forbidden') || msg.includes('no_session')) {
      return { error: 'forbidden' };
    }
    return { error: 'generic', raw: error };
  }
  return { ok: true };
}
