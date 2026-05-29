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
 */
export const ATTENDANCE_QUICK_CYCLE = [
  'presente',
  'ausente',
  'ausente_con_aviso',
] as const satisfies ReadonlyArray<AttendanceCode>;

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
