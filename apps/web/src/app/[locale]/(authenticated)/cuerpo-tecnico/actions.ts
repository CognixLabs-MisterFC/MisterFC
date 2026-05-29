'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  TEAM_STAFF_ROLES,
  createSupabaseServerClient,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

// ─────────────────────────────────────────────────────────────────────────────
// moveStaffToTeam (F2.11)
// ─────────────────────────────────────────────────────────────────────────────

const moveStaffSchema = z.object({
  team_staff_id: z.string().uuid({ message: 'team_staff_invalid' }),
  target_team_id: z.string().uuid({ message: 'team_invalid' }),
  staff_role: z.enum(TEAM_STAFF_ROLES, { message: 'staff_role_invalid' }),
});

export type MoveStaffState = {
  error?:
    | 'team_staff_invalid'
    | 'team_invalid'
    | 'staff_role_invalid'
    | 'same_team'
    | 'principal_exists'
    | 'cross_club'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

/**
 * Mueve un coach de su equipo actual a otro equipo del mismo club.
 *
 * 1. Cierra el `team_staff` activo con `left_at = today`.
 * 2. Inserta una nueva fila con el `target_team_id` y `staff_role` indicado.
 *
 * RLS: admin/coord vía `team_staff_update_admin` y `team_staff_insert_admin`
 * (F2.6). Cero policy nueva.
 */
export async function moveStaffToTeam(
  membershipId: string,
  _prev: MoveStaffState,
  formData: FormData
): Promise<MoveStaffState> {
  const parsed = moveStaffSchema.safeParse({
    team_staff_id: formData.get('team_staff_id'),
    target_team_id: formData.get('target_team_id'),
    staff_role: formData.get('staff_role'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (
      code === 'team_staff_invalid' ||
      code === 'team_invalid' ||
      code === 'staff_role_invalid'
    ) {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const { team_staff_id, target_team_id, staff_role } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Resuelve la fila origen para verificar club y obtener team origen.
  const { data: source } = await supabase
    .from('team_staff')
    .select(
      `id, team_id, membership_id, left_at,
       teams!inner(category_id, categories!inner(club_id)),
       memberships!inner(club_id)`
    )
    .eq('id', team_staff_id)
    .maybeSingle();

  if (!source || source.left_at != null) return { error: 'team_staff_invalid' };
  if ((source.membership_id as string) !== membershipId) {
    return { error: 'team_staff_invalid' };
  }

  type SrcShape = {
    team_id: string;
    teams: { categories: { club_id: string } };
    memberships: { club_id: string };
  };
  const src = source as unknown as SrcShape;
  const sourceClubId = src.teams.categories.club_id;
  if (src.memberships.club_id !== sourceClubId) {
    return { error: 'cross_club' };
  }

  if (src.team_id === target_team_id) return { error: 'same_team' };

  // Resuelve target para validar mismo club.
  const { data: target } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('id', target_team_id)
    .maybeSingle();
  if (!target) return { error: 'team_invalid' };
  const targetClubId = (target.categories as unknown as { club_id: string })
    .club_id;
  if (targetClubId !== sourceClubId) return { error: 'cross_club' };

  // Pre-check principal único en el destino.
  if (staff_role === 'entrenador_principal') {
    const { data: existing } = await supabase
      .from('team_staff')
      .select('id')
      .eq('team_id', target_team_id)
      .eq('staff_role', 'entrenador_principal')
      .is('left_at', null)
      .maybeSingle();
    if (existing) return { error: 'principal_exists' };
  }

  const today = new Date().toISOString().slice(0, 10);

  // Cerrar la fila activa actual.
  const { error: closeErr } = await supabase
    .from('team_staff')
    .update({ left_at: today })
    .eq('id', team_staff_id)
    .is('left_at', null);

  if (closeErr) {
    if (closeErr.code === '42501') return { error: 'forbidden' };
    return { error: 'generic' };
  }

  // Insertar la nueva fila.
  const { error: insErr } = await supabase.from('team_staff').insert({
    team_id: target_team_id,
    membership_id: membershipId,
    staff_role,
    joined_at: today,
  });

  if (insErr) {
    if (insErr.code === '42501') return { error: 'forbidden' };
    // Si el índice parcial UNIQUE (principal único) salta por concurrencia.
    if (insErr.code === '23505') return { error: 'principal_exists' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/cuerpo-tecnico/${membershipId}`,
    'page'
  );
  revalidatePath(
    `/[locale]/(authenticated)/equipos/${src.team_id}`,
    'page'
  );
  revalidatePath(
    `/[locale]/(authenticated)/equipos/${target_team_id}`,
    'page'
  );
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// removeStaffFromTeam (F2.11) — duplica el helper de F2.6 pero scope global
// ─────────────────────────────────────────────────────────────────────────────

export type RemoveStaffAssignmentResult =
  | { success: true }
  | { success: false; error: 'forbidden' | 'generic' };

/**
 * Cierra el vínculo team_staff (left_at = today) sin tocar la membership.
 * Equivalente a `removeTeamStaff` de F2.6 pero invocable desde la vista
 * global. Revalida ambas rutas.
 */
export async function removeStaffAssignment(
  teamStaffId: string,
  membershipId: string
): Promise<RemoveStaffAssignmentResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Resolvemos team_id antes para revalidar la ficha de equipo.
  const { data: row } = await supabase
    .from('team_staff')
    .select('id, team_id')
    .eq('id', teamStaffId)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('team_staff')
    .update({ left_at: today })
    .eq('id', teamStaffId)
    .is('left_at', null);

  if (error) {
    if (error.code === '42501') return { success: false, error: 'forbidden' };
    return { success: false, error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/cuerpo-tecnico/${membershipId}`,
    'page'
  );
  if (row?.team_id) {
    revalidatePath(
      `/[locale]/(authenticated)/equipos/${row.team_id as string}`,
      'page'
    );
  }
  return { success: true };
}
