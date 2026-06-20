'use client';

/**
 * F11B.1 — Cliente de la pizarra táctica EFÍMERA. Reusa <PitchEditor> tal cual.
 * Dos modos: en BLANCO o desde un EJERCICIO. En modo ejercicio hay un PICKER
 * (buscador sobre la biblioteca visible) para elegir uno; al seleccionar se
 * navega a `?exercise=<id>` y el server carga su diagrama (respeta RLS). El
 * cambio de modo/ejercicio remonta el editor (key) → reset efímero: nada
 * persiste (sin BD ni localStorage; guardar/animar = F13).
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search, ChevronDown } from 'lucide-react';
import type { Diagram } from '@misterfc/core';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { PitchEditor } from '@/components/match/pitch-editor';
import { FullscreenContainer } from '@/components/ui/fullscreen-container';
import { useIsLandscape } from '@/hooks/use-is-landscape';
import type { BoardExercise } from '../../ejercicios/queries';

type Mode = 'blank' | 'exercise';

export function PizarraClient({
  exerciseDiagram,
  exerciseName,
  exercises,
}: {
  exerciseDiagram: Diagram | null;
  exerciseName: string | null;
  exercises: BoardExercise[];
}) {
  const t = useTranslations('pizarra');
  const router = useRouter();
  const isLandscape = useIsLandscape();
  const hasExercise = exerciseDiagram != null;
  const [mode, setMode] = useState<Mode>(hasExercise ? 'exercise' : 'blank');

  const initial = mode === 'exercise' ? exerciseDiagram ?? undefined : undefined;
  // key del editor: cambia con el modo y con el ejercicio cargado → remonta y
  // resetea el estado efímero al alternar.
  const editorKey = mode === 'exercise' ? `ex:${exerciseName ?? ''}` : 'blank';

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={mode === 'blank' ? 'default' : 'outline'}
          onClick={() => setMode('blank')}
          aria-pressed={mode === 'blank'}
        >
          {t('mode_blank')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === 'exercise' ? 'default' : 'outline'}
          onClick={() => setMode('exercise')}
          aria-pressed={mode === 'exercise'}
        >
          {t('mode_exercise')}
        </Button>

        {mode === 'exercise' && (
          <ExercisePicker
            exercises={exercises}
            currentName={hasExercise ? exerciseName : null}
            onPick={(id) => router.push(`/pizarra?exercise=${id}`)}
          />
        )}
      </div>

      {mode === 'exercise' && !hasExercise && (
        <p className="text-sm text-muted-foreground">{t('pick_hint')}</p>
      )}

      {/* F13.0 — la pizarra sigue EDITABLE en pantalla completa; el campo se
          escala-a-llenar y, en apaisado, gira como bloque rígido (las coords no
          se mutan). El editor NO se remonta al entrar/salir (no se pierde el dibujo). */}
      <FullscreenContainer>
        {({ isFullscreen }) => (
          <PitchEditor
            key={editorKey}
            initialDiagram={initial}
            showClear
            showExport
            fill={isFullscreen}
            fillRotationDeg={isFullscreen && isLandscape ? 90 : 0}
            cleanChrome={isFullscreen}
          />
        )}
      </FullscreenContainer>
    </div>
  );
}

/** Selector con buscador de la biblioteca (solo ejercicios con diagrama). */
function ExercisePicker({
  exercises,
  currentName,
  onPick,
}: {
  exercises: BoardExercise[];
  currentName: string | null;
  onPick: (id: string) => void;
}) {
  const t = useTranslations('pizarra');
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? exercises.filter((e) => e.name.toLowerCase().includes(needle)) : exercises;
    return list.slice(0, 50); // tope defensivo de render
  }, [exercises, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1">
          {currentName ?? t('pick_placeholder')}
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        <div className="relative mb-2">
          <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            className="h-9 pl-8"
            placeholder={t('search_placeholder')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={t('search_placeholder')}
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">{t('no_results')}</p>
          ) : (
            filtered.map((e) => (
              <button
                key={e.id}
                type="button"
                className="block w-full truncate rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setOpen(false);
                  onPick(e.id);
                }}
              >
                {e.name}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
