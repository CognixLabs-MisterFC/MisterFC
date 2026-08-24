import { CalendarioScreen } from '@/screens/family/calendario';
import { directionEventTarget } from '@/notifications/feed-target';

/**
 * 18-F3c — Sub-destino "Próximos eventos" del calendario de dirección: la agenda en modo
 * CLUB-WIDE (todos los eventos del club, sin scope por-usuario). Read-only; el tap enruta
 * con `directionEventTarget`. Alcanzado desde la tarjeta del lanzador.
 */
export default function Screen() {
  return <CalendarioScreen clubWide eventTarget={directionEventTarget} />;
}
