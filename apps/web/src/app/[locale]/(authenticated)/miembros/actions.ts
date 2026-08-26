'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  ACTIVE_CLUB_COOKIE_NAME,
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
// setMembershipLeft (Baja de miembros · 4d) — da de baja o reactiva una membership.
//
// Delega ENTERAMENTE en la RPC set_membership_left (SECURITY DEFINER): la RPC es la
// AUTORIDAD de autorización (A2) y de las guardas (admin_immutable, cannot_leave_self,
// forbidden_requires_admin). Aquí NO se reimplementan: se traduce el error de la RPC a
// un código de UI. La razón es nota interna (solo se envía; nunca se lee de vuelta).
//
//  - mode 'baja'      → p_left_at = hoy, p_reason = razón (opcional).
//  - mode 'reactivar' → p_left_at = null (limpia la razón). El botón de reactivar llega
//    en 4e-3; la acción ya lo soporta para no duplicar server actions.
// ─────────────────────────────────────────────────────────────────────────────

const schema = z.object({
  mode: z.enum(['baja', 'reactivar'], { message: 'generic' }),
  reason: z
    .string()
    .trim()
    .max(500, { message: 'reason_too_long' })
    .optional(),
});

export type MembershipLeftState = {
  error?:
    | 'reason_too_long'
    | 'no_active_club'
    | 'not_authenticated'
    | 'forbidden'
    | 'cannot_leave_self'
    | 'target_invalid'
    | 'admin_immutable'
    | 'forbidden_requires_admin'
    | 'admin_conflict'
    | 'generic';
  success?: boolean;
};

export async function setMembershipLeft(
  targetProfileId: string,
  _prev: MembershipLeftState,
  formData: FormData
): Promise<MembershipLeftState> {
  const parsed = schema.safeParse({
    mode: formData.get('mode'),
    reason: formData.get('reason') ?? undefined,
  });
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    if (code === 'reason_too_long') return { error: code };
    return { error: 'generic' };
  }
  const { mode, reason } = parsed.data;

  const clubId = await activeClubId();
  if (!clubId) return { error: 'no_active_club' };

  const adapter = await createCookieAdapter();
  const supabase = createSupabaseServerClient(adapter);

  const today = new Date().toISOString().slice(0, 10);
  // El typegen marca p_left_at/p_reason como string; la RPC acepta NULL (reactivar /
  // sin razón). Se castea igual que hacen las otras acciones con args opcionales.
  const { error } = await supabase.rpc('set_membership_left', {
    p_club_id: clubId,
    p_target_profile_id: targetProfileId,
    p_left_at: (mode === 'baja' ? today : null) as unknown as string,
    p_reason: (mode === 'baja' && reason ? reason : null) as unknown as string,
  });

  if (error) {
    const msg = error.message ?? '';
    // 1 admin/club: reactivar/adoptar admin_club chocaría con el índice parcial.
    if (error.code === '23505') return { error: 'admin_conflict' };
    if (msg.includes('not_authenticated')) return { error: 'not_authenticated' };
    if (msg.includes('cannot_leave_self')) return { error: 'cannot_leave_self' };
    if (msg.includes('admin_immutable')) return { error: 'admin_immutable' };
    if (msg.includes('forbidden_requires_admin')) {
      return { error: 'forbidden_requires_admin' };
    }
    if (msg.includes('target_invalid')) return { error: 'target_invalid' };
    if (msg.includes('forbidden')) return { error: 'forbidden' };
    return { error: 'generic' };
  }

  revalidatePath('/[locale]/(authenticated)/miembros', 'page');
  return { success: true };
}
