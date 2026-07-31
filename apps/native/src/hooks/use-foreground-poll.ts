import { useEffect } from 'react';
import { AppState } from 'react-native';

/**
 * O2-5 E2a — Polling SOLO en foreground (como el de Directos, pero además pausa
 * cuando la app pasa a background, igual que la web pausa por `visibilitychange`).
 * `refresh` re-fetchea con red (fetchCached sirve la caché sin red). Sin
 * subscripciones realtime — la web tampoco las usa.
 */
export function useForegroundPoll(refresh: () => void, intervalMs: number): void {
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id == null) id = setInterval(refresh, intervalMs);
    };
    const stop = () => {
      if (id != null) {
        clearInterval(id);
        id = null;
      }
    };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        refresh();
        start();
      } else {
        stop();
      }
    });
    return () => {
      stop();
      sub.remove();
    };
  }, [refresh, intervalMs]);
}
