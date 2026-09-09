import { z } from 'zod';

/**
 * El teléfono de contacto, con el MISMO criterio que la base.
 *
 * La migración 20261057000000 puso un CHECK idéntico en `profiles.phone` y en
 * `players.phone`: un juego de caracteres cerrado (dígitos y los separadores que
 * la gente escribe de verdad) y entre 6 y 15 dígitos una vez quitado el resto.
 * 15 es el máximo de E.164; 6 deja sitio a números cortos.
 *
 * Aquí se repite esa regla para poder decirle al usuario qué pasa ANTES de
 * enviar, no para sustituirla: la autoridad sigue siendo el CHECK. Si las dos
 * se separan, el síntoma es un formulario que acepta algo que la base rechaza —
 * por eso la constante y el regex están en UN sitio y los importan los dos
 * schemas (perfil y jugador) y los dos formularios.
 *
 * NO SE NORMALIZA nada más que el `trim`: lo que teclea el tutor es lo que verá
 * el entrenador. Y el vacío NO se manda como cadena: la columna lo rechazaría,
 * así que se convierte en NULL.
 */

/** Longitud máxima del campo, la del CHECK. Se usa también en los `maxLength`. */
export const PHONE_MAX_LENGTH = 24;

const PHONE_ALLOWED = /^[0-9+()./ -]{6,24}$/;
const PHONE_DIGITS_MIN = 6;
const PHONE_DIGITS_MAX = 15;

/** Los dígitos que quedan al quitar separadores. */
export function phoneDigits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

/** ¿Pasaría el CHECK de la base? */
export function isValidPhone(value: string): boolean {
  const v = value.trim();
  if (!PHONE_ALLOWED.test(v)) return false;
  const digits = phoneDigits(v).length;
  return digits >= PHONE_DIGITS_MIN && digits <= PHONE_DIGITS_MAX;
}

/**
 * Lo que se manda a la base: el texto sin espacios sobrantes, o NULL si está
 * vacío. La cadena vacía NO pasa el CHECK; mandarla sería un 23514 en la cara.
 */
export function normalizePhone(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v.length > 0 ? v : null;
}

/** Teléfono OPCIONAL (perfil, jugador). Vacío → null. */
export const phoneOptionalField = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v) => (v && v.length > 0 ? v : null))
  .refine((v) => v === null || isValidPhone(v), { message: 'phone_invalid' });

/**
 * Teléfono OBLIGATORIO (aceptar invitación). Distingue los dos casos —no lo has
 * puesto / no es un teléfono— porque el aviso que necesita quien rellena el
 * formulario no es el mismo.
 */
export const phoneRequiredField = z
  .string()
  .trim()
  .superRefine((v, ctx) => {
    if (v.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'phone_required' });
      return;
    }
    if (!isValidPhone(v)) {
      ctx.addIssue({ code: 'custom', message: 'phone_invalid' });
    }
  });
