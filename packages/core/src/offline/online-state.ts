/**
 * O2-5 — Decisión pura "¿hay conexión?" a partir de un estado de red.
 *
 * Framework-agnóstica: la app nativa la alimenta con lo que devuelve
 * `expo-network` (`{ isConnected, isInternetReachable }`); web no la usa. Se
 * mantiene en core para testear el criterio sin dependencias nativas.
 *
 * Criterio FAIL-OPEN: solo se considera OFFLINE cuando el estado dice
 * explícitamente que no hay conexión / no es alcanzable. Ante desconocido
 * (`null`/`undefined`) se asume online — el offline es una AYUDA de UX (evitar
 * intentar escrituras sin red), no un control de seguridad; un falso "offline"
 * bloquearía a un usuario que sí tiene red. La red/RLS son el gate real.
 */
export type NetworkStateInput = {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
};

export function isOnlineFromState(state: NetworkStateInput | null | undefined): boolean {
  if (!state) return true;
  if (state.isConnected === false) return false;
  if (state.isInternetReachable === false) return false;
  return true;
}

/**
 * Criterio de conectividad para LECTURAS con caché (SWR).
 *
 * MÁS PERMISIVO que `isOnlineFromState` a propósito: solo se considera OFFLINE
 * cuando NO hay radio (`isConnected === false`). `isInternetReachable` se IGNORA
 * aquí porque en Android puede reportar `false` transitoriamente en el arranque
 * (antes de que resuelva la sonda de alcanzabilidad); si eso condenara la lectura
 * a la caché, la pantalla mostraría datos viejos "para siempre". La alcanzabilidad
 * REAL se comprueba con el propio fetch: si falla, `readThrough` cae a la caché y
 * marca el banner. Así una sonda que parpadea a `false` ya no fija la pantalla en
 * caché — el siguiente intento (SWR/foco) reintenta.
 *
 * `isOnlineFromState` (más estricto, incluye reachability) se mantiene para el
 * GATE DE ESCRITURAS (`useIsOnline`): una escritura sí quiere reachability antes
 * de intentarse, y su fallo no es recuperable como el de una lectura.
 */
export function canAttemptFetch(state: NetworkStateInput | null | undefined): boolean {
  return state?.isConnected !== false;
}
