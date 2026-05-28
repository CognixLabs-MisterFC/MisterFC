import { z } from 'zod';

export const TEAM_STAFF_ROLES = [
  'entrenador_principal',
  'entrenador_ayudante',
  'preparador_fisico',
  'delegado',
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

// ─────────────────────────────────────────────────────────────────────────────
// Capabilities (F2.7)
// ─────────────────────────────────────────────────────────────────────────────

export const CAPABILITY_NAMES = [
  'can_evaluate',
  'can_create_lineups',
  'can_register_match_events',
  'can_create_sessions',
  'can_create_plays',
  'can_see_medical',
  'can_message_families',
  'can_manage_squad',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export const updateCapabilitySchema = z.object({
  membership_id: z.string().uuid({ message: 'membership_invalid' }),
  capability_name: z.enum(CAPABILITY_NAMES, {
    message: 'capability_invalid',
  }),
  granted: z.boolean(),
});
export type UpdateCapabilityInput = z.infer<typeof updateCapabilitySchema>;
