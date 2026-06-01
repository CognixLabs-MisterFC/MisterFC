/**
 * F6.10 (fix BUG 2) — lógica pura de propagación alineación → convocatoria.
 *
 * Al colocar a un jugador en campo/banquillo queda CONVOCADO (called_up); al
 * sacarlo de la alineación sin descartarlo se limpia su called_up. Regla 6.6:
 * si la convocatoria está PUBLICADA no se auto-sincroniza en silencio (el coach
 * reabre/republica). Un descarte existente NUNCA se pisa desde la alineación.
 */

export type CallupDecision = 'called_up' | 'discarded';

export type CalledUpOp = 'insert_called_up' | 'delete_called_up' | 'noop';

/**
 * Operación al colocar a un jugador en campo/banquillo.
 *   - publicada → noop (regla 6.6).
 *   - ya tiene decisión (called_up o discarded) → noop (no pisar).
 *   - sin decisión → insertar called_up.
 */
export function calledUpOnPlace(
  existing: CallupDecision | null,
  published: boolean,
): CalledUpOp {
  if (published) return 'noop';
  if (existing) return 'noop';
  return 'insert_called_up';
}

/**
 * Operación al sacar a un jugador de la alineación (sin descartarlo).
 *   - publicada → noop (regla 6.6).
 *   - borrador → borrar su called_up (el DELETE filtra por decision='called_up',
 *     así que un descarte no se ve afectado).
 */
export function calledUpOnRemove(published: boolean): CalledUpOp {
  return published ? 'noop' : 'delete_called_up';
}
