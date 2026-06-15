import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import type { Diagram } from '@misterfc/core';
import { DiagramView, isDegradedField } from '@/components/match/diagram-view';

/**
 * F11.5a — Harness visual del renderer de diagramas. Solo desarrollo (en
 * producción → 404). Ejerce TODOS los tipos de elemento para poder ojear la
 * notación. No es UI de producto.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

// Escena con un elemento de cada tipo (ids únicos), coords en % 0–100.
const SAMPLE: Diagram = {
  version: 1,
  field: { kind: 'completo', orientation: 'vertical' },
  elements: [
    { type: 'jugador', id: 'j1', x_pct: 30, y_pct: 80, role: 'atacante', label: 'A' },
    { type: 'jugador', id: 'j2', x_pct: 50, y_pct: 80, role: 'defensor', label: 'B' },
    { type: 'jugador', id: 'j3', x_pct: 70, y_pct: 80, role: 'comodin', label: 'C' },
    { type: 'jugador', id: 'j4', x_pct: 50, y_pct: 96, role: 'portero' },
    { type: 'balon', id: 'b1', x_pct: 50, y_pct: 60 },
    { type: 'cono', id: 'c1', x_pct: 20, y_pct: 50 },
    { type: 'cono', id: 'c2', x_pct: 80, y_pct: 50 },
    { type: 'aro', id: 'a1', x_pct: 35, y_pct: 40 },
    { type: 'gol_conduccion', id: 'g1', x_pct: 65, y_pct: 40 },
    { type: 'porteria', id: 'p1', x_pct: 50, y_pct: 5 },
    { type: 'miniporteria', id: 'm1', x_pct: 20, y_pct: 10, rotation: 90 },
    { type: 'texto', id: 't1', x_pct: 80, y_pct: 20, text: 'Zona' },
    { type: 'flecha', id: 'f1', from: { x_pct: 30, y_pct: 75 }, to: { x_pct: 45, y_pct: 55 }, style: 'pase' },
    { type: 'flecha', id: 'f2', from: { x_pct: 70, y_pct: 75 }, to: { x_pct: 55, y_pct: 55 }, style: 'desmarque' },
    { type: 'flecha', id: 'f3', from: { x_pct: 50, y_pct: 58 }, to: { x_pct: 50, y_pct: 30 }, style: 'conduccion' },
    { type: 'linea', id: 'l1', points: [{ x_pct: 10, y_pct: 30 }, { x_pct: 25, y_pct: 25 }, { x_pct: 40, y_pct: 30 }], stroke: 'dashed' },
    { type: 'zona', id: 'z1', x_pct: 60, y_pct: 15, w_pct: 30, h_pct: 18, stroke: 'dashed' },
    { type: 'zona', id: 'z2', x_pct: 10, y_pct: 55, w_pct: 25, h_pct: 20, stroke: 'solid' },
    { type: 'cota', id: 'cota1', from: { x_pct: 10, y_pct: 90 }, to: { x_pct: 40, y_pct: 90 }, label: '40 m' },
  ],
};

// Misma escena pero pidiendo medio campo → debe DEGRADAR a completo+vertical.
const SAMPLE_MEDIO: Diagram = { ...SAMPLE, field: { kind: 'medio', orientation: 'vertical' } };

export default async function DevDiagramPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <header>
        <h1 className="text-xl font-semibold">Harness — renderer de diagramas (F11.5a)</h1>
        <p className="text-sm text-muted-foreground">
          Solo desarrollo. Escena con todos los tipos de elemento.
        </p>
      </header>

      <section className="flex flex-wrap items-start gap-8">
        <div>
          <h2 className="mb-2 text-sm font-medium">Campo completo · vertical</h2>
          <DiagramView diagram={SAMPLE} className="max-w-xs" />
        </div>

        <div>
          <h2 className="mb-2 text-sm font-medium">Campo medio (degradado)</h2>
          {isDegradedField(SAMPLE_MEDIO.field) ? (
            <p className="mb-2 max-w-xs rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
              «medio / horizontal» aún no tiene marcas propias → degradado a
              completo + vertical. Seguimiento: medio + vertical.
            </p>
          ) : null}
          <DiagramView diagram={SAMPLE_MEDIO} className="max-w-xs" />
        </div>
      </section>
    </main>
  );
}
