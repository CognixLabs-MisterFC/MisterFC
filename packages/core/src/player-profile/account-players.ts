import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';

/** Cliente supabase-js tipado con el schema del proyecto. */
type DbClient = SupabaseClient<Database>;

/**
 * O2-5 — Players vinculados a una cuenta (profile) vía `player_accounts`.
 *
 * Extraído a core desde `apps/web/src/lib/account-players.ts` (que ahora es un
 * wrapper): la QUERY vive aquí para que web y la app nativa compartan EXACTAMENTE
 * el mismo select/filtro/orden. Sigue el patrón `getXFromClient` de
 * `auth/current-user.ts`.
 *
 * Una cuenta puede vincularse a VARIOS players: `relation='self'` (ES el jugador
 * adulto) y/o `relation='parent'|'guardian'` (hijos/tutelados). Orden DETERMINISTA
 * por `player_accounts.created_at` ascendente → el "player por defecto" (primer
 * elemento) es siempre el mismo en todas las pantallas de la cuenta. Filtra al
 * club dado y excluye players suprimidos (derecho al olvido, F14-7).
 */
export type AccountPlayerRelation = 'self' | 'parent' | 'guardian';

export type AccountPlayer = {
  id: string;
  name: string;
  relation: AccountPlayerRelation;
};

/** Query compartida (idéntica a la histórica de apps/web). Perfil explícito. */
async function fetchAccountPlayers(
  supabase: DbClient,
  profileId: string,
  clubId: string
): Promise<AccountPlayer[]> {
  const { data } = await supabase
    .from('player_accounts')
    .select(
      'player_id, relation, players!inner(id, club_id, first_name, last_name, erased_at)'
    )
    // Orden determinista: el vínculo más antiguo primero → default estable.
    .order('created_at', { ascending: true })
    .eq('profile_id', profileId);

  type PA = {
    player_id: string;
    relation: AccountPlayerRelation;
    players: {
      id: string;
      club_id: string;
      first_name: string;
      last_name: string | null;
      erased_at: string | null;
    };
  };

  return ((data ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === clubId && p.players.erased_at == null)
    .map((p) => ({
      id: p.players.id,
      name: `${p.players.first_name} ${p.players.last_name ?? ''}`.trim(),
      relation: p.relation,
    }));
}

/**
 * Players de la cuenta a partir de un `profileId` explícito. Lo usa `apps/web`
 * (ya tiene el `ctx.user.id`), preservando su comportamiento sin un `getUser()`
 * extra.
 */
export function getAccountPlayersForProfile(
  supabase: DbClient,
  profileId: string,
  clubId: string
): Promise<AccountPlayer[]> {
  return fetchAccountPlayers(supabase, profileId, clubId);
}

/**
 * Players de la cuenta del usuario AUTENTICADO en un club (variante agnóstica
 * para apps/native). Resuelve el user con `getCurrentUserFromClient` (patrón de
 * las demás `*FromClient`); `[]` si no hay sesión.
 */
export async function getAccountPlayersFromClient(
  supabase: DbClient,
  clubId: string
): Promise<AccountPlayer[]> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return [];
  return fetchAccountPlayers(supabase, user.id, clubId);
}
