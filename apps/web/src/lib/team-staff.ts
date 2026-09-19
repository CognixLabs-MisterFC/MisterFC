import type { createSupabaseServerClient, TeamStaffRole } from '@misterfc/core';

type ServerClient = ReturnType<typeof createSupabaseServerClient>;

export type AssignStaffError =
  | 'team_invalid'
  | 'cross_club'
  | 'principal_exists'
  | 'role_exists'
  | 'forbidden'
  | 'generic';

export type AssignStaffResult = { ok: true } | { ok: false; error: AssignStaffError };

/**
 * DAR UNA FUNCIÓN EN UN EQUIPO A ALGUIEN QUE YA ESTÁ EN EL CLUB.
 *
 * La misma operación se pide desde dos sitios y por los dos lados:
 *   · Cuerpo técnico → eliges la PERSONA y luego el equipo (`addStaffAssignment`).
 *   · Equipo → eliges el EQUIPO y luego la persona (`addStaffToTeam`).
 *
 * Es la misma escritura, así que vive una sola vez. Lo que cambia entre las dos
 * es qué dato viene fijado y qué páginas hay que revalidar; eso se queda en cada
 * server action.
 *
 * AÑADE, no mueve: no cierra ninguna otra fila. Una persona puede tener varios
 * equipos, y hasta dos funciones en el mismo equipo (lo permite el
 * UNIQUE (team_id, membership_id, staff_role) de la serie C).
 *
 * NO TOCA EL ROL DE CLUB. Es la diferencia con invitar: a quien ya está dentro
 * se le da trabajo en un equipo, no una identidad nueva. Un director que además
 * entrena sigue siendo director.
 *
 * El permiso REAL lo pone la RLS `team_staff_insert_admin`: admin/director del
 * club, o quien coordina ESE equipo (y entonces no puede nombrar coordinadores).
 * Aquí no se reimplementa: se llama y se traduce el 42501 a 'forbidden'.
 */
export async function assignStaffToTeam(
  supabase: ServerClient,
  params: { membershipId: string; teamId: string; staffRole: TeamStaffRole }
): Promise<AssignStaffResult> {
  const { membershipId, teamId, staffRole } = params;

  // Coherencia de club: la membership y el equipo destino deben ser del mismo club.
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, club_id')
    .eq('id', membershipId)
    .maybeSingle();
  if (!membership) return { ok: false, error: 'forbidden' };

  const { data: team } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('id', teamId)
    .maybeSingle();
  if (!team) return { ok: false, error: 'team_invalid' };
  const teamClubId = (team.categories as unknown as { club_id: string }).club_id;
  if (teamClubId !== (membership.club_id as string)) {
    return { ok: false, error: 'cross_club' };
  }

  // Pre-check principal único por equipo (además del índice parcial).
  if (staffRole === 'entrenador_principal') {
    const { data: existing } = await supabase
      .from('team_staff')
      .select('id')
      .eq('team_id', teamId)
      .eq('staff_role', 'entrenador_principal')
      .is('left_at', null)
      .maybeSingle();
    if (existing) return { ok: false, error: 'principal_exists' };
  }

  const today = new Date().toISOString().slice(0, 10);
  const { error: insErr } = await supabase.from('team_staff').insert({
    team_id: teamId,
    membership_id: membershipId,
    staff_role: staffRole,
    joined_at: today,
  });

  if (insErr) {
    if (insErr.code === '42501') return { ok: false, error: 'forbidden' };
    // UNIQUE parcial: principal duplicado, o mismo rol activo ya existente en el team.
    if (insErr.code === '23505') {
      return {
        ok: false,
        error: staffRole === 'entrenador_principal' ? 'principal_exists' : 'role_exists',
      };
    }
    return { ok: false, error: 'generic' };
  }

  return { ok: true };
}
