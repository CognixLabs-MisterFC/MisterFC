import type { Role } from './current-user';

/**
 * Familias de ROL DE CLUB (memberships.role) centralizadas — fuente única para
 * los gates de UI del front (F1B-3). Los gates de SEGURIDAD viven en RLS/RPC
 * server-side; estas listas solo deciden qué pantallas/acciones muestra la UI.
 *
 * `director` (F1B) = admin en datos y vistas → entra en admin-like / manager /
 * staff. NO entra en COACH_ROLES: "coach" es una identidad de EQUIPO (team_staff:
 * ¿entrena ESTE equipo?), distinta del rol de club; un director puede además ser
 * team_staff de un equipo por separado, pero como ROL DE CLUB no es entrenador.
 *
 * Regla anti-deriva: NO redefinas estas listas en las páginas; impórtalas de aquí.
 */

/**
 * Gestores del club que administran estructura/config y ven todo a nivel club:
 * admin_club, director y coordinador. (Equivale al viejo "admin-like" = admin +
 * coordinador, más director.) Úsalo para: ajustes, gestión de equipos/plantillas,
 * dashboards de club, publicar anuncios de club, etc.
 */
export const ADMIN_ROLES: readonly Role[] = [
  'admin_club',
  'director',
  'coordinador',
];

/**
 * Gestores incluyendo al entrenador PRINCIPAL (además de admin/director/coord).
 * Para acciones de gestión que el principal de equipo también realiza: crear
 * alineaciones, gestionar convocatorias, crear jugadores, anuncios de equipo, etc.
 */
export const MANAGER_ROLES: readonly Role[] = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
];

/**
 * Todo el cuerpo técnico de CLUB: admin/director/coordinador + entrenadores
 * (principal y ayudante). Para pantallas de consulta/gestión del staff: fichas de
 * jugador, estadísticas, sesiones, ejercicios, directo, informes, etc.
 */
export const STAFF_ROLES: readonly Role[] = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
];

/**
 * Entrenadores de EQUIPO (rol de club principal/ayudante). NO incluye director:
 * es la identidad "entreno equipos", no un rol de administración de club. La usan
 * el hub "mis-equipos" y los flujos que preguntan "¿es este user entrenador?".
 */
export const COACH_ROLES: readonly Role[] = [
  'entrenador_principal',
  'entrenador_ayudante',
];

/** Los 6 roles de club (útil para validaciones/exhaustividad). */
export const ALL_CLUB_ROLES: readonly Role[] = [
  'admin_club',
  'director',
  'coordinador',
  'entrenador_principal',
  'entrenador_ayudante',
  'jugador',
];
