import { DirectosListScreen } from '@/directo/directos-screen';

/**
 * D1a — Directos (dirección): mismo listado club-wide de la semana + seguir equipos
 * que staff/familia (componente COMPARTIDO `DirectosListScreen`, loaders club-wide).
 * Solo cambia el destino del detalle: `/direction/directo`, la versión SOLO LECTURA
 * (dirección es de consulta; para actuar sobre el partido se usa la web). Sustituye
 * al placeholder.
 */
export function DirectosScreen() {
  return <DirectosListScreen detailPathname="/direction/directo" />;
}
