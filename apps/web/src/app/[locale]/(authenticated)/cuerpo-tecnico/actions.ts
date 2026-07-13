'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ACTIVE_CLUB_COOKIE_NAME,
  TEAM_STAFF_ROLES,
  createSupabaseServerClient,
  getCurrentUserClubs,
  resolveActiveClub,
} from '@misterfc/core';
import { createCookieAdapter } from '@/lib/supabase-cookies';

async function activeClubId(): Promise<string | null> {
  const adapter = await createCookieAdapter();
  const clubs = await getCurrentUserClubs(adapter);
  if (clubs.length === 0) return null;
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(ACTIVE_CLUB_COOKIE_NAME)?.value ?? null;
  const { active } = resolveActiveClub(clubs, cookieValue);
  return active?.club.id ?? null;
}

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
// addStaffAssignment (Serie C · C-0) — AÑADE un rol/equipo a una membership
// existente SIN cerrar las demás filas (a diferencia de moveStaffToTeam). Permite
// multi-rol y multi-equipo, incl. 2 roles en el mismo equipo (habilitado por el
// UNIQUE (team_id, membership_id, staff_role) de C-0). Guard = RLS
// team_staff_insert_admin (admin/coord/director); la UI solo lo ofrece a
// admin/director (coordinador NO asigna en C-0). Cero policy nueva.
// ─────────────────────────────────────────────────────────────────────────────

const addAssignmentSchema = z.object({
  target_team_id: z.string().uuid({ message: 'team_invalid' }),
  staff_role: z.enum(TEAM_STAFF_ROLES, { message: 'staff_role_invalid' }),
});

