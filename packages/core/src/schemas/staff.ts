import { z } from 'zod';

export const TEAM_STAFF_ROLES = [
  'entrenador_principal',
  'entrenador_ayudante',
  'preparador_fisico',
  'delegado',
  // Serie C (C-0) — el coordinador es staff de EQUIPO (una fila por equipo que
  // coordina). sendStaffInvitationSchema lo admite vía este enum.
  'coordinador',
] as const;

export type TeamStaffRole = (typeof TEAM_STAFF_ROLES)[number];

/**
 * Invitar a alguien como cuerpo técnico de un equipo (F2.6).
 *
 * - team_staff_role describe la FUNCIÓN dentro del equipo.
 * - El membership.role de club se deriva: 'principal' → 'entrenador_principal',
 *   resto → 'entrenador_ayudante'. La app lo aplica al insertar.
 */
export const sendStaffInvitationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'email_invalid' })
    .max(254, { message: 'email_too_long' }),
  team_staff_role: z.enum(TEAM_STAFF_ROLES, {
    message: 'team_staff_role_invalid',
  }),
});
export type SendStaffInvitationInput = z.infer<typeof sendStaffInvitationSchema>;

// El sistema de capabilities del entrenador ayudante fue ELIMINADO (O2): todo el
// cuerpo técnico puede de serie lo que antes requería capability. Ya no hay tabla
// `capabilities`, ni gates que la lean, ni pantalla de configuración. Ver la
// migración 20261042000000_o2_remove_capabilities_staff_de_serie.sql.
