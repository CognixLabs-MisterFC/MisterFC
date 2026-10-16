'use client';

import { useState, type ReactNode } from 'react';
import Image from 'next/image';
import { X, ZoomIn } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export type CaptureZoomLabels = { open: string; close: string };

/**
 * Hace ampliable una captura de la web comercial: encima del marco va un botón que la
 * cubre entera (cursor de lupa y un icono en la esquina) y abre la imagen grande sobre
 * fondo oscuro. Se cierra con la X, tocando fuera de la imagen o con Escape; el diálogo
 * de Radix ya lleva el foco atrapado y lo devuelve al botón al cerrar.
 *
 * La grande es el fichero original (`unoptimized`), no la miniatura del marco: las
 * capturas ya son WebP optimizados, y así no se escala hacia arriba.
 */
export function CaptureZoom({
  src,
  width,
  height,
  name,
  labels,
  className,
  iconClassName = 'bottom-3 right-3',
  children,
}: {
  src: string;
  width: number;
  height: number;
  name: string;
  labels: CaptureZoomLabels;
  className?: string;
  iconClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <div className={cn('relative', className)}>
        {children}
        <DialogPrimitive.Trigger
          aria-label={labels.open}
          className="group absolute inset-0 cursor-zoom-in rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-misterfc-green-ink"
        >
          <span
            aria-hidden="true"
            className={cn(
              'absolute flex h-7 w-7 items-center justify-center rounded-full bg-misterfc-navy/70 text-white shadow ring-2 ring-white/90 transition group-hover:bg-misterfc-navy group-focus-visible:bg-misterfc-navy',
              iconClassName,
            )}
          >
            <ZoomIn className="h-4 w-4" />
          </span>
        </DialogPrimitive.Trigger>
      </div>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/85" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none sm:p-10"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <DialogPrimitive.Title className="sr-only">{name}</DialogPrimitive.Title>
          <Image
            src={src}
            alt={name}
            width={width}
            height={height}
            unoptimized
            className="h-auto max-h-full w-auto max-w-full rounded-lg bg-white object-contain shadow-2xl"
          />
          <DialogPrimitive.Close
            aria-label={labels.close}
            className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/30 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X aria-hidden="true" className="h-6 w-6" />
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
