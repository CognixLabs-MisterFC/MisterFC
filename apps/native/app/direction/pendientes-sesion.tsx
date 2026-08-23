import { listTrainingsWithoutSessionFromClient } from '@misterfc/core';
import { DireccionPendingEventsScreen } from '@/screens/direction/pending-events-list';

/**
 * D2-1 — Cola "entrenos sin sesión" (<48h) para dirección (SOLO LECTURA, club-wide).
 * Cada fila → `/direction/entrenamiento` (sin sesión) vía `directionEventTarget`.
 */
export default function Screen() {
  return (
    <DireccionPendingEventsScreen
      titleKey="dir_inicio.no_session"
      cacheResource="dir-pend-sesion"
      load={listTrainingsWithoutSessionFromClient}
    />
  );
}
