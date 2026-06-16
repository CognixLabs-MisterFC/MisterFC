import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { PitchEditorHarness } from './_harness';

/**
 * F11.5b (PR1) — Harness visual del editor de diagramas (PitchEditor). Hermano
 * de /dev-diagram (renderer read-only). Visible en local y en los previews de
 * Vercel; oculto SOLO en producción real (gateado por VERCEL_ENV, no NODE_ENV,
 * que vale 'production' también en previews). No es UI de producto.
 */
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ locale: string }> };

export default async function DevPitchEditorPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (process.env.VERCEL_ENV === 'production') notFound();

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Harness — editor de diagramas (F11.5b · PR1)</h1>
        <p className="text-sm text-muted-foreground">
          Solo desarrollo. Coloca elementos de punto, arrástralos para mover, selecciónalos para
          editar etiqueta/texto o borrar, y deshaz/rehaz. Flecha/línea/zona llegan en PR2.
        </p>
      </header>
      <PitchEditorHarness />
    </main>
  );
}
