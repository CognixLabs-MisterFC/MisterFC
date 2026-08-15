import { useEffect, useState } from 'react';
import * as Network from 'expo-network';
import { canAttemptFetch, isOnlineFromState } from '@misterfc/core';

/**
 * O2-5 — Detector de conectividad sobre expo-network. La DECISIÓN es pura y vive
 * en core; aquí solo la lectura del estado de red del dispositivo.
 *
 *  - `getCanFetch()`: gate de LECTURAS (SWR). Criterio PERMISIVO (`canAttemptFetch`,
 *    solo `isConnected===false` es offline): ignora la reachability, que en Android
 *    parpadea a `false` al arrancar y condenaría la pantalla a mostrar caché para
 *    siempre. La alcanzabilidad real la prueba el propio fetch.
 *  - `getIsOnline()` / `useIsOnline()`: gate de ESCRITURAS (criterio estricto
 *    `isOnlineFromState`, incluye reachability). Las pantallas que escriben pintan
 *    su aviso "sin conexión" con esto.
 */
export async function getCanFetch(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return canAttemptFetch(state);
  } catch {
    // Fail-open: si el detector falla, intentamos (la red/RLS son el gate real).
    return true;
  }
}

export async function getIsOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return isOnlineFromState(state);
  } catch {
    // Fail-open: si el detector falla, no bloqueamos (la red/RLS son el gate real).
    return true;
  }
}

export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      const state = await Network.getNetworkStateAsync().catch(() => null);
      if (active && state) setOnline(isOnlineFromState(state));
    })();
    const sub = Network.addNetworkStateListener((state) => {
      setOnline(isOnlineFromState(state));
    });
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return online;
}
