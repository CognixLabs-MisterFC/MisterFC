import { listPastTrainingsWithoutAttendanceFromClient } from '@misterfc/core';
import { DireccionPendingEventsScreen } from '@/screens/direction/pending-events-list';

/**
 * D2-1 — Cola "entrenos sin asistencia" (pasados <72h) para dirección (SOLO LECTURA,
 * club-wide). Cada fila → el visor del entreno vía `directionEventTarget`: con sesión,
 * `/direction/sesion?eventId` (resuelve el id, con fallback al detalle); sin sesión,
 * `/direction/entrenamiento`. NO hay vista de asistencia read-only (nadie la marcó).
 */
export default function Screen() {
  return (
    <DireccionPendingEventsScreen
      titleKey="dir_inicio.no_attendance"
      cacheResource="dir-pend-asistencia"
      load={listPastTrainingsWithoutAttendanceFromClient}
    />
  );
}
