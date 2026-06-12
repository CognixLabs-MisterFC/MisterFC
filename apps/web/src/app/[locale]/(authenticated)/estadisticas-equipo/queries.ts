/**
 * F9.B-3 — Resolución de los equipos para los que el usuario puede ver
 * estadísticas agregadas, en la temporada ACTIVA del club.
 *
 *  - admin_club / coordinador → todos los equipos del club en la temporada activa.
 *  - entrenador_principal / ayudante → solo sus equipos (team_staff activo).
 *
 * Lectura; se apoya en la RLS existente (teams clubmate, team_staff). El detalle
 * (`/equipos/[teamId]/estadisticas`) consume `loadTeamSeasonStats` (9.B-0).
 */

import { createSupabaseServerClient, type Role } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

export type StatsTeamCard = {
  id: string;
  name: string;
  color: string;
  category_name: string;
  season: string;
};

const COACH_ROLES = new Set<Role>([
  'entrenador_principal',
  'entrenador_ayudante',
]);

/**
 * Equipos (temporada activa) cuyas stats agregadas puede ver el usuario.
 * Ordenados por nombre. Vacío si no hay ninguno.
 */
export async function loadStatsTeams(
  role: Role,
  membershipId: string,
  clubId: string
): Promise<StatsTeamCard[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);

  if (COACH_ROLES.has(role)) {
    type StaffTeam = {
      teams: {
        id: string;
        name: string;
        color: string;
        season: string;
        categories: { name: string; club_id: string };
      };
    };
    const { data } = await supabase
      .from('team_staff')
      .select(
        'teams!inner(id, name, color, season, categories!inner(name, club_id))'
      )
      .eq('membership_id', membershipId)
      .is('left_at', null);

    return ((data ?? []) as unknown as StaffTeam[])
      .map((s) => s.teams)
      .filter((t) => t.categories.club_id === clubId && t.season === activeSeason)
      .map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        category_name: t.categories.name,
        season: t.season,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  }

  // admin_club / coordinador → todos los equipos del club en la temporada activa.
  type TeamRow = {
    id: string;
    name: string;
    color: string;
    season: string;
    categories: { name: string };
  };
  const { data } = await supabase
    .from('teams')
    .select('id, name, color, season, categories!inner(name)')
    .eq('club_id', clubId)
    .eq('season', activeSeason)
    .order('name', { ascending: true });

  return ((data ?? []) as unknown as TeamRow[]).map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    category_name: t.categories.name,
    season: t.season,
  }));
}

/**
 * Guard del detalle: ¿este usuario puede ver las stats de ESTE equipo? El coach
 * solo sus equipos (team_staff activo); admin/coord cualquier equipo de su club
 * (el check de club lo hace la page con el resultado de loadTeamSeasonStats).
 */
export async function userStaffsTeam(
  membershipId: string,
  teamId: string
): Promise<boolean> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);
  const { data } = await supabase
    .from('team_staff')
    .select('id')
    .eq('membership_id', membershipId)
    .eq('team_id', teamId)
    .is('left_at', null)
    .maybeSingle();
  return data != null;
}
