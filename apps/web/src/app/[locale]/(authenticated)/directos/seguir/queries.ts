/**
 * F7B-P1 — Datos de la pantalla "Seguir equipos": todos los equipos del club
 * (temporada activa) con el flag de si el usuario los sigue. Seguir = recibir
 * push de goles de ese equipo. Respeta RLS (teams por club, team_follows propios).
 */

import { createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

export type FollowableTeam = {
  teamId: string;
  name: string;
  color: string;
  categoryName: string;
  following: boolean;
};

export async function loadFollowableTeams(
  clubId: string,
  profileId: string,
): Promise<FollowableTeam[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const season = await getActiveSeasonLabel(supabase, clubId);

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
