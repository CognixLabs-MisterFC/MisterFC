'use client';

import { useEffect, useRef, useState, type PointerEvent } from 'react';
import Image from 'next/image';

/** Hasta 4×: la captura de escritorio (1440 px) en un móvil de ~360 px, a su tamaño real. */
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

type Point = { x: number; y: number };
type View = { s: number; x: number; y: number };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * La imagen de la ampliación (`CaptureZoom`), con gestos táctiles: pellizcar con dos
 * dedos acerca y aleja, arrastrar con uno mueve la imagen ampliada y el doble toque
 * alterna entre 1× y 2,5× en el punto tocado.
 *
 * Solo atiende a punteros `touch`: con ratón no hace nada y el ordenador queda como
 * estaba. La imagen nunca se separa de su caja: a 1× no se mueve y, ampliada, sus
 * bordes no entran dentro de ella.
 *
 * Se monta al abrir el diálogo, así que cada ampliación empieza a 1×.
 */
export function ZoomableImage({
  src,
  width,
  height,
  alt,
  hint,
}: {
  src: string;
  width: number;
  height: number;
  alt: string;
  hint: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  const view = useRef<View>({ s: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ dist: number; view: View; mid: Point } | null>(null);
  const lastTap = useRef<{ t: number; p: Point } | null>(null);
  const moved = useRef(false);
  const [zoomed, setZoomed] = useState(false);

  /** Coloca la capa: dentro de la caja y, a 1×, en su sitio. */
  const apply = (next: View) => {
    const el = box.current;
    if (!el) return;
    const s = clamp(next.s, 1, MAX_SCALE);
    const w = el.clientWidth;
    const h = el.clientHeight;
    const v: View = {
      s,
      x: s === 1 ? 0 : clamp(next.x, w - s * w, 0),
      y: s === 1 ? 0 : clamp(next.y, h - s * h, 0),
    };
    view.current = v;
    if (layer.current)
      layer.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`;
    setZoomed(v.s > 1);
  };

  // Al girar el móvil la caja cambia de tamaño: se vuelve a 1×.
  useEffect(() => {
    const reset = () => apply({ s: 1, x: 0, y: 0 });
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, []);

  /** Punto de la pantalla en coordenadas de la caja (sin transformar). */
  const local = (p: Point): Point => {
    const r = box.current!.getBoundingClientRect();
    return { x: p.x - r.left, y: p.y - r.top };
  };

  /** Escala a `s` dejando quieto, bajo el dedo, el punto de la imagen que había en `at`. */
  const zoomAt = (from: View, s: number, at: Point, to: Point = at) => {
    const px = (at.x - from.x) / from.s;
    const py = (at.y - from.y) / from.s;
    const ns = clamp(s, 1, MAX_SCALE);
    apply({ s: ns, x: to.x - ns * px, y: to.y - ns * py });
  };

  const startPinch = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    pinch.current = {
      dist: Math.hypot(a.x - b.x, a.y - b.y),
      view: { ...view.current },
      mid: local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
    };
  };

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved.current = false;
    if (pointers.current.size === 2) startPinch();
  };

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (e.pointerType !== 'touch' || !prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (Math.hypot(cur.x - prev.x, cur.y - prev.y) > 2) moved.current = true;

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const p = pinch.current;
      const mid = local({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      zoomAt(p.view, (p.view.s * Math.hypot(a.x - b.x, a.y - b.y)) / p.dist, p.mid, mid);
    } else if (pointers.current.size === 1 && view.current.s > 1) {
      apply({
        ...view.current,
        x: view.current.x + cur.x - prev.x,
        y: view.current.y + cur.y - prev.y,
      });
    }
  };

  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'touch' || !pointers.current.has(e.pointerId)) return;
    const p = pointers.current.get(e.pointerId)!;
    const wasSingle = pointers.current.size === 1 && !pinch.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 2) startPinch();
    if (!wasSingle || moved.current || e.type === 'pointercancel') return;

    // Doble toque: alterna 1× ↔ 2,5× en el punto tocado.
    const now = Date.now();
    const last = lastTap.current;
    if (
      last &&
      now - last.t < DOUBLE_TAP_MS &&
      Math.hypot(p.x - last.p.x, p.y - last.p.y) < DOUBLE_TAP_PX
    ) {
      lastTap.current = null;
      if (view.current.s > 1) apply({ s: 1, x: 0, y: 0 });
      else zoomAt(view.current, DOUBLE_TAP_SCALE, local(p));
    } else {
      lastTap.current = { t: now, p };
    }
  };

  return (
    <>
      <div
        ref={box}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        className="relative max-h-full max-w-full touch-none [-webkit-touch-callout:none]"
      >
        <div ref={layer} className="origin-top-left will-change-transform">
          <Image
            src={src}
            alt={alt}
            width={width}
            height={height}
            unoptimized
            className="block h-auto max-h-[calc(100dvh-2rem)] w-auto max-w-full rounded-lg bg-white object-contain shadow-2xl sm:max-h-[calc(100dvh-5rem)]"
          />
        </div>
      </div>
      {!zoomed && (
        <p
          aria-hidden="true"
          className="pointer-events-none absolute bottom-6 left-1/2 hidden -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-center text-xs whitespace-nowrap text-white pointer-coarse:block"
        >
          {hint}
        </p>
      )}
    </>
  );
}
