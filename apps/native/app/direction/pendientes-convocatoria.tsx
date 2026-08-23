import { listPendingCallupsFromClient } from '@misterfc/core';
import { DireccionPendingEventsScreen } from '@/screens/direction/pending-events-list';

/**
 * D2-1 — Cola "convocatorias sin publicar" (+60d) para dirección (SOLO LECTURA,
 * club-wide). Cada fila → `/direction/convocatoria` read-only (#499) vía
 * `directionEventTarget`.
 */
export default function Screen() {
  return (
    <DireccionPendingEventsScreen
      titleKey="dir_inicio.callups"
      cacheResource="dir-pend-callup"
      load={listPendingCallupsFromClient}
    />
  );
}
