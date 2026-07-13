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
  // F3 — gestión del calendario (eventos). Añadido en F3.1.
  'can_manage_calendar',
  // F4 — registro de asistencia a entrenamientos. Añadido en F4.1.
  'can_mark_attendance',
  // F4 — gestión de convocatorias de partido. Añadido en F4.3.
  'can_manage_callups',
  // F11 — crear/proponer ejercicios de la biblioteca. Añadido en F11.1b. La
  // aprobación/publicación NO es capability: la gatea el rol Admin del club.
  'can_create_exercises',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/**
 * F11.9 — Agrupación por DOMINIO de las capabilities, solo para presentación del
 * panel del ayudante (sin cambio de modelo). El orden de los dominios y de las
 * capabilities dentro de cada uno es el de visualización. La etiqueta del dominio
 * se localiza (`capabilities.domains.<key>`). Invariante: cada CAPABILITY_NAME
 * aparece EXACTAMENTE una vez (lo cubre un test) → al añadir una capability nueva
 * hay que ubicarla aquí. Asistencia vive en "Entrenamientos" (casa con el nav).
 */
export const CAPABILITY_DOMAINS = [
  {
    key: 'entrenamientos',
    capabilities: ['can_create_exercises', 'can_create_sessions', 'can_mark_attendance'],
  },
  {
    key: 'partidos',
    capabilities: [
      'can_create_lineups',
      'can_create_plays',
      'can_register_match_events',
      'can_manage_callups',
    ],
  },
  {
    key: 'calendario',
    capabilities: ['can_manage_calendar'],
  },
  {
    key: 'jugadores',
    capabilities: ['can_manage_squad', 'can_see_medical', 'can_evaluate'],
  },
  {
    key: 'comunicacion',
    capabilities: ['can_message_families'],
  },
] as const satisfies ReadonlyArray<{
  key: string;
  capabilities: readonly CapabilityName[];
}>;

export type CapabilityDomainKey = (typeof CAPABILITY_DOMAINS)[number]['key'];

export const updateCapabilitySchema = z.object({
  membership_id: z.string().uuid({ message: 'membership_invalid' }),
  capability_name: z.enum(CAPABILITY_NAMES, {
    message: 'capability_invalid',
  }),
  granted: z.boolean(),
});
export type UpdateCapabilityInput = z.infer<typeof updateCapabilitySchema>;
