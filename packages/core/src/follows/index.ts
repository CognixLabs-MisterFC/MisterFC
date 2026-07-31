import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import { getCurrentUserFromClient } from '../auth/current-user';
import { getActiveSeasonLabelFromClient } from '../season/active-season';

/**
 * O2-5 B1 — "Seguir equipos" (F7B-P1), extraído de `apps/web/.../directos/seguir`.
 * Seguir = recibir push de goles del equipo. Lectura: equipos del club (temporada
 * activa) + flag de seguimiento propio. Escritura: toggle en `team_follows` (RLS
 * with-check garantiza propio + equipo del club).
 */
type DbClient = SupabaseClient<Database>;

export type FollowableTeam = {
  teamId: string;
  name: string;
  color: string;
  categoryName: string;
  following: boolean;
};

async function fetchFollowableTeams(
  supabase: DbClient,
  clubId: string,
  profileId: string
): Promise<FollowableTeam[]> {
  const season = await getActiveSeasonLabelFromClient(supabase, clubId);

  const { data: teamRows } = await supabase
    .from('teams')
    .select('id, name, color, categories!inner(name)')
    .eq('club_id', clubId)
    .eq('season', season)
    .order('name', { ascending: true });

  type TeamShape = {
    id: string;
    name: string;
    color: string;
    categories: { name: string };
  };
  const teams = (teamRows ?? []) as unknown as TeamShape[];
  if (teams.length === 0) return [];

  const { data: followRows } = await supabase
    .from('team_follows')
    .select('team_id')
    .eq('profile_id', profileId);
  const followed = new Set((followRows ?? []).map((r) => r.team_id as string));

  return teams.map((t) => ({
    teamId: t.id,
    name: t.name,
    color: t.color,
    categoryName: t.categories.name,
    following: followed.has(t.id),
  }));
}

/** Web (profileId explícito). */
export function getFollowableTeamsForProfile(
  supabase: DbClient,
  clubId: string,
  profileId: string
): Promise<FollowableTeam[]> {
  return fetchFollowableTeams(supabase, clubId, profileId);
}

/** Native (usuario autenticado). */
export async function getFollowableTeamsFromClient(
  supabase: DbClient,
  clubId: string
): Promise<FollowableTeam[]> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return [];
  return fetchFollowableTeams(supabase, clubId, user.id);
}

export type SetFollowResult =
  | { ok: true; following: boolean }
  | { error: 'forbidden' | 'generic' };

/**
 * Seguir/dejar de seguir un equipo (usuario autenticado). Upsert idempotente /
 * delete; la with-check RLS bloquea equipos de otro club (→ 'forbidden').
 */
export async function setTeamFollowFromClient(
  supabase: DbClient,
  teamId: string,
  follow: boolean
): Promise<SetFollowResult> {
  const user = await getCurrentUserFromClient(supabase);
  if (!user) return { error: 'forbidden' };

  if (follow) {
    const { error } = await supabase
      .from('team_follows')
      .upsert(
        { profile_id: user.id, team_id: teamId },
        { onConflict: 'profile_id,team_id', ignoreDuplicates: true }
      );
    if (error) return { error: 'forbidden' };
    return { ok: true, following: true };
  }

  const { error } = await supabase
    .from('team_follows')
    .delete()
    .eq('profile_id', user.id)
    .eq('team_id', teamId);
  if (error) return { error: 'generic' };
  return { ok: true, following: false };
}
