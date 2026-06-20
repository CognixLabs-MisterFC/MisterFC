'use client';

/**
 * F13.0 — Contenedor con botón "Pantalla completa" reutilizable.
 *
 * Envuelve cualquier contenido (la pizarra editable F11B, el visor de diagramas
 * read-only, …) y le añade un botón de entrar/salir. En fullscreen aplica un
 * overlay `fixed inset-0` (sirve tanto para la Fullscreen API nativa como para el
 * fallback CSS de iOS Safari, ver useFullscreen) con fondo del tema y un botón de
 * salir grande y táctil. NO remonta el contenido al alternar (no se pierde el
 * estado efímero del editor). Salida también con Esc.
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

  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col gap-2',
        isFullscreen &&
          'fixed inset-0 z-50 overflow-auto bg-background p-3 sm:p-4',
        className
      )}
    >
      <div className="flex justify-end">
        {isFullscreen ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="gap-2"
            onClick={exit}
            aria-label={t('exit')}
          >
            <Minimize2 className="size-5" aria-hidden />
            {t('exit')}
          </Button>
        ) : (
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
        )}
      </div>
      <div
        className={cn(
          'flex flex-col',
          isFullscreen && 'min-h-0 flex-1',
          contentClassName
        )}
      >
        {children({ isFullscreen })}
      </div>
    </div>
  );
}
