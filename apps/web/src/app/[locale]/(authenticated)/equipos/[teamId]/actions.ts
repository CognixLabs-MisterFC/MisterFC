'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { TEAM_STAFF_ROLES, createSupabaseServerClient } from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';
import { assignStaffToTeam } from '@/lib/team-staff';

// ─────────────────────────────────────────────────────────────────────────────
// Añadir al cuerpo técnico a alguien que YA ESTÁ en el club (BUG 3 · A-2)
//
// La contraparte de invitar. Si la persona ya es miembro no hay nada que
// invitar: se elige de entre los que están y se le da una función en el equipo.
// La escritura la comparte con `addStaffAssignment` de Cuerpo técnico (allí se
// elige el equipo; aquí, la persona) — ver @/lib/team-staff.
//
// NO toca el rol de club: eso es lo que distingue añadir de invitar.
// ─────────────────────────────────────────────────────────────────────────────

const addTeamStaffSchema = z.object({
  membership_id: z.string().uuid({ message: 'membership_invalid' }),
  team_staff_role: z.enum(TEAM_STAFF_ROLES, { message: 'team_staff_role_invalid' }),
});

export type AddTeamStaffState = {
  error?:
    | 'membership_invalid'
    | 'team_staff_role_invalid'
    | 'team_invalid'
    | 'cross_club'
    | 'principal_exists'
    | 'role_exists'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

export async function addTeamStaff(
  teamId: string,
  _prev: AddTeamStaffState,
  formData: FormData
): Promise<AddTeamStaffState> {
  const parsed = addTeamStaffSchema.safeParse({
    membership_id: formData.get('membership_id'),
    team_staff_role: formData.get('team_staff_role'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'membership_invalid' || code === 'team_staff_role_invalid') {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const res = await assignStaffToTeam(supabase, {
    membershipId: parsed.data.membership_id,
    teamId,
    staffRole: parsed.data.team_staff_role,
  });
  if (!res.ok) return { error: res.error };

  revalidatePath(`/[locale]/(authenticated)/equipos/${teamId}`, 'page');
  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/cuerpo-tecnico/${parsed.data.membership_id}`,
    'page'
  );
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quitar staff del equipo (cierra left_at = today)
// ─────────────────────────────────────────────────────────────────────────────

export type RemoveStaffResult =
  | { success: true }
  | { success: false; error: 'forbidden' | 'generic' };

export async function removeTeamStaff(
  teamId: string,
  teamStaffId: string
): Promise<RemoveStaffResult> {
  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

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

  revalidatePath(`/[locale]/(authenticated)/equipos/${teamId}`, 'page');
  return { success: true };
}
