import { z } from 'zod';

const LOCALES = ['es', 'en', 'va'] as const;

const fullNameField = z
  .string()
  .trim()
  .min(2, { message: 'full_name_too_short' })
  .max(120, { message: 'full_name_too_long' });

const dateOfBirthField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine(
    (v) => {
      if (v === null) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
      const date = new Date(v);
      if (Number.isNaN(date.getTime())) return false;
      const year = date.getUTCFullYear();
      if (year < 1900) return false;
      if (date.getTime() > Date.now()) return false;
      return true;
    },
    { message: 'date_of_birth_invalid' }
  );

const localeField = z.enum(LOCALES, { message: 'locale_invalid' });

export const updateProfileSchema = z.object({
  full_name: fullNameField,
  date_of_birth: dateOfBirthField,
  locale: localeField,
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Tipos y tamaño aceptados para el avatar.
 * 2 MB cubre fotos razonables; encima de eso el cliente reescala antes de subir.
 */
export const AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

export const avatarUploadSchema = z.object({
  mimeType: z.enum(AVATAR_MIME_TYPES, { message: 'avatar_mime_invalid' }),
  size: z
    .number()
    .int()
    .min(1, { message: 'avatar_empty' })
    .max(AVATAR_MAX_BYTES, { message: 'avatar_too_large' }),
});

export type AvatarUploadInput = z.infer<typeof avatarUploadSchema>;
