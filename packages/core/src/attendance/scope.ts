/**
 * O2-7a — Scope de visibilidad de ASISTENCIA (staff), framework-agnóstico.
 *
 * Extraído de `apps/web/.../asistencia/queries.ts::resolveAsistenciaScope` (F4).
 * Determina qué entrenamientos ve el usuario según su rol de club, resolviendo los
 * equipos del staff vía `team_staff` (RLS `team_staff_select_member`). La web pasa a
 * delegar (mismas queries, mismo criterio); la app nativa lo consume con el rol del
 * club activo y el `userId` de la sesión.
 *
 * SOLO LECTURA. El gate de ESCRITURA (quién pasa lista) NO vive aquí: lo impone la
 * RLS/`user_can_record_attendance` server-side; este scope solo acota lo VISIBLE.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/types';
import type { Role } from '../auth/current-user';
import { getActiveSeasonLabelFromClient } from '../season/active-season';

type DbClient = SupabaseClient<Database>;

export type AttendanceScope =
  | { kind: 'all' }
  | { kind: 'restricted'; teamIds: string[] }
  | { kind: 'player'; playerIds: string[] }
  | { kind: 'none' };

/**
 * Resuelve el scope de asistencia del usuario en un club:
 *  - admin_club / director → all (club-wide).
 *  - principal / ayudante / coordinador → restricted a sus equipos activos
 *    (team_staff con memberships del user en el club, cualquier staff_role).
 *  - jugador → solo sus jugadores vinculados (player_accounts en el club).
 *  - resto → none.
 *
 * Mismas queries que la web; el `userId` se inyecta (la web lo saca de la cookie,
 * la app de la sesión) para no acoplar core a ningún adaptador de auth.
 */
export async function resolveAttendanceScopeFromClient(
  supabase: DbClient,
  params: {
    clubId: string;
    role: Role;
    userId: string | null;
    /**
     * S2 director-entrenador (modo "Míster" de la APP) — ver la nota en
     * `resolveConvocatoriasScopeFromClient`. Lo pasan SOLO las pantallas nativas de
     * staff; la WEB nunca lo pasa → admin/director en web sigue con scope 'all'.
     */
    asStaffMember?: boolean;
  },
): Promise<AttendanceScope> {
  const { clubId, role, userId, asStaffMember } = params;

  const coachMode =
    asStaffMember === true && (role === 'admin_club' || role === 'director');

  // E-7a: director/admin_club club-wide — SALVO en modo Míster, que cae en 'restricted'.
  if ((role === 'admin_club' || role === 'director') && !coachMode) {
    return { kind: 'all' };
  }
  if (!userId) return { kind: 'none' };

  // C-2a: coordinador cae en 'restricted' (sus equipos vía team_staff, cualquier
  // staff_role), como principal/ayudante. En modo Míster el director/admin entra AQUÍ
  // por la MISMA rama → idéntico a un entrenador con sus mismas asignaciones.
  if (
    role === 'entrenador_principal' ||
    role === 'entrenador_ayudante' ||
    role === 'coordinador' ||
    coachMode
  ) {
    // Solo equipos de la TEMPORADA ACTIVA: una fila `team_staff` viva de una
    // temporada pasada (mismo nombre, otro team_id) arrastraría un equipo caduco y
    // dejaría la asistencia vacía. Mismo patrón que el lado familia.
    const activeSeason = await getActiveSeasonLabelFromClient(supabase, clubId);
    type Row = {
      team_id: string;
      teams: { season: string };
      memberships: { profile_id: string; club_id: string };
    };
    const { data } = await supabase
      .from('team_staff')
      .select('team_id, teams!inner(season), memberships!inner(profile_id, club_id)')
      .is('left_at', null);
    const teamIds = (data ?? [])
      .map((r) => r as unknown as Row)
      .filter(
        (r) =>
          r.memberships.profile_id === userId &&
          r.memberships.club_id === clubId &&
          r.teams.season === activeSeason,
      )
      .map((r) => r.team_id);
    return { kind: 'restricted', teamIds };
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
