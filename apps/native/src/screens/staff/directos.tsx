import { DirectosListScreen } from '@/directo/directos-screen';

/**
 * O2 Bloque F — Directos (staff): mismo listado de la semana + seguir equipos que
 * el jugador (componente COMPARTIDO `DirectosListScreen`, loaders club-wide). Solo
 * cambia el destino del detalle: `/staff/directo`. Sustituye al placeholder.
 */
export function DirectosScreen() {
  return <DirectosListScreen detailPathname="/staff/directo" />;
}
