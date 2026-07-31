import { useCallback, useEffect, useRef, useState } from 'react';
import { playDurationMs, sceneAtTime, type Play, type Scene } from '@misterfc/core';

/**
 * O2-5 D2 — Motor de reproducción de una jugada (versión LECTURA para native).
 * Port ligero del `usePlayback` web: un reloj rAF avanza `t` y en cada tick produce
 * la escena con `sceneAtTime(play, t)` (interpolación en core; aquí no se
 * reimplementa). Controles: play/pause, stop, seek (scrub), loop, velocidad. Sin
 * frame-a-frame (es de edición). El avance se integra por delta (`dt*speed`) leyendo
 * speed/loop/total de refs sincronizadas en efectos; el setState del tick va dentro
 * del callback de rAF (permitido, no en el cuerpo de un efecto).
 */
export const PLAYBACK_SPEEDS = [0.5, 1, 2] as const;
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export type Playback = {
  scene: Scene;
  playing: boolean;
  t: number;
  total: number;
  canAnimate: boolean;
  loop: boolean;
  speed: PlaybackSpeed;
  toggle: () => void;
  stop: () => void;
  seek: (ms: number) => void;
  setLoop: (v: boolean) => void;
  setSpeed: (v: PlaybackSpeed) => void;
};

export function usePlayback(play: Play): Playback {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const total = playDurationMs(play);
  const canAnimate = total > 0;

  const tRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const loopRef = useRef(loop);
  const speedRef = useRef<number>(speed);
  const totalRef = useRef(total);
  useEffect(() => {
    loopRef.current = loop;
  }, [loop]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    totalRef.current = total;
  }, [total]);

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
          next = next % tot;
        } else {
          tRef.current = tot;
          setT(tot);
          setPlaying(false);
          rafRef.current = null;
          lastTsRef.current = null;
          return;
        }
      }
      tRef.current = next;
      setT(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const toggle = useCallback(() => {
    if (totalRef.current <= 0) return;
    if (playing) {
      cancel();
      setPlaying(false);
      return;
    }
    if (tRef.current >= totalRef.current) {
      tRef.current = 0;
      setT(0);
    }
    startLoop();
  }, [playing, startLoop]);

  const stop = useCallback(() => {
    cancel();
    setPlaying(false);
    tRef.current = 0;
    setT(0);
  }, []);

  const seek = useCallback((ms: number) => {
    const tot = totalRef.current;
    const clamped = ms < 0 ? 0 : ms > tot ? tot : ms;
    tRef.current = clamped;
    setT(clamped);
    lastTsRef.current = null;
  }, []);

  useEffect(() => () => cancel(), []);

  const scene = sceneAtTime(play, t);

  return { scene, playing, t, total, canAnimate, loop, speed, toggle, stop, seek, setLoop, setSpeed };
}
