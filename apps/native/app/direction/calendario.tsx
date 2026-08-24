import { DireccionCalendarioHubScreen } from '@/screens/direction/calendario-hub';

/**
 * 18-F3c — Pestaña "Calendario" de dirección (barra) = LANZADERA de 3 tarjetas
 * (Próximos eventos · Temporada · Festivos). Destino único de la palabra "Calendario"
 * (barra y menú). Antes esta ruta montaba DireccionCalendarioScreen (festivos), que ahora
 * vive en `calendario-festivos.tsx`.
 */
export default function Screen() {
  return <DireccionCalendarioHubScreen />;
}
