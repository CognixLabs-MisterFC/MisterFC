import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/lib/legal-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata({
    slug: 'eliminacion-cuenta',
    locale,
    title: 'Eliminación de cuenta — MisterFC',
    description:
      'Cómo solicitar la eliminación de tu cuenta y de tus datos en la plataforma MisterFC (Cognix Labs, S.L.).',
  });
}

export default async function EliminacionCuentaPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <LegalDocument slug="eliminacion-cuenta" locale={locale} />;
}
