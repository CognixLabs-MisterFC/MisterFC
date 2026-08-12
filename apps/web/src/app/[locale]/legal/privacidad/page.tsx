import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalMarkdown } from '@/components/legal/legal-markdown';
import { readLegalDoc } from '@/lib/legal-content';
import { SITE_URL } from '@/lib/site-url';

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = {
  title: 'Política de Privacidad — MisterFC',
  description:
    'Política de privacidad de la plataforma MisterFC, prestada por Cognix Labs, S.L.',
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/es/legal/privacidad` },
};

export default async function PrivacidadPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalMarkdown body={readLegalDoc('privacidad')} />;
}
