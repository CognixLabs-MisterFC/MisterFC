export const TEAM_STAFF_ROLES = [
  'entrenador_principal',
  'entrenador_ayudante',
  'preparador_fisico',
  'delegado',
  // Serie C (C-0) — el coordinador es staff de EQUIPO (una fila por equipo que
  // coordina).
  'coordinador',
] as const;

export type TeamStaffRole = (typeof TEAM_STAFF_ROLES)[number];

// `sendStaffInvitationSchema` (F2.6) se BORRÓ en BUG 3 · A-3 junto con
// `inviteStaffToTeam`, su único consumidor: invitar dejó de vivir en la página de
// un equipo y pasó a la pantalla de invitaciones del club, que valida con su
// propio esquema. Lo que se quedó de aquello es este enum, que usa medio repo.

// El sistema de capabilities del entrenador ayudante fue ELIMINADO (O2): todo el
// cuerpo técnico puede de serie lo que antes requería capability. Ya no hay tabla
// `capabilities`, ni gates que la lean, ni pantalla de configuración. Ver la
// migración 20261042000000_o2_remove_capabilities_staff_de_serie.sql.
