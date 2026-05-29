import { z } from 'zod';

/**
 * F4 — Códigos de asistencia a entrenamiento.
 *
 * Contrato shared con F8 (valoraciones del partido) y F9 (perfil del
 * jugador). Cambiar el orden o eliminar valores es BREAKING — añadir
 * valores nuevos al final es compatible (alter type add value en BD,
 * union extension en TS).
 *
 * Ver ADR-0007 para la justificación del enum vs text+CHECK.
 */
export const ATTENDANCE_CODES = [
  'presente',
  'ausente',
  'ausente_con_aviso',
  'entreno_diferenciado',
  'lesionado',
  'enfermo',
  'partido_oficial',
  'viaje',
  'sancionado',
  'descanso',
] as const;

export type AttendanceCode = (typeof ATTENDANCE_CODES)[number];

/**
 * Subset de códigos que la UI ofrece como "ciclo rápido" al pulsar el
 * avatar del jugador. El cuarto pulso vuelve a `presente`. El resto se
 * eligen desde un menú.
 *
 * Decisión: los 3 más frecuentes son `presente`, `ausente`,
 * `ausente_con_aviso`. Ver spec 4.0 §D1.
 *
 * **Reservado** — F4.2 evolucionó a un layout tabla con chips visibles
 * (ver `ATTENDANCE_PRIMARY_CHIPS`); el ciclo pulsable se mantiene como
 * constante exportada por si una UI alternativa (móvil compacta) lo
 * necesita más adelante.
 */
export const ATTENDANCE_QUICK_CYCLE = [
  'presente',
  'ausente',
  'ausente_con_aviso',
] as const satisfies ReadonlyArray<AttendanceCode>;

/**
 * Chips primarios que la UI tabla de marcado (F4.2) muestra siempre
 * visibles a la derecha de cada fila. Los 7 restantes viven detrás del
 * dropdown "Otros".
 *
 * Selección: el feedback del usuario priorizó `lesionado` sobre
 * `ausente_con_aviso` como tercer chip visible — en fútbol base la
 * decisión "está lesionado" tiene consecuencias inmediatas (gestión de
 * minutos, parte médico) que justifican exposición de un click.
 * `ausente_con_aviso` sigue accesible en el dropdown.
 */
export const ATTENDANCE_PRIMARY_CHIPS = [
  'presente',
  'ausente',
  'lesionado',
] as const satisfies ReadonlyArray<AttendanceCode>;

/** Subset de códigos NO mostrados como chip — visibles tras "Otros ▼". */
export const ATTENDANCE_SECONDARY_CHIPS = [
  'ausente_con_aviso',
  'entreno_diferenciado',
  'enfermo',
  'partido_oficial',
  'viaje',
  'sancionado',
  'descanso',
] as const satisfies ReadonlyArray<AttendanceCode>;

/** TRUE si el código se renderiza como chip primario fijo. */
export function isPrimaryChip(code: AttendanceCode): boolean {
  return (ATTENDANCE_PRIMARY_CHIPS as readonly AttendanceCode[]).includes(code);
}

/**
 * Etiqueta dinámica del botón "Otros".
 *  - Sin marca → null (renderizar texto i18n por defecto).
 *  - Marca primaria → null (el chip primario lleva la indicación visual).
 *  - Marca secundaria → devuelve ese código para que el botón muestre su
 *    nombre y siga reflejando la selección activa.
 */
export function otherChipLabel(
  code: AttendanceCode | null | undefined
): AttendanceCode | null {
  if (code == null) return null;
  if (isPrimaryChip(code)) return null;
  return code;
}

/**
 * Input para `markAttendance` (acción del Lote A).
 *
 * El server action recibe esta forma desde un form HTML o desde una
 * llamada programática. `notes` opcional con límite duro para no
 * sobrecargar la BD (CHECK también lo enforce).
 */
