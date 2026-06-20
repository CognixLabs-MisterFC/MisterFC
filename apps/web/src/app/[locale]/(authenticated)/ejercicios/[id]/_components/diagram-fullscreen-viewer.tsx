'use client';

/**
 * F13.0 — Visor de diagrama del ejercicio con botón "Pantalla completa"
 * (read-only). La ficha es server component; este wrapper cliente añade el
 * fullscreen reutilizable alrededor de <DiagramView>.
 *
 * A diferencia de la pizarra, el visor NO re-orienta (el diagrama guardado tiene
 * su orientación): en fullscreen solo escala-a-llenar sin deformar, manteniendo
 * su orientación.
 */

import type { Diagram } from '@misterfc/core';
import { DiagramView, isDegradedField } from '@/components/match/diagram-view';
import { FullscreenContainer } from '@/components/ui/fullscreen-container';
import { useFitBox } from '@/hooks/use-fit-box';

export function DiagramFullscreenViewer({ diagram }: { diagram: Diagram }) {
  // Aspecto (w/h) del lienzo del diagrama: completo 2/3, medio 4/3 (degrada a 2/3).
  const aspect = isDegradedField(diagram.field)
    ? 2 / 3
    : diagram.field.kind === 'medio'
      ? 4 / 3
      : 2 / 3;
  // Sin rotación (rotate 0): mantiene la orientación guardada.
  const { containerRef, style } = useFitBox(aspect, 0);

  return (
    <FullscreenContainer>
      {({ isFullscreen }) =>
        isFullscreen ? (
          <div
            ref={containerRef}
            className="flex min-h-0 flex-1 items-center justify-center"
          >
            <div style={style} className="relative">
              <DiagramView diagram={diagram} fill />
            </div>
          </div>
        ) : (
          <DiagramView diagram={diagram} />
        )
      }
    </FullscreenContainer>
  );
}
