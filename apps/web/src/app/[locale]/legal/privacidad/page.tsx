import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { isMarketingSiteOn } from '@misterfc/core';
import { LegalAnexo, LegalDocument } from '@/components/legal/legal-document';
import { legalMetadata } from '@/lib/legal-content';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return legalMetadata({
    slug: 'privacidad',
    locale,
    title: 'Política de Privacidad — MisterFC',
    description: 'Política de privacidad de la plataforma MisterFC, prestada por Cognix Labs, S.L.',
  });
}

export default async function PrivacidadPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // El apartado 17 (web comercial y demo, spec §10.4 A) solo con la web encendida:
  // apagada, la política es la de siempre, letra a letra.
  return (
    <>
      <LegalDocument slug="privacidad" locale={locale} />
      {isMarketingSiteOn(process.env) && <LegalAnexo slug="privacidad-web" locale={locale} />}
    </>
  );
}