export const markAttendanceSchema = z.object({
  event_id: z.string().uuid({ message: 'event_invalid' }),
  player_id: z.string().uuid({ message: 'player_invalid' }),
  code: z.enum(ATTENDANCE_CODES, { message: 'code_invalid' }),
  notes: z
    .string()
    .max(500, { message: 'notes_too_long' })
    .optional()
    .nullable()
    .transform((v) => {
      if (v == null) return null;
      const trimmed = v.trim();
      return trimmed.length === 0 ? null : trimmed;
    }),
});

export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

/**
 * Bulk variant — el server action puede recibir varias filas a la vez
 * para amortizar latencia en la UI cuando el entrenador marca a todo el
 * equipo en una sola pulsación.
 */
export const markAttendanceBulkSchema = z.object({
  event_id: z.string().uuid({ message: 'event_invalid' }),
  entries: z
    .array(
      z.object({
        player_id: z.string().uuid({ message: 'player_invalid' }),
        code: z.enum(ATTENDANCE_CODES, { message: 'code_invalid' }),
        notes: z
          .string()
          .max(500, { message: 'notes_too_long' })
          .optional()
          .nullable()
          .transform((v) => {
            if (v == null) return null;
            const t = v.trim();
            return t.length === 0 ? null : t;
          }),
      })
    )
    .min(1, { message: 'entries_required' })
    .max(100, { message: 'entries_too_many' }),
});

export type MarkAttendanceBulkInput = z.infer<typeof markAttendanceBulkSchema>;

/**
 * Aplica un "tick" del ciclo rápido. Útil tanto en la UI como en tests.
 *  - null → presente
 *  - presente → ausente
 *  - ausente → ausente_con_aviso
 *  - ausente_con_aviso → presente
 *  - cualquier otro código → presente (vuelve al ciclo)
 */
export function nextQuickCycle(
  current: AttendanceCode | null | undefined
): AttendanceCode {
  if (current == null) return 'presente';
  const idx = (ATTENDANCE_QUICK_CYCLE as readonly AttendanceCode[]).indexOf(
    current
  );
  if (idx === -1) return 'presente';
  return ATTENDANCE_QUICK_CYCLE[
    (idx + 1) % ATTENDANCE_QUICK_CYCLE.length
  ] as AttendanceCode;
}

/**
 * Subset de códigos que cuentan como "asistencia efectiva" para stats.
 * Los demás se contabilizan como ausencias (con o sin justificación).
 */
export const ATTENDANCE_CODES_PRESENT = ['presente'] as const satisfies ReadonlyArray<AttendanceCode>;

/**
 * Subset de códigos que cuentan como "ausencia justificada" para stats.
 * `ausente_con_aviso`, `lesionado`, `enfermo`, `partido_oficial`, `viaje`,
 * `sancionado`, `descanso`.
 */
export const ATTENDANCE_CODES_JUSTIFIED = [
  'ausente_con_aviso',
  'lesionado',
  'enfermo',
  'partido_oficial',
  'viaje',
  'sancionado',
  'descanso',
] as const satisfies ReadonlyArray<AttendanceCode>;

/**
 * Subset de códigos que cuentan como "ausencia injustificada" para stats.
 * `ausente`.
 *
 * `entreno_diferenciado` NO entra en ninguno: el jugador SÍ acudió,
 * pero no realizó el entrenamiento normal. En stats se computa como
 * "asistencia parcial" — categoría propia.
 */
export const ATTENDANCE_CODES_UNJUSTIFIED = [
  'ausente',
] as const satisfies ReadonlyArray<AttendanceCode>;

export const ATTENDANCE_CODES_PARTIAL = [
  'entreno_diferenciado',
] as const satisfies ReadonlyArray<AttendanceCode>;

export type AttendanceBucket = 'present' | 'justified' | 'unjustified' | 'partial';

export function bucketOf(code: AttendanceCode): AttendanceBucket {
  if ((ATTENDANCE_CODES_PRESENT as readonly string[]).includes(code))
    return 'present';
  if ((ATTENDANCE_CODES_JUSTIFIED as readonly string[]).includes(code))
    return 'justified';
  if ((ATTENDANCE_CODES_UNJUSTIFIED as readonly string[]).includes(code))
    return 'unjustified';
  return 'partial';
}
