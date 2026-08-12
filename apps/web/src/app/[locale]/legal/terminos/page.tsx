import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalMarkdown } from '@/components/legal/legal-markdown';
import { readLegalDoc } from '@/lib/legal-content';
import { SITE_URL } from '@/lib/site-url';

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = {
  title: 'Términos y Condiciones — MisterFC',
  description:
    'Términos y Condiciones de uso de la plataforma MisterFC, operada por Cognix Labs, S.L.',
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/es/legal/terminos` },
};

export default async function TerminosPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalMarkdown body={readLegalDoc('terminos')} />;
}
