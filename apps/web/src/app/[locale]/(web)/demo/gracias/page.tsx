import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2 } from 'lucide-react';
import { isMarketingSiteOn } from '@misterfc/core';

type Props = { params: Promise<{ locale: string }> };

/** Confirmación de la solicitud: fuera de los buscadores (spec §8.5). */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isMarketingSiteOn(process.env)) return {};
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webComercial.demo.gracias' });
  return { title: t('titulo'), robots: { index: false, follow: false } };
}

/**
 * Página de gracias del formulario de demo (spec §8.5). Repite el plazo y la duración
 * del acuse.
 *
 * APAGADA: antes de la web comercial, `/{idioma}/demo/gracias` no casaba con ninguna
 * ruta (`[slug]` no tiene subpáginas) y daba el 404 global de Next. Ese mismo 404 lo da
 * el middleware (`MARKETING_SUBPAGES`), que ni deja llegar aquí. El `notFound()` es la
 * segunda línea: si algún día no pasara por el middleware, al menos sería un 404.
 */
export default async function DemoGraciasPage({ params }: Props) {
  const { locale } = await params;
  if (!isMarketingSiteOn(process.env)) notFound();
  setRequestLocale(locale);
  const t = await getTranslations('webComercial.demo.gracias');

  return (
    <main className="flex flex-1 flex-col">
      <section className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-20 text-center sm:px-6 sm:py-28">
        <CheckCircle2 aria-hidden="true" className="h-12 w-12 text-misterfc-green-ink" />
        <h1 className="mt-6 text-3xl font-bold tracking-tight sm:text-4xl">{t('titulo')}</h1>
        <p className="mt-4 text-lg text-zinc-700">{t('texto')}</p>
        <Link
          href={`/${locale}`}
          className="mt-8 rounded font-semibold text-misterfc-green-ink underline underline-offset-4 hover:text-misterfc-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink"
        >
          {t('volver')}
        </Link>
      </section>
    </main>
  );
}
