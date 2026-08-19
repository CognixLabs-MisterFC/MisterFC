import { DirectosListScreen } from '@/directo/directos-screen';

/**
 * O2-5 B1 — Directos (familia): listado de la semana + seguir equipos. La lógica
 * vive en el componente COMPARTIDO `DirectosListScreen` (reutilizado por el staff);
 * la familia solo fija el destino del detalle a `/family/directo`. Comportamiento
 * idéntico al de antes de la extracción.
 */
export function DirectosScreen() {
  return <DirectosListScreen detailPathname="/family/directo" />;
}
