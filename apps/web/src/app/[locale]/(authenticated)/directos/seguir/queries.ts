/**
 * F7B-P1 — "Seguir equipos". O2-5 B1: la query se extrajo a core
 * (`getFollowableTeamsForProfile`); esto es un wrapper de compatibilidad, misma
 * firma y comportamiento.
 */

import {
  createSupabaseServerClient,
  getFollowableTeamsForProfile,
  type FollowableTeam,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

export type { FollowableTeam };

export async function loadFollowableTeams(
  clubId: string,
  profileId: string,
): Promise<FollowableTeam[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  return getFollowableTeamsForProfile(supabase, clubId, profileId);
}
