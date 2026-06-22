'use client';

/**
 * F13.3 — Motor de reproducción de una jugada. Un reloj con requestAnimationFrame
 * avanza `t` de 0 a `playDurationMs(play)` y, en cada frame, produce la escena
 * interpolada con `sceneAtTime(play, t)` (toda la lógica vive en core 13.1a; aquí
 * solo se consume). Al llegar al final PARA (sin loop) y deja la última escena.
 *
 * `stop()` resetea a t=0. Sin estado en core, sin Date.now: el reloj es del cliente
 * (performance.now + rAF). Controles completos (pause/scrub/loop/velocidad) = 13.4.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { playDurationMs, sceneAtTime, type Play, type Scene } from '@misterfc/core';

export type Playback = {
  /** Escena interpolada en el instante actual (lista para <DiagramView>). */
  scene: Scene;
  /** ¿Hay una animación en curso (rAF activo)? */
  playing: boolean;
  /** ¿Se está mostrando la reproducción (en curso o detenida en el final)? */
  previewing: boolean;
  /** Instante actual en ms. */
  t: number;
  /** Duración total de la jugada en ms (0 si <2 frames → nada que animar). */
  total: number;
  /** Inicia la reproducción desde el principio. */
  play: () => void;
  /** Para y vuelve al inicio (t=0). */
  stop: () => void;
};

export function usePlayback(play: Play): Playback {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const rafRef = useRef<number | null>(null);

  const total = playDurationMs(play);

  const cancel = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const stop = useCallback(() => {
    cancel();
    setPlaying(false);
    setT(0);
  }, []);

  const start = useCallback(() => {
    if (total <= 0) return; // 1 frame: nada que interpolar
    cancel();
    setPlaying(true);
    setT(0);
    const startTs = performance.now();
    const tick = (now: number) => {
      const elapsed = now - startTs;
      if (elapsed >= total) {
        setT(total); // deja la última escena
        setPlaying(false);
        rafRef.current = null;
        return; // PARA al final (sin loop)
      }
      setT(elapsed);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [total]);

  // Limpieza: cancela el rAF al desmontar.
  useEffect(() => () => cancel(), []);

  const scene = sceneAtTime(play, t);
  const previewing = playing || t > 0;

  return { scene, playing, previewing, t, total, play: start, stop };
}
