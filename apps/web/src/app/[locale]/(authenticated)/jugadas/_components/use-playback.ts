'use client';

/**
 * F13.3/F13.4 — Motor de reproducción de una jugada. Un reloj con
 * requestAnimationFrame avanza `t` y, en cada frame, produce la escena
 * interpolada con `sceneAtTime(play, t)` (toda la lógica vive en core 13.1a;
 * aquí solo se consume; no se reimplementa interpolación).
 *
 * F13.4 — controles completos sobre ese mismo motor:
 *  - PLAY/PAUSE (`toggle`): pausar CONGELA en el `t` actual; reanudar sigue desde ahí.
 *  - STOP (`stop`): vuelve a t=0.
 *  - SCRUB (`seek`): fija `t` manualmente entre 0 y `total`.
 *  - LOOP: al llegar al final reinicia en vez de parar.
 *  - VELOCIDAD (`speed`): multiplicador aplicado al avance de `t`.
 *
 * El reloj es del cliente (performance.now + rAF). El avance se integra por delta
 * entre frames (`dt * speed`) leyendo speed/loop/total de refs (sincronizadas en
 * EFECTOS, nunca en render) → un cambio de velocidad/loop a mitad aplica al vuelo.
 * El `setState` del tick va dentro del callback de rAF (permitido), no en un efecto.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { playDurationMs, sceneAtTime, DEFAULT_FRAME_MS, type Play, type Scene } from '@misterfc/core';

/** Instante (ms) de INICIO de cada frame: start[0]=0; start[i]=start[i-1]+dur(i-1).
 *  La duración del último frame no cuenta (no hay transición después) → start[n-1]
 *  = playDurationMs(play). Longitud = nº de frames. */
function frameStartsOf(play: Play): number[] {
  const starts = [0];
  for (let i = 0; i < play.frames.length - 1; i++) {
    starts.push(starts[i]! + (play.frames[i]!.duration_ms ?? DEFAULT_FRAME_MS));
  }
  return starts;
}

/** Índice del frame cuyo inicio es <= t (el frame "actual"). */
function frameIndexAt(starts: number[], t: number): number {
  let idx = 0;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i]! <= t + 1) idx = i;
    else break;
  }
  return idx;
}

export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export type Playback = {
  /** Escena interpolada en el instante actual (lista para <DiagramView>). */
  scene: Scene;
  /** ¿Hay una reproducción en curso (rAF activo)? */
  playing: boolean;
  /** ¿Se está mostrando la reproducción (en curso, pausada o scrubbeada)? */
  previewing: boolean;
  /** Instante actual en ms. */
  t: number;
  /** Duración total de la jugada en ms (0 si <2 frames → nada que animar). */
  total: number;
  /** ¿Reproducible? (`total > 0`). */
  canAnimate: boolean;
  /** Loop activo. */
  loop: boolean;
  /** Multiplicador de velocidad. */
  speed: PlaybackSpeed;
  /** Play/Pause: reanuda desde el `t` actual (o reinicia si está en el final). */
  toggle: () => void;
  /** Para y vuelve al inicio (t=0). */
  stop: () => void;
  /** Fija `t` manualmente (scrub); lo clampa a [0, total]. */
  seek: (ms: number) => void;
  /** Activa/desactiva el loop. */
  setLoop: (v: boolean) => void;
  /** Fija la velocidad. */
  setSpeed: (v: PlaybackSpeed) => void;
  /** Nº de frames de la jugada. */
  frameCount: number;
  /** Índice (0-based) del frame actual según `t`. */
  frameIndex: number;
  /** Salta (PAUSADO) al inicio de un frame; lo clampa a [0, frameCount-1]. */
  gotoFrame: (i: number) => void;
  /** Salta al frame siguiente (snap, pausado). Para presentar frame a frame. */
  nextFrame: () => void;
  /** Salta al frame anterior (snap, pausado). */
  prevFrame: () => void;
};

