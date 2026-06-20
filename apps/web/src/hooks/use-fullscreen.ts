'use client';

/**
 * F13.0 — Fullscreen reutilizable con fallback.
 *
 * Usa la Fullscreen API nativa (true fullscreen, para proyectar/iPad) cuando el
 * elemento la soporta; si no (notablemente **iOS Safari**, que no permite
 * `requestFullscreen` en elementos sueltos) cae a un **overlay CSS** que el
 * consumidor pinta con `fixed inset-0` mirando `isFullscreen`. Así funciona en
 * móvil/tablet sí o sí. Salida con Esc (nativo lo hace solo; en fallback lo
 * gestiona este hook) y con botón (el consumidor llama a `exit`).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

type UseFullscreen<T extends HTMLElement> = {
  /** Adjuntar al contenedor que va a pantalla completa. */
  ref: React.RefObject<T | null>;
  isFullscreen: boolean;
  /** true cuando se usa el overlay CSS (no la Fullscreen API nativa). */
  usingFallback: boolean;
  enter: () => void;
  exit: () => void;
  toggle: () => void;
};

export function useFullscreen<
  T extends HTMLElement = HTMLDivElement,
>(): UseFullscreen<T> {
  const ref = useRef<T>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [usingFallback, setUsingFallback] = useState(false);

  const enter = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof el.requestFullscreen === 'function') {
      // Nativa: el estado lo sincroniza el listener de `fullscreenchange`.
      el.requestFullscreen().catch(() => {
        setUsingFallback(true);
        setIsFullscreen(true);
      });
    } else {
      // iOS Safari y otros: overlay CSS.
      setUsingFallback(true);
      setIsFullscreen(true);
    }
  }, []);

  const exit = useCallback(() => {
    if (usingFallback) {
      setUsingFallback(false);
      setIsFullscreen(false);
      return;
    }
    if (typeof document !== 'undefined' && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
    setIsFullscreen(false);
  }, [usingFallback]);

  const toggle = useCallback(() => {
    if (isFullscreen) exit();
    else enter();
  }, [isFullscreen, enter, exit]);

  // Nativa: sincroniza cuando el navegador entra/sale (incluido Esc o gesto).
  useEffect(() => {
    if (usingFallback) return;
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === ref.current);
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, [usingFallback]);

  // Fallback: Esc cierra el overlay (la API nativa ya lo hace por su cuenta).
  useEffect(() => {
    if (!usingFallback || !isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setUsingFallback(false);
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [usingFallback, isFullscreen]);

  return { ref, isFullscreen, usingFallback, enter, exit, toggle };
}