export type AddAssignmentState = {
  error?:
    | 'team_invalid'
    | 'staff_role_invalid'
    | 'cross_club'
    | 'principal_exists'
    | 'role_exists'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

export async function addStaffAssignment(
  membershipId: string,
  _prev: AddAssignmentState,
  formData: FormData
): Promise<AddAssignmentState> {
  const parsed = addAssignmentSchema.safeParse({
    target_team_id: formData.get('target_team_id'),
    staff_role: formData.get('staff_role'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'team_invalid' || code === 'staff_role_invalid') {
      return { error: code };
    }
    return { error: 'generic' };
  }
  const { target_team_id, staff_role } = parsed.data;

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  // Coherencia de club: la membership y el equipo destino deben ser del mismo club.
  const { data: membership } = await supabase
    .from('memberships')
    .select('id, club_id')
    .eq('id', membershipId)
    .maybeSingle();
  if (!membership) return { error: 'forbidden' };

  const { data: team } = await supabase
    .from('teams')
    .select('id, categories!inner(club_id)')
    .eq('id', target_team_id)
    .maybeSingle();
  if (!team) return { error: 'team_invalid' };
  const teamClubId = (team.categories as unknown as { club_id: string }).club_id;
  if (teamClubId !== (membership.club_id as string)) {
    return { error: 'cross_club' };
  }

  // Pre-check principal único por equipo (además del índice parcial).
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
  const { error: insErr } = await supabase.from('team_staff').insert({
    team_id: target_team_id,
    membership_id: membershipId,
    staff_role,
    joined_at: today,
  });

  if (insErr) {
    if (insErr.code === '42501') return { error: 'forbidden' };
    // UNIQUE parcial: principal duplicado, o mismo rol activo ya existente en el team.
    if (insErr.code === '23505') {
      return {
        error:
          staff_role === 'entrenador_principal'
            ? 'principal_exists'
            : 'role_exists',
      };
    }
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  revalidatePath(
    `/[locale]/(authenticated)/cuerpo-tecnico/${membershipId}`,
    'page'
  );
  revalidatePath(`/[locale]/(authenticated)/equipos/${target_team_id}`, 'page');
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

// ─────────────────────────────────────────────────────────────────────────────
// updateStaffName (Bug 2 · 2a) — el admin corrige el nombre de un entrenador
// ─────────────────────────────────────────────────────────────────────────────

const updateStaffNameSchema = z.object({
  full_name: z
    .string()
    .trim()
    .min(1, { message: 'name_required' })
    .max(120, { message: 'name_too_long' }),
});

export type UpdateStaffNameState = {
  error?:
    | 'name_required'
    | 'name_too_long'
    | 'no_active_club'
    | 'target_invalid'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

/**
 * Bug 2 (2a) — corrige el `full_name` (global) de un miembro del club. Delega en
 * la función SQL `admin_update_staff_profile` (SECURITY DEFINER, solo admin_club,
 * solo target del club, solo el campo nombre). No relaja profiles_update_self.
 */
export async function updateStaffName(
  targetProfileId: string,
  _prev: UpdateStaffNameState,
  formData: FormData
): Promise<UpdateStaffNameState> {
  const parsed = updateStaffNameSchema.safeParse({
    full_name: formData.get('full_name'),
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'name_required' || code === 'name_too_long') {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('admin_update_staff_profile', {
    p_club_id: clubId,
    p_target_profile_id: targetProfileId,
    p_full_name: parsed.data.full_name,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('target_invalid')) return { error: 'target_invalid' };
    if (msg.includes('name_required')) return { error: 'name_required' };
    if (msg.includes('name_too_long')) return { error: 'name_too_long' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico/[membershipId]', 'page');
  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateStaffRole (Bug 2 · 2b) — el admin cambia el ROL DE CLUB de un miembro.
// La guarda del "último admin" vive en la función SQL (would_remove_last_admin).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Roles de club OFRECIDOS como DESTINO al cambiar el rol de un miembro. Solo
 * roles BAJOS: los roles altos (director/admin_club) NO se alcanzan por cambio de
 * rol, solo por INVITACIÓN (F1B-2b — el RPC los rechaza con high_role_invite_only).
 * Tampoco se ofrece `jugador` (convertir un miembro del staff en jugador/familia
 * es otro flujo, no una operación de cuerpo técnico).
 */
export const STAFF_CLUB_ROLES = [
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
] as const;

const updateStaffRoleSchema = z.object({
  new_role: z.enum(STAFF_CLUB_ROLES, { message: 'role_invalid' }),
});

export type UpdateStaffRoleState = {
  error?:
    | 'role_invalid'
    | 'high_role_invite_only'
    | 'would_remove_last_admin'
    | 'no_active_club'
    | 'target_invalid'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

/**
 * Bug 2 (2b) — cambia el rol de club (`memberships.role`) de un miembro. Delega
 * en la función SQL `admin_update_staff_role` (SECURITY DEFINER, solo admin_club,
 * solo target del club, solo la columna role) que además impone la GUARDA de no
 * dejar el club sin admin_club. No toca auth.users ni profiles.
 */
export async function updateStaffRole(
  targetProfileId: string,
  _prev: UpdateStaffRoleState,
  formData: FormData
): Promise<UpdateStaffRoleState> {
  const parsed = updateStaffRoleSchema.safeParse({
    new_role: formData.get('new_role'),
  });
  if (!parsed.success) {
    return { error: 'role_invalid' };
  }

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('admin_update_staff_role', {
    p_club_id: clubId,
    p_target_profile_id: targetProfileId,
    p_new_role: parsed.data.new_role,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('would_remove_last_admin')) {
      return { error: 'would_remove_last_admin' };
    }
    if (msg.includes('high_role_invite_only')) {
      return { error: 'high_role_invite_only' };
    }
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('target_invalid')) return { error: 'target_invalid' };
    if (msg.includes('role_invalid')) return { error: 'role_invalid' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico/[membershipId]', 'page');
  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  return { success: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// updateStaffContact (Bug 2 · 2c) — el admin edita el contacto del entrenador
// (phone / contact_email), gestionado por el club. NO toca el email de login.
// ─────────────────────────────────────────────────────────────────────────────

const CONTACT_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const updateStaffContactSchema = z.object({
  // Vacío → null (campo opcional gestionado por el club).
  phone: z
    .string()
    .trim()
    .transform((v) => (v.length > 0 ? v : null))
    .refine((v) => v === null || (v.length >= 3 && v.length <= 32), {
      message: 'phone_invalid',
    }),
  contact_email: z
    .string()
    .trim()
    .transform((v) => (v.length > 0 ? v : null))
    .refine((v) => v === null || (v.length <= 254 && CONTACT_EMAIL_RE.test(v)), {
      message: 'contact_email_invalid',
    }),
});

export type UpdateStaffContactState = {
  error?:
    | 'phone_invalid'
    | 'contact_email_invalid'
    | 'no_active_club'
    | 'target_invalid'
    | 'forbidden'
    | 'generic';
  success?: boolean;
};

/**
 * Bug 2 (2c) — guarda el contacto (phone/contact_email) de un miembro del club.
 * Delega en la función SQL `admin_update_staff_contact` (SECURITY DEFINER, solo
 * admin_club, solo target del club, solo esas dos columnas de memberships). NO
 * toca el email de login (auth.users) ni profiles.
 */
export async function updateStaffContact(
  targetProfileId: string,
  _prev: UpdateStaffContactState,
  formData: FormData
): Promise<UpdateStaffContactState> {
  const parsed = updateStaffContactSchema.safeParse({
    phone: formData.get('phone') ?? '',
    contact_email: formData.get('contact_email') ?? '',
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'phone_invalid' || code === 'contact_email_invalid') {
      return { error: code };
    }
    return { error: 'generic' };
  }

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const { error } = await supabase.rpc('admin_update_staff_contact', {
    p_club_id: clubId,
    p_target_profile_id: targetProfileId,
    // El SQL acepta NULL (campos opcionales) pero el typegen los marca string.
    p_phone: parsed.data.phone as unknown as string,
    p_contact_email: parsed.data.contact_email as unknown as string,
  });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    if (msg.includes('target_invalid')) return { error: 'target_invalid' };
    if (msg.includes('phone_invalid')) return { error: 'phone_invalid' };
    if (msg.includes('contact_email_invalid')) {
      return { error: 'contact_email_invalid' };
    }
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico/[membershipId]', 'page');
  revalidatePath('/[locale]/(authenticated)/cuerpo-tecnico', 'page');
  return { success: true };
}