export function usePlayback(play: Play): Playback {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const total = playDurationMs(play);
  const canAnimate = total > 0;
  const frameStarts = frameStartsOf(play);
  const frameCount = play.frames.length;

  // Acumulador del instante dentro del bucle rAF (no se lee/escribe en render).
  const tRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  // Refs espejo para leer valores frescos dentro del tick; se sincronizan en
  // EFECTOS (escribir refs en render está prohibido por las reglas del repo).
  const loopRef = useRef(loop);
  const speedRef = useRef<number>(speed);
  const totalRef = useRef(total);
  const frameStartsRef = useRef<number[]>(frameStarts);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);
  useEffect(() => {
    frameStartsRef.current = frameStarts;
  });

  const cancel = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    lastTsRef.current = null;
  };

  const startLoop = useCallback(() => {
    cancel();
    setPlaying(true);
    lastTsRef.current = null;
    const tick = (now: number) => {
      const tot = totalRef.current;
      if (lastTsRef.current == null) lastTsRef.current = now;
      const dt = now - lastTsRef.current;
      lastTsRef.current = now;

      let next = tRef.current + dt * speedRef.current;
      if (next >= tot) {
        if (loopRef.current && tot > 0) {
          next = next % tot; // reinicia conservando el desfase
        } else {
          tRef.current = tot;
          setT(tot); // deja la última escena
          setPlaying(false);
          rafRef.current = null;
          lastTsRef.current = null;
          return; // PARA al final
        }
      }
      tRef.current = next;
      setT(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  /** Play/Pause. Reanuda desde el `t` actual; si está en el final, reinicia. */
  const toggle = useCallback(() => {
    if (totalRef.current <= 0) return;
    if (playing) {
      cancel();
      setPlaying(false);
      return;
    }
    if (tRef.current >= totalRef.current) {
      tRef.current = 0;
      setT(0); // reinicia desde el final
    }
    startLoop();
  }, [playing, startLoop]);

  const stop = useCallback(() => {
    cancel();
    setPlaying(false);
    tRef.current = 0;
    setT(0);
  }, []);

  /** Scrub: fija t manualmente; si está en marcha, sigue desde el nuevo punto. */
  const seek = useCallback((ms: number) => {
    const tot = totalRef.current;
    const clamped = ms < 0 ? 0 : ms > tot ? tot : ms;
    tRef.current = clamped;
    setT(clamped);
    lastTsRef.current = null; // reancla el reloj para no “saltar” en el próximo tick
  }, []);

  /** Salta PAUSADO al inicio de un frame (snap, sin animar). Para presentar
   *  frame a frame con gestos (13.7): predecible, sin interpolar la transición. */
  const gotoFrame = useCallback((i: number) => {
    const starts = frameStartsRef.current;
    if (starts.length === 0) return;
    const ci = i < 0 ? 0 : i >= starts.length ? starts.length - 1 : i;
    cancel();
    setPlaying(false);
    tRef.current = starts[ci]!;
    setT(starts[ci]!);
  }, []);

  const nextFrame = useCallback(() => {
    const starts = frameStartsRef.current;
    gotoFrame(frameIndexAt(starts, tRef.current) + 1);
  }, [gotoFrame]);

  const prevFrame = useCallback(() => {
    const starts = frameStartsRef.current;
    gotoFrame(frameIndexAt(starts, tRef.current) - 1);
  }, [gotoFrame]);

  // Limpieza: cancela el rAF al desmontar.
  useEffect(() => () => cancel(), []);

  const scene = sceneAtTime(play, t);
  const previewing = playing || t > 0;
  const frameIndex = frameIndexAt(frameStarts, t);

  return {
    scene,
    playing,
    previewing,
    t,
    total,
    canAnimate,
    loop,
    speed,
    toggle,
    stop,
    seek,
    setLoop,
    setSpeed,
    frameCount,
    frameIndex,
    gotoFrame,
    nextFrame,
    prevFrame,
  };
}
