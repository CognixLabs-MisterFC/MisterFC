import {
  getAccountPlayersForProfile,
  type AccountPlayer,
  type AccountPlayerRelation,
} from '@misterfc/core';
import type { createSupabaseServerClient } from '@misterfc/core';

/**
 * Players vinculados a una cuenta (profile) vía `player_accounts`, en un club.
 *
 * O2-5 — La QUERY se extrajo a `@misterfc/core` (`getAccountPlayersForProfile` /
 * `getAccountPlayersFromClient`) para compartirla con la app nativa. Esto es un
 * WRAPPER de compatibilidad: MISMA firma y MISMO comportamiento (filtro club +
 * `erased_at`, orden por `created_at asc` → default determinista). Los
 * consumidores de web (`/mi-ficha`, `/mi-informe`, `/perfil`, `.../seguidores`)
 * no cambian.
 */
export type { AccountPlayer, AccountPlayerRelation };

export function loadAccountPlayers(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  profileId: string,
  clubId: string,
): Promise<AccountPlayer[]> {
  return getAccountPlayersForProfile(supabase, profileId, clubId);
}
