'use client';

/**
 * F11.8 — Botón "Exportar" de la ficha. Descarga el JSON exportable (envoltorio
 * versionado + SOLO contenido) que construye el server con `buildExerciseExport`.
 * Presentacional: no toca BD ni revela campos de ciclo.
 */

import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import type { ExerciseExport } from '@misterfc/core';
import { Button } from '@/components/ui/button';

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita diacríticos
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.length > 0 ? s : 'ejercicio';
}

export function ExerciseExportButton({ data }: { data: ExerciseExport }) {
  const t = useTranslations('ejercicios');

  function onExport() {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slugify(data.exercise.name)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="outline" size="sm" onClick={onExport}>
      <Download className="size-4" aria-hidden />
      {t('actions.export')}
    </Button>
  );
}
