import { z } from 'zod';

/**
 * Schema del formulario de signin (magic link). Solo email.
 */
export const signinSchema = z.object({
  email: z.string().email(),
});

export type SigninInput = z.infer<typeof signinSchema>;

/**
 * Schema del onboarding de club (admin_club).
 *
 * - `name`: nombre humano del club (1-120 chars, igual que clubs.name).
 * - `locale`: idioma por defecto del club, debe coincidir con clubs.locale.
 *
 * El `slug` se deriva del nombre vía `nameToSlug` y se valida server-side
 * contra unicidad antes del insert.
 */
export const createClubSchema = z.object({
  name: z.string().trim().min(1).max(120),
  locale: z.enum(['es', 'en', 'va']).default('es'),
});

export type CreateClubInput = z.infer<typeof createClubSchema>;
