'use client';

/**
 * F13.0 — Fullscreen reutilizable, robusto en todos los entornos.
 *
 * El **overlay CSS** (`isFullscreen` → el consumidor pinta `fixed inset-0`) es la
 * FUENTE DE VERDAD: `enter()` lo activa de forma SÍNCRONA, así que el modo limpio
 * se renderiza siempre (móvil/tablet, iframe del preview, etc.). Además, como
 * EXTRA, se pide la Fullscreen API nativa (proyectar/iPad real) en best-effort: si
 * el navegador la concede, mejor; si la resuelve sin entrar, la rechaza o no la
 * soporta (iOS Safari), da igual — el overlay ya cubre.
 *
 * Bug previo: delegábamos `isFullscreen` al evento `fullscreenchange`; si
 * `requestFullscreen()` resolvía SIN entrar (headless / iframe) no había rechazo
 * (no saltaba el fallback) ni evento → el modo limpio nunca se activaba.
 *
 * Salida: con `exit()` (botón) y con Esc. El overlay es INDEPENDIENTE del estado
 * de fullscreen nativo: NO se sincroniza con `fullscreenchange` porque algunos
 * navegadores entran y salen del fullscreen nativo de forma espuria (disparando
 * `fullscreenchange` con `fullscreenElement=null`), lo que apagaría el overlay y
 * devolvería el toolbar. El botón de salir siempre está visible.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type UseFullscreen<T extends HTMLElement> = {
  ref: React.RefObject<T | null>;
  isFullscreen: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
};

export function useFullscreen<
  T extends HTMLElement = HTMLDivElement,
>(): UseFullscreen<T> {
  const ref = useRef<T>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setIsFullscreen(true); // overlay = fuente de verdad (síncrono, siempre fiable)
    // Extra best-effort: fullscreen real del navegador si está disponible.
    el.requestFullscreen?.().catch(() => {});
  }, []);

  const exit = useCallback(() => {
    setIsFullscreen(false);
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, []);

  const toggle = useCallback(() => {
    if (isFullscreen) exit();
    else enter();
  }, [isFullscreen, enter, exit]);

  // Esc cierra el overlay (y, de paso, el fullscreen nativo si lo hubiera).
  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen, exit]);

  return { ref, isFullscreen, enter, exit, toggle };
}
