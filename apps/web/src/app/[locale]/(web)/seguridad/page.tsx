import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HeartPulse, KeyRound, Lock, Server, ShieldCheck, Users } from 'lucide-react';
import { isMarketingSiteOn } from '@misterfc/core';
import { CapturePlaceholder } from '@/components/web/capture-placeholder';
import { captureLabels } from '@/components/web/captures';
import ClubLoginPage from '../../[slug]/page';
import { webMetadata } from '@/lib/web/web-metadata';

type Props = { params: Promise<{ locale: string }> };

/**
 * Página de seguridad y protección del menor (spec §6). Publica SOLO las afirmaciones
 * verificadas de §6.1 (S1–S19), con el texto de la spec, en los bloques de §6.3, y acaba
 * con el enlace a la política de privacidad. Nada de §6.2: ni «ni nosotros vemos tus
 * datos» ni equivalentes, ni cifrado, 2FA, cumplimiento o «los datos no salen de la UE».
 *
 * APAGADA: antes de la web comercial, `/{idioma}/seguridad` caía en `[slug]` como un slug
 * sin club. Esta carpeta estática le gana a `[slug]`, así que se delega en esa misma
 * página: misterfc.es responde exactamente lo de antes.
 */
const BLOCKS = [
  { key: 'b1', icon: Lock, items: ['S1', 'S2', 'S3', 'S4'] },
  { key: 'b2', icon: Users, items: ['S5', 'S6', 'S7', 'S8'] },
  { key: 'b3', icon: HeartPulse, items: ['S9', 'S10'] },
  { key: 'b4', icon: ShieldCheck, items: ['S11', 'S12'] },
  { key: 'b5', icon: KeyRound, items: ['S13', 'S14'] },
  { key: 'b6', icon: Server, items: ['S15', 'S16', 'S17', 'S18', 'S19'] },
] as const;

/** Título, descripción, canonical, hreflang y OpenGraph (spec §11). Apagada, nada. */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'webComercial.seguridad' });
  return webMetadata({
    locale,
    path: '/seguridad',
    title: t('titulo'),
    description: t('intro'),
  });
}

export default async function SeguridadPage({ params }: Props) {
  const { locale } = await params;
  if (!isMarketingSiteOn(process.env)) {
    return ClubLoginPage({ params: Promise.resolve({ locale, slug: 'seguridad' }) });
  }
  setRequestLocale(locale);
  const t = await getTranslations('webComercial.seguridad');
  const capture = await captureLabels();
  const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
  const bold = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-misterfc-navy">{chunks}</strong>
  );

  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-misterfc-navy text-white">
        <div className={`${container} py-14 sm:py-16`}>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('titulo')}</h1>
          <p className="mt-4 max-w-2xl text-lg text-zinc-300">{t('intro')}</p>
        </div>
      </section>

      <div className={`${container} flex flex-col gap-6 py-14`}>
        {BLOCKS.map(({ key, icon: Icon, items }) => (
          <section
            key={key}
            aria-labelledby={`bloque-${key}`}
            className={`grid gap-8 rounded-2xl border border-zinc-200 p-6 sm:p-8 ${key === 'b2' ? 'lg:grid-cols-[1fr_auto]' : ''}`}
          >
            <div>
              <h2
                id={`bloque-${key}`}
                className="flex items-center gap-3 text-xl font-bold sm:text-2xl"
              >
                <Icon aria-hidden="true" className="h-6 w-6 shrink-0 text-misterfc-green-ink" />
                {t(key)}
              </h2>
              <ul className="mt-5 flex flex-col gap-4">
                {items.map((s) => (
                  <li key={s} className="flex gap-3 text-zinc-700">
                    <span
                      aria-hidden="true"
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-misterfc-green"
                    />
                    <span>{t.rich(s, { b: bold })}</span>
                  </li>
                ))}
              </ul>
            </div>
            {key === 'b2' && (
              <CapturePlaceholder device="phone" {...capture('M5')} className="mx-auto w-36" />
            )}
          </section>
        ))}

        <p className="mt-4 text-zinc-700">
          {t.rich('privacidad', {
            link: (chunks) => (
              <Link
                href={`/${locale}/legal/privacidad`}
                className="rounded font-semibold text-misterfc-green-ink underline underline-offset-4 hover:text-misterfc-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      </div>
    </main>
  );
}
