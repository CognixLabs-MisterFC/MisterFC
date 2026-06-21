'use client';

/**
 * F13.0 — Contenedor con botón "Pantalla completa" reutilizable.
 *
 * Envuelve cualquier contenido (la pizarra editable F11B, el visor de diagramas
 * read-only, …) y le añade un botón de entrar/salir. En fullscreen aplica un
 * overlay `fixed inset-0` (sirve tanto para la Fullscreen API nativa como para el
 * fallback CSS de iOS Safari, ver useFullscreen) con fondo del tema: el contenido
 * LLENA la pantalla y el botón de salir FLOTA pequeño en la esquina (no come
 * layout). Salida también con Esc.
 *
 * IMPORTANTE — un SOLO árbol, el contenido NUNCA se remonta al alternar: el
 * `<div ref>` raíz y el `<div>` que envuelve `{children}` son SIEMPRE los mismos
 * elementos (solo cambian de clase); los botones entrar/salir son hermanos
 * condicionales en posiciones fijas. Así React preserva la instancia del editor
 * (y con ella el dibujo, la herramienta y la selección) en ambos sentidos del
 * toggle. Antes se devolvían dos JSX distintos según `isFullscreen`: el
 * `{children}` caía en posiciones de árbol incompatibles → React desmontaba y
 * remontaba el editor → se perdía el dibujo al entrar/salir.
 */

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useFullscreen } from '@/hooks/use-fullscreen';

export function FullscreenContainer({
  children,
  className,
  contentClassName,
}: {
  /** Render-prop: recibe `isFullscreen` para adaptar el contenido (fill/rotación). */
  children: (state: { isFullscreen: boolean }) => ReactNode;
  /** Clases del contenedor (en modo normal). */
  className?: string;
  /** Clases del área de contenido. */
  contentClassName?: string;
}) {
  const t = useTranslations('common.fullscreen');
  const { ref, isFullscreen, enter, exit } = useFullscreen<HTMLDivElement>();

  // Un único árbol en ambos modos (ver nota arriba): el raíz y el wrapper de
  // contenido son siempre los mismos elementos; solo cambian de clase. Los
  // botones son hermanos condicionales en posiciones fijas → no remontan el
  // contenido.
  return (
    <div
      ref={ref}
      className={
        isFullscreen
          ? cn('fixed inset-0 z-50 flex flex-col bg-background', className)
          : cn('flex flex-col gap-2', className)
      }
    >
      {/* [0] Entrar: solo en modo normal. */}
      {!isFullscreen && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={enter}
            aria-label={t('enter')}
          >
            <Maximize2 className="size-4" aria-hidden />
            {t('enter')}
          </Button>
        </div>
      )}
      {/* [1] Contenido: SIEMPRE el mismo <div> en la misma posición → el editor
          no se remonta (conserva el dibujo al entrar/salir). */}
      <div
        className={
          isFullscreen
            ? cn('flex h-full w-full flex-col', contentClassName)
            : cn('flex flex-col', contentClassName)
        }
      >
        {children({ isFullscreen })}
      </div>
      {/* [2] Salir: solo en fullscreen, botón pequeño flotante (no ocupa layout). */}
      {isFullscreen && (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="absolute right-3 top-3 z-20 shadow-md"
          onClick={exit}
          aria-label={t('exit')}
        >
          <Minimize2 className="size-5" aria-hidden />
        </Button>
      )}
    </div>
  );
}
