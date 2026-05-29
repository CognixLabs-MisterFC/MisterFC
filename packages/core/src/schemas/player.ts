import { z } from 'zod';

export const PLAYER_POSITIONS = [
  'goalkeeper',
  'defender',
  'midfielder',
  'forward',
] as const;

export type PlayerPosition = (typeof PLAYER_POSITIONS)[number];

export const PLAYER_FEET = ['right', 'left', 'both'] as const;

export type PlayerFoot = (typeof PLAYER_FEET)[number];

export const PLAYER_ACCOUNT_RELATIONS = ['self', 'parent', 'guardian'] as const;

export type PlayerAccountRelation = (typeof PLAYER_ACCOUNT_RELATIONS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Fields shared
// ─────────────────────────────────────────────────────────────────────────────

const firstNameField = z
  .string()
  .trim()
  .min(1, { message: 'first_name_required' })
  .max(80, { message: 'first_name_too_long' });

/**
 * Apellidos opcionales per F2.9 hotfix 2026-05-30. La columna BD pasó a
 * nullable. Strings vacíos o solo-whitespace se normalizan a `null`.
 */
const lastNameField = z
  .union([z.string(), z.null()])
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s.length > 0 ? s : null;
  })
  .refine((v) => v === null || v.length <= 120, {
    message: 'last_name_too_long',
  });

const dateOfBirthField = z
  .string()
  .trim()
  .min(1, { message: 'date_of_birth_required' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_of_birth_invalid' })
  .refine(
    (v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const year = d.getUTCFullYear();
      if (year < 1900) return false;
      if (d.getTime() > Date.now()) return false;
      return true;
    },
    { message: 'date_of_birth_invalid' }
  );

const optionalText = (max: number, msg: string) =>
  z
    .string()
    .trim()
    .max(max, { message: msg })
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .nullable();

const dorsalField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'number' ? v : Number(v);
  })
  .refine(
    (v) => v === null || (Number.isInteger(v) && v >= 1 && v <= 99),
    { message: 'dorsal_invalid' }
  );

const positionField = z
  .enum([...PLAYER_POSITIONS, ''] as const, { message: 'position_invalid' })
  .optional()
  .transform((v) => (v && v.length > 0 ? (v as PlayerPosition) : null))
  .nullable();

const positionsSecondaryField = z
  .array(z.enum(PLAYER_POSITIONS, { message: 'position_invalid' }))
  .max(4, { message: 'positions_secondary_too_many' })
  .default([]);

const footField = z
  .enum([...PLAYER_FEET, ''] as const, { message: 'foot_invalid' })
  .optional()
  .transform((v) => (v && v.length > 0 ? (v as PlayerFoot) : null))
  .nullable();

const heightCmField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    return typeof v === 'number' ? v : Number(v);
  })
  .refine(
    (v) => v === null || (Number.isInteger(v) && v >= 50 && v <= 250),
    { message: 'height_cm_invalid' }
  );

const weightKgField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    return Number(String(v).replace(',', '.'));
  })
  .refine(
    (v) => v === null || (Number.isFinite(v) && v >= 10 && v <= 200),
    { message: 'weight_kg_invalid' }
  );

// ─────────────────────────────────────────────────────────────────────────────
// Schemas exportados
// ─────────────────────────────────────────────────────────────────────────────

export const createPlayerSchema = z.object({
  first_name: firstNameField,
  last_name: lastNameField,
  date_of_birth: dateOfBirthField,
  dorsal: dorsalField,
  position_main: positionField,
  positions_secondary: positionsSecondaryField,
  foot: footField,
  height_cm: heightCmField,
  weight_kg: weightKgField,
  origin: optionalText(120, 'origin_too_long'),
  /** Equipo destino opcional. Si presente, se crea team_members al alta. */
  team_id: z
    .string()
    .uuid({ message: 'team_invalid' })
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null))
    .nullable(),
});
export type CreatePlayerInput = z.infer<typeof createPlayerSchema>;

export const updatePlayerSchema = z.object({
  first_name: firstNameField,
  last_name: lastNameField,
  date_of_birth: dateOfBirthField,
  dorsal: dorsalField,
  position_main: positionField,
  positions_secondary: positionsSecondaryField,
  foot: footField,
  height_cm: heightCmField,
  weight_kg: weightKgField,
  origin: optionalText(120, 'origin_too_long'),
});
export type UpdatePlayerInput = z.infer<typeof updatePlayerSchema>;

export const updateMedicalNotesSchema = z.object({
  medical_notes: z
    .string()
    .max(5000, { message: 'medical_notes_too_long' })
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : null))
    .nullable(),
});
export type UpdateMedicalNotesInput = z.infer<typeof updateMedicalNotesSchema>;

/**
 * Foto del jugador. Tipos y tamaño aceptados: igual que avatar de perfil.
 * El path se construye client-side y se sube; aquí solo validamos los metadatos.
 */
export const PLAYER_PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export const PLAYER_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export const playerPhotoUploadSchema = z.object({
  mimeType: z.enum(PLAYER_PHOTO_MIME_TYPES, {
    message: 'player_photo_mime_invalid',
  }),
  size: z
    .number()
    .int()
    .min(1, { message: 'player_photo_empty' })
    .max(PLAYER_PHOTO_MAX_BYTES, { message: 'player_photo_too_large' }),
});
export type PlayerPhotoUploadInput = z.infer<typeof playerPhotoUploadSchema>;

/**
 * Asignar/mover jugador a un equipo. Cierra el `team_members` activo
 * (si lo hay en cualquier equipo) y abre uno nuevo en `team_id`.
 */
export const assignPlayerToTeamSchema = z.object({
  team_id: z.string().uuid({ message: 'team_invalid' }),
  dorsal_in_team: dorsalField,
  position_in_team: positionField,
});
export type AssignPlayerToTeamInput = z.infer<typeof assignPlayerToTeamSchema>;

/**
 * Invitar tutor (familia) vinculado a un jugador. Reusa el flujo de
 * `invitations` extendido con `player_id` + `player_relation` (F2.4).
 */
export const invitePlayerTutorSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ message: 'email_invalid' })
    .max(254, { message: 'email_too_long' }),
  relation: z.enum(['parent', 'guardian'], { message: 'relation_invalid' }),
});
export type InvitePlayerTutorInput = z.infer<typeof invitePlayerTutorSchema>;
