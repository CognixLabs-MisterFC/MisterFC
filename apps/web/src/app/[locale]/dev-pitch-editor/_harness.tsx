'use client';

import { useState } from 'react';
import { parseDiagram, type Diagram } from '@misterfc/core';
import { PitchEditor } from '@/components/match/pitch-editor';

/**
 * F11.5b (PR1) — Cliente del harness: edita un diagrama y muestra el JSON
 * resultante + si pasa parseDiagram, para revisar la interacción y que la salida
 * es siempre válida. Solo desarrollo.
 */
export function PitchEditorHarness() {
  const [diagram, setDiagram] = useState<Diagram | null>(null);
  const valid = diagram ? parseDiagram(diagram).success : true;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <PitchEditor onChange={setDiagram} />
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium">Salida (Diagram)</span>
          <span
            className={
              valid
                ? 'rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800'
                : 'rounded bg-red-100 px-2 py-0.5 text-xs text-red-800'
            }
          >
            {valid ? 'parseDiagram ✓' : 'parseDiagram ✗'}
          </span>
          <span className="text-xs text-muted-foreground">
            {diagram ? `${diagram.elements.length} elementos` : '—'}
          </span>
        </div>
        <pre className="max-h-[70vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
          {diagram ? JSON.stringify(diagram, null, 2) : '// edita el campo para ver el JSON'}
        </pre>
      </div>
    </div>
  );
}
