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
 *   2. memberships.role = entrenador_ayudante que es staff ACTIVO de algún team
 *      del club (cualquier staff_role). Escribir a familias es DE SERIE para
 *      todo el cuerpo técnico desde O2 (se eliminó el sistema de capabilities).
 *
 * Un ayudante sin ninguna asignación de team_staff activa devuelve false.
 */
export async function userCanMessageInClub(
  supabase: SupabaseClient,
  ctx: ShellContext,
): Promise<boolean> {
  if (CLUB_LEVEL_MESSAGING_ROLES.includes(ctx.activeClub.role)) return true;

  if (ctx.activeClub.role !== 'entrenador_ayudante') return false;

  // Cualquier staff activo de algún team del club (principal o ayudante).
  const { count } = await supabase
    .from('team_staff')
    .select('id', { count: 'exact', head: true })
    .eq('membership_id', ctx.activeClub.membershipId)
    .is('left_at', null);
  return (count ?? 0) > 0;
}

/**
 * Versión específica para publicar anuncios en UN team concreto: aceptamos al
 * ayudante que sea staff ACTIVO de ESTE team (cualquier staff_role). Publicar
 * anuncios del equipo es DE SERIE para el cuerpo técnico del equipo desde O2.
 */
export async function userCanPublishAnnouncementsToTeam(
  supabase: SupabaseClient,
  ctx: ShellContext,
  teamId: string,
): Promise<boolean> {
  if (CLUB_LEVEL_MESSAGING_ROLES.includes(ctx.activeClub.role)) return true;

  if (ctx.activeClub.role !== 'entrenador_ayudante') return false;

  // Staff activo de ESTE team (principal o ayudante).
  const { count } = await supabase
    .from('team_staff')
    .select('id', { count: 'exact', head: true })
    .eq('membership_id', ctx.activeClub.membershipId)
    .eq('team_id', teamId)
    .is('left_at', null);
  return (count ?? 0) > 0;
}
