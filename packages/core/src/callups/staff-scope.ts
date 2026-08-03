/**
 * O2-7b-1 — Scope de visibilidad/gestión de CONVOCATORIAS (staff), framework-
 * agnóstico. Extraído de `apps/web/.../convocatorias/queries.ts::resolveConvocatorias
 * Scope` (F4 Lote B). La web pasa a delegar (mismas queries, mismo criterio); la app
 * nativa lo consume con el rol del club activo y el `userId` de la sesión.
 *
 * `teamIds` = equipos donde el user es staff (cualquier staff_role). `managedTeamIds`
 * = equipos donde puede GESTIONAR convocatorias (convocar/publicar): principal vía
 * `team_staff.staff_role`, o cualquier staff con capability `can_manage_callups`, o
 * coordinador (todos sus equipos). Es el ESPEJO del gate RLS `user_can_manage_callup`;
 * el candado real es la RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';

type DbClient = SupabaseClient<Database>;

export type ConvocatoriasScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: string[]; managedTeamIds: string[] }
  | { kind: 'player'; playerIds: string[] }
  | { kind: 'none' };

export async function resolveConvocatoriasScopeFromClient(
  supabase: DbClient,
  params: { clubId: string; role: Role; userId: string | null },
): Promise<ConvocatoriasScope> {
  const { clubId, role, userId } = params;

  // E-7a: director club-wide como admin_club.
  if (role === 'admin_club' || role === 'director') return { kind: 'all' };
  if (!userId) return { kind: 'none' };

  // C-2a: coordinador gestiona TODOS sus equipos (managedTeamIds = teamIds), como
  // si tuviera la capability; principal/ayudante mantienen su lógica.
  if (
    role === 'entrenador_principal' ||
    role === 'entrenador_ayudante' ||
    role === 'coordinador'
  ) {
    type Row = {
      team_id: string;
      staff_role: string;
      memberships: { profile_id: string; club_id: string };
    };
    const { data } = await supabase
      .from('team_staff')
      .select('team_id, staff_role, memberships!inner(profile_id, club_id)')
      .is('left_at', null);
    const myRows = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter(
        (r) =>
          r.memberships.profile_id === userId &&
          r.memberships.club_id === clubId,
      );
    const teamIds = myRows.map((r) => r.team_id);

    // ¿Tiene la capability can_manage_callups en este club?
    type CapRow = {
      granted: boolean;
      memberships: { profile_id: string; club_id: string };
    };
    const { data: capData } = await supabase
      .from('capabilities')
      .select('granted, memberships!inner(profile_id, club_id)')
      .eq('capability_name', 'can_manage_callups');
    const hasCallupCap = (capData ?? [])
      .map((r) => r as unknown as CapRow)
      .some(
        (r) =>
          r.granted &&
          r.memberships.profile_id === userId &&
          r.memberships.club_id === clubId,
      );

    const managedTeamIds =
      hasCallupCap || role === 'coordinador'
        ? teamIds
        : myRows
            .filter((r) => r.staff_role === 'entrenador_principal')
            .map((r) => r.team_id);

    return { kind: 'restricted', teamIds, managedTeamIds };
  }

  if (role === 'jugador') {
    type Row = { player_id: string; players: { club_id: string } };
    const { data } = await supabase
      .from('player_accounts')
      .select('player_id, players!inner(club_id)')
      .eq('profile_id', userId);
    const playerIds = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter((r) => r.players.club_id === clubId)
      .map((r) => r.player_id);
    return { kind: 'player', playerIds };
  }

  return { kind: 'none' };
}
