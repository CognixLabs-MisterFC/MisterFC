import { CalendarTemporadaScreen } from '@/screens/family/calendario-temporada';
import { directionEventTarget } from '@/notifications/feed-target';

/**
 * 18-F3c — Sub-destino "Temporada" del calendario de dirección: la vista MES/DÍA en modo
 * CLUB-WIDE con FILTRO de equipos (obligatorio: son ~20 equipos). Read-only; el tap enruta
 * con `directionEventTarget`. Alcanzado desde la tarjeta del lanzador.
 */
export default function Screen() {
  return <CalendarTemporadaScreen clubWide teamFilter eventTarget={directionEventTarget} />;
}
