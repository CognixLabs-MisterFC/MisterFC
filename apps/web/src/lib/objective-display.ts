/**
 * F13.10h-2 — Display del ESTADO de un objetivo (derivado, no es columna de BD).
 *
 * El valor persistido sigue siendo el status crudo (open/achieved/dropped); el
 * estado MOSTRADO (nuevo / en_proceso / conseguido / descartado) lo deriva
 * objectiveDisplayState (core) combinando status + created_period + el periodo del
 * informe. Aquí solo viven las CLASES de color por estado, compartidas por la
 * ficha (server) y el editor (client) para que ambas pinten igual.
 */

import type { ObjectiveDisplayState } from '@misterfc/core';

/** Clases del badge/realce por estado mostrado. */
export const OBJ_STATE_CLASS: Record<ObjectiveDisplayState, string> = {
  nuevo: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-500/30',
  en_proceso: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-500/30',
  conseguido: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-500/30',
  descartado: 'bg-red-500/10 text-red-500 dark:text-red-300/80 border-red-500/20',
};
