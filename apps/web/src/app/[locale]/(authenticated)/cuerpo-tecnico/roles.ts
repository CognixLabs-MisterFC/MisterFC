/**
 * Constantes de cuerpo técnico. Módulo NORMAL (sin 'use server'): Next.js prohíbe
 * exports que no sean funciones async en ficheros 'use server', así que este valor
 * NO puede vivir en `actions.ts` (donde estaba y rompía la ruta en runtime:
 * "A 'use server' file can only export async functions, found object"). Lo importan
 * tanto `actions.ts` (para el schema Zod) como el diálogo cliente.
 */

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
