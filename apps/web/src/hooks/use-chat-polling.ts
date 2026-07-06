'use client';

import { useEffect, useRef } from 'react';

/**
 * F5B-3b — Infra compartida de auto-refresco por POLLING de los hilos de chat
 * (1:1 y grupo). Decisión de producto: NO realtime; refresco cada ~5s mientras
 * el hilo está abierto y en primer plano, en pausa si la pestaña se oculta.
 */

/** Intervalo de polling. Subir a 10000 si hiciera falta bajar la carga. */
export const CHAT_POLL_INTERVAL_MS = 5000;

/** ¿El contenedor scrolleable está (casi) al fondo? Umbral de 80px. */
export function isNearBottom(el: HTMLElement | null): boolean {
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

/**
 * Ejecuta `callback` cada `intervalMs` SOLO mientras `document` esté visible.
 * - Pausa en visibilitychange→hidden; reanuda al volver y dispara un refresco
 *   inmediato (para ver de golpe lo llegado mientras estaba oculto).
 * - Limpia el intervalo y el listener al desmontar (sin fugas).
 * - `enabled=false` lo desactiva por completo.
 *
 * Patrón callback-ref: el intervalo no se recrea aunque `callback` cambie de
 * identidad en cada render (evita reiniciar el reloj a cada tecla).
 */
export function useVisibleInterval(
  callback: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const savedCb = useRef(callback);
  useEffect(() => {
    savedCb.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof document === 'undefined') return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer != null) return;
      timer = setInterval(() => savedCb.current(), intervalMs);
    };
    const stop = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        savedCb.current();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
}

/**
 * Fusiona la lista de mensajes del servidor con los OPTIMISTAS pendientes que el
 * usuario aún tiene en pantalla. El servidor es autoridad de los confirmados; se
 * conservan los optimistas (`id` con prefijo `optimistic-`) que todavía NO estén
 * representados en el servidor. Dedup por (emisor + cuerpo) para no duplicar un
 * mensaje propio en la ventana en la que el envío se confirma mientras llega un
 * poll. Los optimistas van al final (son los más recientes).
 */
export function mergePolledMessages<
  T extends { id: string; sender_profile_id: string; body: string },
>(server: T[], prev: T[]): T[] {
  const optimistic = prev.filter((m) => m.id.startsWith('optimistic-'));
  if (optimistic.length === 0) return server;
  const serverKeys = new Set(
    server.map((m) => `${m.sender_profile_id} · ${m.body}`),
  );
  const stillPending = optimistic.filter(
    (m) => !serverKeys.has(`${m.sender_profile_id} · ${m.body}`),
  );
  return [...server, ...stillPending];
}
