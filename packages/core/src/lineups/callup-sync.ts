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

/**
 * Regla canónica ESCALAR: estado efectivo de convocatoria de un jugador a partir
 * de su fila (o AUSENCIA de fila) en `callup_decisions`. Sin fila → CONVOCADO
 * (`called_up`); solo `discarded` resta. Es la misma regla que
 * `groupRosterByCallup` aplica por lista (de hecho, esa la reutiliza). Pensada
 * para el MARCADOR por jugador (el botón "Convocado" del detalle), que no debe
 * depender de la presencia de una fila `called_up` explícita: un suplente
 * sembrado al banquillo sin fila sigue estando convocado.
 */
export function effectiveCallupDecision(
  decision: CallupDecision | null,
): CallupDecision {
  return decision === 'discarded' ? 'discarded' : 'called_up';
}

/** Roster agrupado en CONVOCADOS vs NO CONVOCADOS (descartados). */
export interface CallupGroups<T> {
  /** Convocados = todo el roster MENOS los descartados (titulares + suplentes). */
  calledUp: T[];
  /** No convocados = solo los descartados explícitamente. */
  discarded: T[];
}

/**
 * Agrupa el roster en convocados / no convocados según la definición canónica de
 * la app: **convocados = roster − descartados** (lo que el coach lleva), **no
 * convocados = solo los descartados** en `callup_decisions`. Un jugador sin
 * decisión explícita (p.ej. un suplente que entró a la alineación con la
 * convocatoria ya publicada, sin fila `called_up`) cuenta como CONVOCADO: no
 * está descartado. Pura y agnóstica del tipo de elemento (`decisionOf` extrae la
 * decisión de cada uno). Preserva el orden de entrada.
 */
export function groupRosterByCallup<T>(
  roster: readonly T[],
  decisionOf: (item: T) => CallupDecision | null,
): CallupGroups<T> {
  const calledUp: T[] = [];
  const discarded: T[] = [];
  for (const item of roster) {
    if (effectiveCallupDecision(decisionOf(item)) === 'discarded') {
      discarded.push(item);
    } else {
      calledUp.push(item);
    }
  }
  return { calledUp, discarded };
}
