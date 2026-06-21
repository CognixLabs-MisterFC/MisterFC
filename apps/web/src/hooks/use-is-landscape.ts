'use client';

/**
 * F13.0 — ¿la pantalla está en apaisado? Reacciona a girar el dispositivo.
 * useSyncExternalStore evita setState-en-effect y es SSR-safe (snapshot = false).
 */

import { useSyncExternalStore } from 'react';

const QUERY = '(orientation: landscape)';

function subscribe(cb: () => void): () => void {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function useIsLandscape(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
