import type { SupabaseClient } from '@supabase/supabase-js';
import { MANAGER_ROLES } from '@misterfc/core';
import type { ShellContext } from './auth-shell';

/**
 * Helpers de permisos para F5 (mensajería + anuncios). El gate en UI tiene
 * que considerar `team_staff.staff_role` además de `memberships.role` —
 * mismo patrón que la regresión de PR #24 (4f3bf39) para canManage de
 * convocatorias.
 *
 * La autoridad final sigue siendo RLS / server actions. Estos helpers son
 * solo para decidir si renderizar botones / forms (UX, no seguridad).
 */

const CLUB_LEVEL_MESSAGING_ROLES: ReadonlyArray<string> = MANAGER_ROLES;

/**
 * ¿Puede este user iniciar conversación / publicar anuncio?
 *
 * Devuelve true si:
 *   1. memberships.role ∈ {admin_club, coordinador, entrenador_principal}, O
 *   2. memberships.role = entrenador_ayudante con `can_message_families`
 *      granted, O
 *   3. memberships.role = entrenador_ayudante con team_staff.staff_role =
 *      'entrenador_principal' activo en CUALQUIER team del club activo
 *      (ya es principal de algún team, aunque a nivel club siga siendo
 *      ayudante — caso real F2.6).
 *
 * El ayudante "puramente ayudante" (sin cap, sin principal por team_staff)
 * devuelve false.
 */
export async function userCanMessageInClub(
  supabase: SupabaseClient,
  ctx: ShellContext,
): Promise<boolean> {
  if (CLUB_LEVEL_MESSAGING_ROLES.includes(ctx.activeClub.role)) return true;

  if (ctx.activeClub.role !== 'entrenador_ayudante') return false;

  // Rama A: cap granted.
  const { data: cap } = await supabase
    .from('capabilities')
    .select('granted')
    .eq('membership_id', ctx.activeClub.membershipId)
    .eq('capability_name', 'can_message_families')
    .maybeSingle();
  if (cap?.granted) return true;

  // Rama B: principal de algún team via team_staff.
  const { count } = await supabase
    .from('team_staff')
    .select('id', { count: 'exact', head: true })
    .eq('membership_id', ctx.activeClub.membershipId)
    .eq('staff_role', 'entrenador_principal')
    .is('left_at', null);
  return (count ?? 0) > 0;
}

/**
 * Versión específica para publicar anuncios en UN team concreto: además
 * de la rama "principal de algún team", aceptamos al ayudante que sea
 * principal de ESTE team via team_staff aunque no tenga cap on.
 *
 * No usamos esta refinement para mensajes 1:1 porque el caso "principal
 * de team X puede mensajear a player del team X" se valida en el server
 * action, no en el botón de la ficha jugador (el botón aparece si user
 * puede mensajear genéricamente — el server filtra si el player aplica).
 */
export async function userCanPublishAnnouncementsToTeam(
  supabase: SupabaseClient,
  ctx: ShellContext,
  teamId: string,
): Promise<boolean> {
  if (CLUB_LEVEL_MESSAGING_ROLES.includes(ctx.activeClub.role)) return true;

  if (ctx.activeClub.role !== 'entrenador_ayudante') return false;

  const { data: cap } = await supabase
    .from('capabilities')
    .select('granted')
    .eq('membership_id', ctx.activeClub.membershipId)
    .eq('capability_name', 'can_message_families')
    .maybeSingle();
  if (cap?.granted) return true;

  // Principal de ESTE team específico.
  const { count } = await supabase
    .from('team_staff')
    .select('id', { count: 'exact', head: true })
    .eq('membership_id', ctx.activeClub.membershipId)
    .eq('team_id', teamId)
    .eq('staff_role', 'entrenador_principal')
    .is('left_at', null);
  return (count ?? 0) > 0;
}
