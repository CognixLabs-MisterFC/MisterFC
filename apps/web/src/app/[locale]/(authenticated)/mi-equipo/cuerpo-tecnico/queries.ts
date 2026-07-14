/**
 * E-7b — Vista LIGERA del cuerpo técnico (read-only) para jugador/entrenador.
 * Por cada equipo del usuario, sus miembros de staff con SOLO nombre + rol
 * (staff_role). SIN contacto (es para jugadores, posibles menores), SIN gestión.
 *
 * "Sus equipos" = UNIÓN de:
 *  - jugador: player_accounts (profile→player) → team_members (player→teams)
 *  - entrenador: team_staff propio (profile_id+club_id)
 * (un usuario podría ser ambos). Temporada activa, filas activas (left_at null).
 *
 * Lectura vía team_staff: la RLS `team_staff_select_member` ya permite a cualquier
 * miembro del club leer el staff. Sin migración.
 */

import {
  createSupabaseServerClient,
  teamsInActiveSeason,
  type TeamStaffRole,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

export type LightStaffMember = {
  team_staff_id: string;
  full_name: string;
  staff_role: TeamStaffRole;
};

export type LightTeamStaff = {
  team_id: string;
  team_name: string;
  team_color: string;
  members: LightStaffMember[];
};

export async function loadLightTeamStaff(
  clubId: string,
  profileId: string,
): Promise<LightTeamStaff[]> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const teamIds = new Set<string>();

  // (a) como jugador: player_accounts → team_members.
  const { data: pas } = await supabase
    .from('player_accounts')
    .select('player_id, players!inner(id, club_id)')
    .eq('profile_id', profileId);
  type PA = { player_id: string; players: { id: string; club_id: string } };
  const myPlayerIds = ((pas ?? []) as unknown as PA[])
    .filter((p) => p.players.club_id === clubId)
    .map((p) => p.player_id);
  if (myPlayerIds.length > 0) {
    const { data: tm } = await supabase
      .from('team_members')
      .select('team_id')
      .in('player_id', myPlayerIds)
      .is('left_at', null);
    for (const r of tm ?? []) teamIds.add(r.team_id as string);
  }

  // (b) como entrenador: team_staff propio.
  type StaffMine = {
    team_id: string;
    memberships: { profile_id: string; club_id: string };
  };
  const { data: mine } = await supabase
    .from('team_staff')
    .select('team_id, memberships!inner(profile_id, club_id)')
    .is('left_at', null);
  for (const row of (mine ?? []).map((r) => r as unknown as StaffMine)) {
    if (
      row.memberships.profile_id === profileId &&
      row.memberships.club_id === clubId
    ) {
      teamIds.add(row.team_id);
    }
  }

  if (teamIds.size === 0) return [];

  // Equipos (temporada activa) con nombre/color.
  type TeamRow = {
    id: string;
    name: string;
    color: string;
    season: string;
    categories: { club_id: string };
  };
  const { data: teamsRaw } = await supabase
    .from('teams')
    .select('id, name, color, season, categories!inner(club_id)')
    .in('id', [...teamIds]);
  const activeSeason = await getActiveSeasonLabel(supabase, clubId);
  const teams = teamsInActiveSeason(
    ((teamsRaw ?? []) as unknown as TeamRow[]).filter(
      (t) => t.categories.club_id === clubId,
    ),
    activeSeason,
  );
  if (teams.length === 0) return [];
  const activeTeamIds = teams.map((t) => t.id);

  // Staff activo de esos equipos → nombre + rol (sin contacto).
  type StaffJoin = {
    id: string;
    team_id: string;
    staff_role: TeamStaffRole;
    memberships: { profiles: { full_name: string | null } };
  };
  const { data: staffRaw } = await supabase
    .from('team_staff')
    .select(
      'id, team_id, staff_role, memberships!inner(profiles!inner(full_name))',
    )
    .in('team_id', activeTeamIds)
    .is('left_at', null);
  const staff = (staffRaw ?? []).map((r) => r as unknown as StaffJoin);

  const byTeam = new Map<string, LightStaffMember[]>();
  for (const s of staff) {
    const list = byTeam.get(s.team_id) ?? [];
    list.push({
      team_staff_id: s.id,
      full_name: s.memberships.profiles.full_name ?? '—',
      staff_role: s.staff_role,
    });
    byTeam.set(s.team_id, list);
  }

  return teams
    .map((t) => ({
      team_id: t.id,
      team_name: t.name,
      team_color: t.color,
      members: (byTeam.get(t.id) ?? []).sort((a, b) =>
        a.full_name.localeCompare(b.full_name, 'es', { sensitivity: 'base' }),
      ),
    }))
    .sort((a, b) => a.team_name.localeCompare(b.team_name, 'es'));
}
