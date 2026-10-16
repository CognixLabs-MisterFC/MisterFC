import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { isMarketingSiteOn } from '@misterfc/core';
import { CaptureFrame } from '@/components/web/capture-frame';
import { captureLabels, type CaptureId } from '@/components/web/captures';
import { DemoButton } from '@/components/web/demo-button';
import ClubLoginPage from '../../[slug]/page';
import { webMetadata } from '@/lib/web/web-metadata';

type Props = { params: Promise<{ locale: string }> };

/**
 * Página de funciones (spec §5): lo que hace HOY la app, por áreas (A–G de §5.1), con el
 * captura de cada una (§9.4 y §9.5). Solo lo que existe; lo de §5.3 no se anuncia, y
 * lo que es solo web no se dice «desde el móvil» (§5.2).
 *
 * APAGADA: antes de la web comercial, `/{idioma}/funciones` caía en `[slug]` como un slug
 * sin club. Esta carpeta estática le gana a `[slug]`, así que se delega en esa misma
 * página: misterfc.es responde exactamente lo de antes.
 */
const AREAS: readonly {
  key: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
  captures: readonly { id: CaptureId; device: 'laptop' | 'phone' }[];
}[] = [
  { key: 'A', captures: [{ id: 'C12', device: 'laptop' }] },
  {
    key: 'B',
    captures: [
      { id: 'C3', device: 'laptop' },
      { id: 'C4', device: 'laptop' },
      { id: 'C11', device: 'laptop' },
    ],
  },
  {
    key: 'C',
    captures: [
      { id: 'C5', device: 'laptop' },
      { id: 'M2', device: 'phone' },
    ],
  },
  {
    key: 'D',
    captures: [
      { id: 'C7', device: 'laptop' },
      { id: 'M4', device: 'phone' },
    ],
  },
  { key: 'E', captures: [{ id: 'M3', device: 'phone' }] },
  { key: 'F', captures: [{ id: 'M6', device: 'phone' }] },
  { key: 'G', captures: [] },
];

/** Título, descripción, canonical, hreflang y OpenGraph (spec §11). Apagada, nada. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webComercial.funciones' });
  return webMetadata({
    locale,
    path: '/funciones',
    title: t('titulo'),
    description: t('intro'),
  });
}

export default async function FuncionesPage({ params }: Props) {
  const { locale } = await params;
  if (!isMarketingSiteOn(process.env)) {
    return ClubLoginPage({ params: Promise.resolve({ locale, slug: 'funciones' }) });
  }
  setRequestLocale(locale);
  const t = await getTranslations('webComercial.funciones');
  const capture = await captureLabels();
  const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6';

  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-gradient-to-b from-emerald-50 to-white">
        <div className={`${container} py-14 sm:py-16`}>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('titulo')}</h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-600">{t('intro')}</p>
        </div>
      </section>

      {AREAS.map((area, i) => {
        const items = t.raw(`${area.key}.items`) as string[];
        return (
          <section
            key={area.key}
            aria-labelledby={`area-${area.key}`}
            className={i % 2 === 1 ? 'bg-zinc-50' : ''}
          >
            <div
              className={`${container} grid gap-10 py-14 ${area.captures.length > 0 ? 'lg:grid-cols-[1fr_1fr]' : ''}`}
            >
              <div>
                <h2
                  id={`area-${area.key}`}
                  className="text-2xl font-bold tracking-tight sm:text-3xl"
                >
                  {t(`${area.key}.titulo`)}
                </h2>
                <ul className="mt-6 flex flex-col gap-3">
                  {items.map((item) => (
                    <li key={item} className="flex gap-3 text-zinc-700">
                      <span
                        aria-hidden="true"
                        className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-misterfc-green"
                      />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {area.captures.length > 0 && (
                <div className="flex flex-wrap content-center items-center justify-center gap-6">
                  {area.captures.map((c) => (
                    <CaptureFrame
                      key={c.id}
                      device={c.device}
                      {...capture(c.id)}
                      sizes={c.device === 'phone' ? '150px' : '(min-width: 1024px) 440px, 90vw'}
                      className={
                        c.device === 'phone'
                          ? 'w-32 sm:w-36'
                          : area.captures.length > 2
                            ? 'w-full sm:w-[46%]'
                            : 'w-full sm:w-[75%]'
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          </section>
        );
      })}

      <section className={`${container} py-16 text-center`}>
        <DemoButton locale={locale} label={t('cta')} size="lg" />
      </section>
    </main>
  );
}
