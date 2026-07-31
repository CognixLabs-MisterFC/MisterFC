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
