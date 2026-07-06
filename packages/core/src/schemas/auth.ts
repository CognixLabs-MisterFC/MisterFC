import { z } from 'zod';

/**
 * Política mínima de contraseñas en MisterFC.
 *
 * 8 chars es el mínimo que Supabase Auth permite por defecto. Mantenemos esa
 * frontera para Ola 1 y delegamos en Supabase el rate limiting / lockout.
 * Cuando entremos en Fase 14 (RGPD para menores) revisaremos la política.
 */
const PASSWORD_MIN_LENGTH = 8;

const passwordField = z.string().min(PASSWORD_MIN_LENGTH, { message: 'password_too_short' });

const emailField = z.string().trim().email();

/**
 * Nombre completo del perfil. Coincide con el CHECK de `public.profiles.full_name`
 * (1-120 chars). Mínimo 2 caracteres para evitar nombres triviales tipo "A".
 */
const fullNameField = z
  .string()
  .trim()
  .min(2, { message: 'full_name_too_short' })
  .max(120, { message: 'full_name_too_long' });

/**
 * Fecha de nacimiento opcional. Acepta cadena ISO `YYYY-MM-DD` que es el formato
 * nativo del `<input type="date">`. Vacío se trata como `null`. Validación
 * razonable: no puede ser fecha futura ni anterior a 1900.
 *
 * En profiles es opcional; obligatorio en `players` (Fase 2).
 */
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

/**
 * Schema del formulario de signin con email + password.
 */
export const signinSchema = z.object({
  email: emailField,
  password: z.string().min(1, { message: 'password_required' }),
});

export type SigninInput = z.infer<typeof signinSchema>;

/**
 * Schema del formulario público de signup con datos mínimos de perfil.
 *
 * `confirm` se valida cliente-side y server-side. Cuando no coinciden, el error
 * se reporta en `confirm` (no en `password`) para que el form pinte el mensaje
 * en el campo correcto.
 *
 * `full_name` se propaga a `profiles.full_name` vía el trigger `handle_new_user`
 * que lee `raw_user_meta_data->>full_name` al crear el row.
 * `locale` lo añade el server action (no se pide al user en el form).
 */
export const signupSchema = z
  .object({
    email: emailField,
    full_name: fullNameField,
    password: passwordField,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'password_mismatch',
    path: ['confirm'],
  });

export type SignupInput = z.infer<typeof signupSchema>;

/**
 * Schema del formulario "olvidé mi contraseña". Solo email.
 */
export const forgotPasswordSchema = z.object({
  email: emailField,
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

/**
 * Schema del formulario de reset de contraseña (tras click en email de reset).
 * La sesión ya está activa cuando llega aquí, así que solo hay password nuevo.
 */
export const resetPasswordSchema = z
  .object({
    password: passwordField,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'password_mismatch',
    path: ['confirm'],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

/**
 * Schema del formulario "establece tu contraseña + datos del perfil" al aceptar
 * una invitación.
 *
 * El email NO se acepta como input: viene de la invitación verificada server-side.
 * El user puede llegar a esta página de dos maneras (ver ADR-0004):
 *  1. Con sesión temporal de Supabase Invite y sin password aún → rellena este form.
 *  2. Ya autenticado con password (porque pertenece a otro club) → no rellena form, solo acepta.
 *
 * `full_name` y `date_of_birth` se persisten en `public.profiles` (ya creado por
 * el trigger `handle_new_user` cuando Supabase Invite insertó la fila en `auth.users`).
 */
export const acceptInvitationWithProfileSchema = z
  .object({
    full_name: fullNameField,
    date_of_birth: dateOfBirthField,
    password: passwordField,
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    message: 'password_mismatch',
    path: ['confirm'],
  });

export type AcceptInvitationWithProfileInput = z.infer<
  typeof acceptInvitationWithProfileSchema
>;

/**
 * Schema del onboarding de club (admin_club).
 */
export const createClubSchema = z.object({
  name: z.string().trim().min(1).max(120),
  locale: z.enum(['es', 'en', 'va']).default('es'),
});

export type CreateClubInput = z.infer<typeof createClubSchema>;

/**
 * Schema del formulario de invitación a un club.
 */
export const sendInvitationSchema = z.object({
  email: emailField,
  role: z.enum([
    'admin_club',
    'director',
    'coordinador',
    'entrenador_principal',
    'entrenador_ayudante',
    'jugador',
  ]),
  team_id: z.string().uuid().optional().nullable(),
});

export type SendInvitationInput = z.infer<typeof sendInvitationSchema>;
