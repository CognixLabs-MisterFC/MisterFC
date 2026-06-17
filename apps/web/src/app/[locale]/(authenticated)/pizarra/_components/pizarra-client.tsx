'use client';

/**
 * F11B.1 — Cliente de la pizarra táctica EFÍMERA. Reusa <PitchEditor> tal cual.
 * Dos modos: en BLANCO o desde un EJERCICIO (su diagrama, ya validado en el
 * server). El cambio de modo remonta el editor (key) reseteando su estado: nada
 * persiste (sin BD ni localStorage; guardar/animar = F13). El `onChange` se
 * ignora a propósito — la pizarra no guarda.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Diagram } from '@misterfc/core';
import { Button } from '@/components/ui/button';
import { PitchEditor } from '@/components/match/pitch-editor';

type Mode = 'blank' | 'exercise';

export function PizarraClient({
  exerciseDiagram,
  exerciseName,
}: {
  exerciseDiagram: Diagram | null;
  exerciseName: string | null;
}) {
  const t = useTranslations('pizarra');
  const hasExercise = exerciseDiagram != null;
  const [mode, setMode] = useState<Mode>(hasExercise ? 'exercise' : 'blank');

  const initial = mode === 'exercise' ? exerciseDiagram ?? undefined : undefined;

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
          disabled={!hasExercise}
          onClick={() => setMode('exercise')}
          aria-pressed={mode === 'exercise'}
        >
          {t('mode_exercise')}
        </Button>
        {mode === 'exercise' && exerciseName && (
          <span className="text-sm text-muted-foreground">{t('from_exercise', { name: exerciseName })}</span>
        )}
      </div>

      {/* key={mode} → remonta el editor al cambiar de modo (reset efímero). */}
      <PitchEditor key={mode} initialDiagram={initial} showClear />
    </div>
  );
}
