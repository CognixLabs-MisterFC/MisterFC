import { Redirect } from 'expo-router';

/**
 * CONMUTADOR DE ÁREA — pestaña de la barra de STAFF (modo Míster). NO es una pantalla:
 * el tab intercepta el press en `navigator.tsx` y hace `router.replace` al área que
 * toca (club o familia, según lo que el usuario tenga). Fichero requerido por
 * expo-router.
 *
 * Navegación directa → la RAÍZ, por el mismo motivo que en las otras dos áreas: el
 * destino depende del usuario y el gatekeeper ya lo resuelve.
 */
export default function StaffSwitchRoute() {
  return <Redirect href="/" />;
}
