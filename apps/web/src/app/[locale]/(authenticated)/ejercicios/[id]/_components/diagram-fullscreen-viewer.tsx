'use client';

/**
 * F13.0 — Visor de diagrama del ejercicio con botón "Pantalla completa"
 * (read-only). La ficha es server component; este wrapper cliente añade el
 * fullscreen reutilizable alrededor de <DiagramView>.
 */

import type { Diagram } from '@misterfc/core';
import { DiagramView } from '@/components/match/diagram-view';
import { FullscreenContainer } from '@/components/ui/fullscreen-container';

export function DiagramFullscreenViewer({ diagram }: { diagram: Diagram }) {
  return (
    <FullscreenContainer contentClassName="mx-auto w-full max-w-2xl">
      <DiagramView diagram={diagram} />
    </FullscreenContainer>
  );
}
