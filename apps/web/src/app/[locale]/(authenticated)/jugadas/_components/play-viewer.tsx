'use client';

/**
 * F13.6 — Visor READ-ONLY de una jugada para el jugador/familia (playbook). Solo
 * presenta/reproduce; NO edita (D8). Reusa el motor de 13.3/13.4: `usePlayback`
 * (play/pause/scrub/loop/velocidad), `<DiagramView>` (honra la opacidad del fade)
 * y `<PlaybackFullscreen>` (presentación a pantalla completa). Espeja la barra de
 * reproducción del editor sin nada del chrome de edición.
 */

import { useTranslations } from 'next-intl';
import {
  Play as PlayIcon,
  Pause as PauseIcon,
  Square as StopIcon,
  Repeat as RepeatIcon,
} from 'lucide-react';
import type { Play } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Hint } from '@/components/ui/tooltip';
import { DiagramView } from '@/components/match/diagram-view';
import { usePlayback, PLAYBACK_SPEEDS } from './use-playback';
import { PlaybackFullscreen } from './playback-fullscreen';

/** ms → "1.2s" para la lectura de tiempo de la barra. */
function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function PlayViewer({ play }: { play: Play }) {
  const t = useTranslations('jugadas');
  const {
    scene,
    playing,
    t: tNow,
    total,
    canAnimate,
    loop,
    speed,
    toggle,
    stop,
    seek,
    setLoop,
    setSpeed,
    previewing,
  } = usePlayback(play);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-medium">{t('playback.title')}</h2>
        {canAnimate ? (
          <>
            <Button type="button" size="sm" onClick={toggle}>
              {playing ? (
                <>
                  <PauseIcon className="size-4" aria-hidden />
                  {t('playback.pause')}
                </>
              ) : (
                <>
                  <PlayIcon className="size-4" aria-hidden />
                  {t('playback.play')}
                </>
              )}
            </Button>
            <Hint label={t('playback.stop')}>
              <Button
                type="button"
                size="icon"
                variant="outline"
                onClick={stop}
                disabled={!previewing}
                aria-label={t('playback.stop')}
              >
                <StopIcon className="size-4" aria-hidden />
              </Button>
            </Hint>
            <Hint label={t('playback.loop')}>
              <Button
                type="button"
                size="icon"
                variant={loop ? 'default' : 'outline'}
                onClick={() => setLoop(!loop)}
                aria-pressed={loop}
                aria-label={t('playback.loop')}
              >
                <RepeatIcon className="size-4" aria-hidden />
              </Button>
            </Hint>
            <div className="inline-flex items-center gap-1" role="group" aria-label={t('playback.speed')}>
              {PLAYBACK_SPEEDS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  size="sm"
                  variant={speed === s ? 'default' : 'outline'}
                  onClick={() => setSpeed(s)}
                  aria-pressed={speed === s}
                >
                  {t('playback.speed_x', { x: s })}
                </Button>
              ))}
            </div>
          </>
        ) : null}
        <PlaybackFullscreen play={play} />
      </div>

      {canAnimate ? (
        <div className="flex items-center gap-3">
          <Slider
            aria-label={t('playback.scrub')}
            min={0}
            max={total}
            step={10}
            value={[tNow]}
            onValueChange={([v]) => seek(v ?? 0)}
            className="max-w-md"
          />
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {formatSeconds(tNow)} / {formatSeconds(total)}
          </span>
        </div>
      ) : null}

      {/* Read-only: <DiagramView> honra la opacidad (fade) de la Scene. */}
      <DiagramView diagram={scene} />
    </section>
  );
}
