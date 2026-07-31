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
  getTeamStaffLightFromClient,
  type LightTeamStaff,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { getActiveSeasonLabel } from '@/lib/active-season';

// O2-5 D1 — tipos y fetch de staff extraídos a core; el wrapper conserva la
// resolución "sus equipos" (unión jugador+entrenador), que es web-only.
export type { LightStaffMember, LightTeamStaff } from '@misterfc/core';

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

  // Staff (nombre + rol) de esos equipos → fetch extraído a core.
  return getTeamStaffLightFromClient(
    supabase,
    teams.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  );
}
