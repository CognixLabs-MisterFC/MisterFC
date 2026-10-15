import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { isMarketingSiteOn } from '@misterfc/core';
import { LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/lib/legal-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  if (!isMarketingSiteOn(process.env)) return {};
  const { locale } = await params;
  return legalMetadata({
    slug: 'cookies',
    locale,
    title: 'Política de cookies — MisterFC',
    description: 'Cookies que utiliza el sitio web misterfc.es, de Cognix Labs, S.L.U.',
  });
}

/**
 * Texto de la web comercial (spec §10), pendiente de revisión.
 *
 * APAGADA: antes de la web comercial esta URL no casaba con ninguna ruta y daba el 404
 * global de Next. Ese mismo 404 lo da el middleware (`MARKETING_SUBPAGES`); el
 * `notFound()` es la segunda línea.
 */
export default async function CookiesPage({ params }: Props) {
  const { locale } = await params;
  if (!isMarketingSiteOn(process.env)) notFound();
  setRequestLocale(locale);
  return <LegalDocument slug="cookies" locale={locale} />;
}
