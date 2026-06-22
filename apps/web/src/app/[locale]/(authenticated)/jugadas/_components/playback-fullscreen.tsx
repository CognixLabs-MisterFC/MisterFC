'use client';

/**
 * F13.4 — Reproducir la jugada a PANTALLA COMPLETA (adelanta parte de 13.7; mínimo:
 * solo presentar en grande). Reusa el modo limpio de 13.0: `useFullscreen` (overlay
 * `fixed inset-0` como fuente de verdad + Fullscreen API best-effort) y `useFitBox`
 * (escala-a-llenar sin deformar; gira 90° en apaisado como bloque rígido, igual que
 * la pizarra). El campo se pinta READ-ONLY con <DiagramView> del frame interpolado
 * (presentar, no editar — D8). Instancia de reproducción PROPIA e independiente del
 * editor. Controles mínimos y discretos: Play/Pause + Salir (y Esc, vía useFullscreen).
 * Gestos/swipe entre frames quedan fuera (13.7).
 */

import { useTranslations } from 'next-intl';
import { Maximize2, Minimize2, Play as PlayIcon, Pause as PauseIcon } from 'lucide-react';
import type { Play } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { DiagramView, isDegradedField } from '@/components/match/diagram-view';
import { useFullscreen } from '@/hooks/use-fullscreen';
import { useFitBox } from '@/hooks/use-fit-box';
import { useIsLandscape } from '@/hooks/use-is-landscape';
import { usePlayback } from './use-playback';

export function PlaybackFullscreen({ play }: { play: Play }) {
  const t = useTranslations('jugadas');
  const tf = useTranslations('common.fullscreen');
  const { ref, isFullscreen, enter, exit } = useFullscreen<HTMLDivElement>();
  const isLandscape = useIsLandscape();
  const { scene, playing, canAnimate, toggle, stop } = usePlayback(play);

  // Aspecto (w/h) del lienzo: completo 2/3, medio 4/3 (degradado → 2/3). En apaisado
  // gira la unidad rígida 90° para que el lado largo siga el lado largo de la pantalla.
  const field = scene.field;
  const aspect = isDegradedField(field) ? 2 / 3 : field.kind === 'medio' ? 4 / 3 : 2 / 3;
  const { containerRef, style } = useFitBox(aspect, isFullscreen && isLandscape ? 90 : 0);

  return (
    <>
      {/* Botón "Pantalla completa" en el reproductor. */}
      <Button type="button" size="sm" variant="outline" onClick={enter} aria-label={tf('enter')}>
        <Maximize2 className="size-4" aria-hidden />
        {tf('enter')}
      </Button>

      {/* Overlay de presentación. El `ref` vive SIEMPRE (para la Fullscreen API);
          solo es `fixed` y se rellena en fullscreen. */}
      <div
        ref={ref}
        className={isFullscreen ? 'fixed inset-0 z-50 flex flex-col bg-background' : 'hidden'}
      >
        {isFullscreen && (
          <>
            {/* Campo grande, escalado-a-llenar sin deformar (read-only). */}
            <div ref={containerRef} className="flex min-h-0 flex-1 items-center justify-center p-2">
              <div style={style} className="relative">
                <DiagramView diagram={scene} fill />
              </div>
            </div>

            {/* Play/Pause: discreto, centrado abajo. */}
            <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center">
              <Button
                type="button"
                size="lg"
                className="pointer-events-auto gap-2 shadow-lg"
                onClick={toggle}
                disabled={!canAnimate}
                aria-label={playing ? t('playback.pause') : t('playback.play')}
              >
                {playing ? (
                  <PauseIcon className="size-5" aria-hidden />
                ) : (
                  <PlayIcon className="size-5" aria-hidden />
                )}
                {playing ? t('playback.pause') : t('playback.play')}
              </Button>
            </div>

            {/* Salir: botón pequeño flotante (+ Esc). Para la reproducción al salir. */}
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="absolute right-3 top-3 z-20 shadow-md"
              onClick={() => {
                stop();
                exit();
              }}
              aria-label={tf('exit')}
            >
              <Minimize2 className="size-5" aria-hidden />
            </Button>
          </>
        )}
      </div>
    </>
  );
}
