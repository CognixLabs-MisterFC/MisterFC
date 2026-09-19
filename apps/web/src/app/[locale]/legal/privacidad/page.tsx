import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/lib/legal-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata({
    slug: 'privacidad',
    locale,
    title: 'Política de Privacidad — MisterFC',
    description:
      'Política de privacidad de la plataforma MisterFC, prestada por Cognix Labs, S.L.',
  });
}

export default async function PrivacidadPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalDocument slug="privacidad" locale={locale} />;
}
