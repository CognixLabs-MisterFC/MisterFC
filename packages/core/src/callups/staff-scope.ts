/**
 * O2-7b-1 — Scope de visibilidad/gestión de CONVOCATORIAS (staff), framework-
 * agnóstico. Extraído de `apps/web/.../convocatorias/queries.ts::resolveConvocatorias
 * Scope` (F4 Lote B). La web pasa a delegar (mismas queries, mismo criterio); la app
 * nativa lo consume con el rol del club activo y el `userId` de la sesión.
 *
 * `teamIds` = equipos donde el user es staff (cualquier staff_role). `managedTeamIds`
 * = equipos donde puede GESTIONAR convocatorias (convocar/publicar). Desde O2 (se
 * eliminó el sistema de capabilities) gestionar convocatorias es DE SERIE para todo
 * el cuerpo técnico: cualquier staff activo del equipo gestiona → managedTeamIds =
 * teamIds. Es el ESPEJO del gate RLS `user_can_manage_callup` (admin/director,
 * coordinador del equipo, o cualquier staff del equipo); el candado real es la RLS.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import { getActiveSeasonLabelFromClient } from '../season/active-season';

type DbClient = SupabaseClient<Database>;

export type ConvocatoriasScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: string[]; managedTeamIds: string[] }
  | { kind: 'player'; playerIds: string[] }
  | { kind: 'none' };

export async function resolveConvocatoriasScopeFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    role: Role;
    userId: string | null;
    /**
     * S2 director-entrenador (modo "Míster" de la APP) — el usuario actúa como
     * team_staff de sus equipos, NO como director club-wide. Lo pasan SOLO las
     * pantallas nativas del área staff; la WEB nunca lo pasa → un admin/director en
     * web sigue con scope 'all' (club entero). Para roles que no son admin/director
     * es no-op (ya caen en su rama). RLS intacta: esto solo acota lo VISIBLE en la UI.
     */
    asStaffMember?: boolean;
  },
): Promise<ConvocatoriasScope> {
  const { clubId, role, userId, asStaffMember } = params;

  const coachMode =
    asStaffMember === true && (role === 'admin_club' || role === 'director');

  // E-7a: director/admin_club club-wide — SALVO en modo Míster, que cae en 'restricted'.
  if ((role === 'admin_club' || role === 'director') && !coachMode) {
    return { kind: 'all' };
  }
  if (!userId) return { kind: 'none' };

  // C-2a: coordinador gestiona TODOS sus equipos (managedTeamIds = teamIds), como
  // si tuviera la capability; principal/ayudante mantienen su lógica. En modo Míster
  // el director/admin entra AQUÍ por la MISMA rama → resultado idéntico al de un
  // entrenador con sus mismas asignaciones.
  if (
    role === 'entrenador_principal' ||
    role === 'entrenador_ayudante' ||
    role === 'coordinador' ||
    coachMode
  ) {
    // Solo equipos de la TEMPORADA ACTIVA: tras el rollover puede haber una fila
    // `team_staff` viva (left_at null) en el equipo de una temporada pasada (mismo
    // nombre, otro team_id). Sin este filtro el scope arrastra ese equipo caduco y
    // deja las pantallas del entrenador vacías. Mismo patrón que el lado familia.
    const activeSeason = await getActiveSeasonLabelFromClient(supabase, clubId);
    type Row = {
      team_id: string;
      staff_role: string;
      teams: { season: string };
      memberships: { profile_id: string; club_id: string };
    };
    const { data } = await supabase
      .from('team_staff')
      .select('team_id, staff_role, teams!inner(season), memberships!inner(profile_id, club_id)')
      .is('left_at', null);
    const myRows = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter(
        (r) =>
          r.memberships.profile_id === userId &&
          r.memberships.club_id === clubId &&
          r.teams.season === activeSeason,
      );
    const teamIds = myRows.map((r) => r.team_id);

    // O2: gestionar convocatorias es DE SERIE para todo el cuerpo técnico. Cualquier
    // staff activo del equipo (principal, ayudante, coordinador) gestiona sus equipos.
    const managedTeamIds = teamIds;

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
