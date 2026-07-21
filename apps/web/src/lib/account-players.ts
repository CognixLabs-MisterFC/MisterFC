import type { createSupabaseServerClient } from '@misterfc/core';

/**
 * Players vinculados a una cuenta (profile) vía `player_accounts`, en un club.
 *
 * Una cuenta puede estar vinculada a VARIOS players: `relation='self'` (ES el
 * jugador adulto) y/o `relation='parent'|'guardian'` (sus hijos/tutelados). Este
 * helper es la fuente ÚNICA de esa resolución para las pantallas de la cuenta
 * (`/mi-ficha`, `/mi-informe`, `/perfil`), de modo que todas coincidan en el
 * conjunto y en el ORDEN (orden determinista por `player_accounts.created_at`
 * ascendente → el "player por defecto" es siempre el mismo en todas ellas).
 *
 * Filtra al club activo y excluye players suprimidos (derecho al olvido, F14-7).
 */
export type AccountPlayerRelation = 'self' | 'parent' | 'guardian';

export type AccountPlayer = {
  id: string;
  name: string;
  relation: AccountPlayerRelation;
};

export async function loadAccountPlayers(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  profileId: string,
  clubId: string,
): Promise<AccountPlayer[]> {
  const { data } = await supabase
    .from('player_accounts')
    .select(
      'player_id, relation, players!inner(id, club_id, first_name, last_name, erased_at)',
    )
    // Orden determinista: el vínculo más antiguo primero. Así el default
    // (primer elemento) es estable entre /mi-ficha y /perfil.
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
    .filter(
      (p) => p.players.club_id === clubId && p.players.erased_at == null,
    )
    .map((p) => ({
      id: p.players.id,
      name: `${p.players.first_name} ${p.players.last_name ?? ''}`.trim(),
      relation: p.relation,
    }));
}
