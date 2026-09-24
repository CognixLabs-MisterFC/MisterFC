import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/lib/legal-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata({
    slug: 'desistimiento',
    locale,
    title: 'Formulario de desistimiento — MisterFC',
    description:
      'Modelo de formulario para desistir de la suscripción anual a MisterFC, operada por Cognix Labs, S.L.U.',
  });
}

export default async function DesistimientoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalDocument slug="desistimiento" locale={locale} />;
}
