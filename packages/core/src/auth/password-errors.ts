/**
 * Helpers para clasificar errores de auth de Supabase relacionados con la
 * contraseña. Puro y sin dependencias → testeable en Vitest.
 */

/**
 * ¿El error de `auth.updateUser({ password })` es "la nueva contraseña es igual
 * a la actual"? Supabase (GoTrue) lo devuelve con `code === 'same_password'`;
 * cubrimos además variantes de `message` por si cambia el contrato.
 *
 * Caso de uso (B1): al aceptar una invitación tras haber fijado la contraseña
 * vía recovery, el invitee re-teclea la MISMA contraseña. Eso NO es un fallo:
 * ya tiene la contraseña que quiere → el flujo debe continuar como si el update
 * hubiera ido bien (idempotente).
 */
export function isSamePasswordError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === 'string' && e.code === 'same_password') return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (msg.length === 0) return false;
  return (
    msg.includes('should be different') ||
    msg.includes('different from the old password') ||
    msg.includes('same as the old password') ||
    msg.includes('same_password')
  );
}
