import { useEffect, useState } from 'react';
import * as Network from 'expo-network';
import { isOnlineFromState } from '@misterfc/core';

/**
 * O2-5 — Detector de conectividad sobre expo-network. La DECISIÓN "¿online?" es
 * pura y vive en core (`isOnlineFromState`, fail-open); aquí solo la lectura del
 * estado de red del dispositivo.
 *
 *  - `getIsOnline()`: comprobación puntual (para un fetch/escritura concreta).
 *  - `useIsOnline()`: estado reactivo para la UI (las tandas que escriben pintan
 *    el aviso "sin conexión" con esto).
 */
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
