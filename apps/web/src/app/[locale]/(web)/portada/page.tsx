import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isMarketingSiteOn } from '@misterfc/core';
import ClubLoginPage from '../../[slug]/page';

type Props = { params: Promise<{ locale: string }> };

/**
 * Portada comercial. Nunca se visita por esta URL: el middleware sirve aquí al anónimo
 * en `/{idioma}` y manda `/{idioma}/portada` a `/{idioma}` con 308.
 *
 * W1 dejó solo el armazón (titular, spec §4.1); la cabecera y el pie los pone el layout
 * (W2). Las secciones llegan en W3.
 *
 * APAGADA: antes de la web comercial, `/{idioma}/portada` caía en `[slug]` como un slug
 * sin club. Esta carpeta estática le gana a `[slug]`, así que se delega en esa misma
 * página con `slug = 'portada'`: misterfc.es responde exactamente lo de antes.
 */
export default async function PortadaPage({ params }: Props) {
  const { locale } = await params;
  if (!isMarketingSiteOn(process.env)) {
    return ClubLoginPage({ params: Promise.resolve({ locale, slug: 'portada' }) });
  }
  setRequestLocale(locale);
  const t = await getTranslations('webComercial.portada');

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16">
      <section className="flex max-w-3xl flex-col gap-4">
        <p className="text-sm font-semibold uppercase tracking-wide text-misterfc-green-ink">
          {t('antetitulo')}
        </p>
        <h1 className="text-3xl font-bold leading-tight sm:text-5xl">{t('titular')}</h1>
        <p className="text-lg text-zinc-600">{t('subtitulo')}</p>
      </section>
    </main>
  );
}
