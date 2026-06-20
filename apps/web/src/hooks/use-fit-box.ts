'use client';

/**
 * F13.0 — Escala-a-llenar (scale-to-fit) de una caja de aspecto FIJO dentro de un
 * contenedor, sin deformar y centrada. Opcionalmente rota la caja 90° (la unidad
 * rígida campo+tinta) para que su lado largo siga el lado largo de la pantalla.
 *
 * Devuelve la `style` (width/height/transform) para el HIJO y un `containerRef`
 * (callback ref) para el CONTENEDOR a medir. Se usa callback ref —no useRef+effect—
 * para que funcione aunque el contenedor se monte más tarde (p.ej. al entrar en
 * fullscreen). El aspecto se preserva siempre.
 */

import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react';

type Box = { w: number; h: number };

/**
 * @param aspectWByH  ancho/alto de la caja (p.ej. campo completo = 2/3).
 * @param rotateDeg   0 o 90 (90 = girar la unidad para apaisado).
 */
export function useFitBox(aspectWByH: number, rotateDeg: 0 | 90) {
  const [box, setBox] = useState<Box | null>(null);
  const obsRef = useRef<ResizeObserver | null>(null);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    obsRef.current?.disconnect();
    obsRef.current = null;
    if (!node) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) setBox({ w: cr.width, h: cr.height }); // callback de evento, no effect
    });
    ro.observe(node);
    obsRef.current = ro;
  }, []);

  const style = useMemo<CSSProperties>(() => {
    if (!box || box.w === 0 || box.h === 0) {
      // Pre-medida: ocupa el contenedor (evita salto).
      return { width: '100%', height: '100%' };
    }
    const a = aspectWByH;
    // h = alto del elemento (pre-rotación); w = h * a.
    // rotate 0  → footprint (w,h):   h ≤ ch  y  w=h·a ≤ cw  ⇒ h = min(ch, cw/a)
    // rotate 90 → footprint (h,w):   h ≤ cw  y  w=h·a ≤ ch  ⇒ h = min(cw, ch/a)
    const h = rotateDeg === 90 ? Math.min(box.w, box.h / a) : Math.min(box.h, box.w / a);
    const w = h * a;
    return {
      width: `${w}px`,
      height: `${h}px`,
      transform: rotateDeg === 90 ? 'rotate(90deg)' : undefined,
    };
  }, [box, aspectWByH, rotateDeg]);

  return { containerRef, style };
}
