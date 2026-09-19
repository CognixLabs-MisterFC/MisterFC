import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/lib/legal-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata({
    slug: 'terminos',
    locale,
    title: 'Términos y Condiciones — MisterFC',
    description:
      'Términos y Condiciones de uso de la plataforma MisterFC, operada por Cognix Labs, S.L.',
  });
}

export default async function TerminosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalDocument slug="terminos" locale={locale} />;
}
