import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalMarkdown } from '@/components/legal/legal-markdown';
import { readLegalDoc } from '@/lib/legal-content';
import { SITE_URL } from '@/lib/site-url';

type Props = { params: Promise<{ locale: string }> };

export const metadata: Metadata = {
  title: 'Eliminación de cuenta — MisterFC',
  description:
    'Cómo solicitar la eliminación de tu cuenta y de tus datos en la plataforma MisterFC (Cognix Labs, S.L.).',
  robots: { index: true, follow: true },
  alternates: { canonical: `${SITE_URL}/es/legal/eliminacion-cuenta` },
};

export default async function EliminacionCuentaPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalMarkdown body={readLegalDoc('eliminacion-cuenta')} />;
}
