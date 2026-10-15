import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  BarChart3,
  ClipboardList,
  Database,
  Download,
  Globe,
  ImageOff,
  Laptop,
  Languages,
  LayoutDashboard,
  Lock,
  MessagesSquare,
  ShieldCheck,
  Smartphone,
  Stethoscope,
  Users,
} from 'lucide-react';
import { isMarketingSiteOn } from '@misterfc/core';
import { CapturePlaceholder } from '@/components/web/capture-placeholder';
import { captureLabels } from '@/components/web/captures';
import { DemoButton } from '@/components/web/demo-button';
import { StoreBadges } from '@/components/web/store-badges';
import { ClubsShowcase } from '../_components/clubs-showcase';
import ClubLoginPage from '../../[slug]/page';

type Props = { params: Promise<{ locale: string }> };

/**
 * Portada comercial (spec §4). Nunca se visita por esta URL: el middleware sirve aquí al
 * anónimo en `/{idioma}` y manda `/{idioma}/portada` a `/{idioma}` con 308.
 *
 * Orden de la spec: hero · el problema · qué cambia para cada uno · funciones destacadas
 * · seguridad · web y móvil · familias · cómo empezamos · quién está detrás · (clubes,
 * oculto) · preguntas frecuentes · CTA final. «Solicitar demo» sale 5 veces: cabecera,
 * hero, tras funciones, tras seguridad y al final (§3.4).
 *
 * Las capturas aún no existen: cada sitio lleva su hueco con marco y el código de la
 * lista de capturas (§9.4 y §9.5).
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
  const tp = await getTranslations('webComercial.pie');
  const capture = await captureLabels();

  const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
  const h2 = 'text-2xl font-bold tracking-tight sm:text-3xl';
  const textLink =
    'rounded font-semibold text-misterfc-green-ink underline underline-offset-4 hover:text-misterfc-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink';

  const problema = [
    { icon: ClipboardList, t: t('problema.i1t'), d: t('problema.i1d') },
    { icon: LayoutDashboard, t: t('problema.i2t'), d: t('problema.i2d') },
    { icon: MessagesSquare, t: t('problema.i3t'), d: t('problema.i3d') },
  ];
  const roles = (['direccion', 'coordinacion', 'entrenadores', 'familias'] as const).map((r) => ({
    t: t(`roles.${r}T`),
    d: t(`roles.${r}D`),
  }));
  const funciones = [
    { n: 1, cap: capture('C3'), device: 'laptop' as const },
    { n: 2, cap: capture('C5'), device: 'laptop' as const },
    { n: 3, cap: capture('M2'), device: 'phone' as const },
    { n: 4, cap: capture('C7'), device: 'laptop' as const },
    { n: 5, cap: capture('C1'), device: 'laptop' as const },
    { n: 6, cap: capture('M3'), device: 'phone' as const },
  ].map((f) => ({ ...f, t: t(`funciones.f${f.n}t`), d: t(`funciones.f${f.n}d`) }));
  const seguridad = [
    { icon: Lock, text: t('seguridad.p1') },
    { icon: Database, text: t('seguridad.p2') },
    { icon: ImageOff, text: t('seguridad.p3') },
    { icon: Stethoscope, text: t('seguridad.p4') },
    { icon: Globe, text: t('seguridad.p5') },
    { icon: Download, text: t('seguridad.p6') },
  ];
  const plataformas = [
    { icon: Laptop, t: t('plataformas.webT'), d: t('plataformas.webD') },
    { icon: Smartphone, t: t('plataformas.appT'), d: t('plataformas.appD') },
    { icon: Languages, t: t('plataformas.idiomasT'), d: t('plataformas.idiomasD') },
  ];
  const pasos = [1, 2, 3].map((n) => ({ n, t: t(`pasos.p${n}t`), d: t(`pasos.p${n}d`) }));
  // `coste` y `familias`: MisterFC lo pagan las familias (suscripción anual por cuenta,
  // en la app); los clubes no pagan. Sin cifras en ningún sitio (spec §13.3).
  const faq = [
    'coste',
    'familias',
    'instalar',
    'conexion',
    'jugadores',
    'valenciano',
    'menores',
  ] as const;

  return (
    <main className="flex flex-1 flex-col">
      {/* 4.1 Hero */}
      <section className="overflow-hidden bg-gradient-to-b from-emerald-50 to-white">
        <div
          className={`${container} grid items-center gap-12 py-14 sm:py-20 lg:grid-cols-[1.05fr_1fr]`}
        >
          <div className="flex flex-col gap-5">
            <p className="text-sm font-semibold uppercase tracking-wide text-misterfc-green-ink">
              {t('hero.antetitulo')}
            </p>
            <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              {t('hero.titular')}
            </h1>
            <p className="text-lg text-zinc-600">{t('hero.subtitulo')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-4">
              <DemoButton locale={locale} label={t('hero.ctaDemo')} size="lg" />
              <Link href={`/${locale}/funciones`} className={textLink}>
                {t('hero.ctaFunciones')}
              </Link>
            </div>
            <p className="text-sm text-zinc-600">{t('hero.sinCoste')}</p>
          </div>
          <div className="relative mx-auto w-full max-w-xl pb-6 pr-10 sm:pr-16">
            <CapturePlaceholder device="laptop" {...capture('C1')} />
            <CapturePlaceholder
              device="phone"
              {...capture('M1')}
              className="absolute bottom-0 right-0 w-[24%] min-w-[84px]"
            />
          </div>
        </div>
      </section>

      {/* 4.2 El problema */}
      <section aria-labelledby="problema" className={`${container} py-16`}>
        <h2 id="problema" className={h2}>
          {t('problema.titulo')}
        </h2>
        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {problema.map(({ icon: Icon, t: title, d }) => (
            <li key={title} className="rounded-2xl border border-zinc-200 p-6">
              <Icon aria-hidden="true" className="h-6 w-6 text-misterfc-green-ink" />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-zinc-600">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 4.3 Qué cambia para cada uno */}
      <section aria-labelledby="roles" className="bg-zinc-50">
        <div className={`${container} py-16`}>
          <h2 id="roles" className={h2}>
            {t('roles.titulo')}
          </h2>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2">
            {roles.map((r) => (
              <li key={r.t} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
                <h3 className="flex items-center gap-2 font-semibold">
                  <Users aria-hidden="true" className="h-5 w-5 text-misterfc-green-ink" />
                  {r.t}
                </h3>
                <p className="mt-2 text-zinc-600">{r.d}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4.4 Funciones destacadas */}
      <section aria-labelledby="funciones" className={`${container} py-16`}>
        <h2 id="funciones" className={h2}>
          {t('funciones.titulo')}
        </h2>
        <ul className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {funciones.map((f) => (
            <li key={f.n} className="flex flex-col gap-4">
              <div className="flex aspect-[4/3] items-center justify-center rounded-2xl bg-zinc-50 p-4">
                <CapturePlaceholder
                  device={f.device}
                  {...f.cap}
                  className={f.device === 'phone' ? 'w-[28%]' : 'w-[82%]'}
                />
              </div>
              <div>
                <h3 className="font-semibold">{f.t}</h3>
                <p className="mt-1 text-zinc-600">{f.d}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap items-center gap-4">
          <DemoButton locale={locale} label={t('hero.ctaDemo')} />
          <Link href={`/${locale}/funciones`} className={textLink}>
            {t('funciones.verTodas')}
          </Link>
        </div>
      </section>

      {/* 4.5 Seguridad y protección del menor */}
      <section aria-labelledby="seguridad" className="bg-misterfc-navy text-white">
        <div className={`${container} py-16`}>
          <div className="flex items-center gap-3">
            <ShieldCheck aria-hidden="true" className="h-8 w-8 text-misterfc-green" />
            <h2 id="seguridad" className={h2}>
              {t('seguridad.titulo')}
            </h2>
          </div>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {seguridad.map(({ icon: Icon, text }) => (
              <li key={text} className="flex gap-3 rounded-2xl bg-white/5 p-5 ring-1 ring-white/10">
                <Icon aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-misterfc-green" />
                <p className="text-zinc-200">{text}</p>
              </li>
            ))}
          </ul>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <DemoButton locale={locale} label={t('hero.ctaDemo')} />
            <Link
              href={`/${locale}/seguridad`}
              className="rounded font-semibold text-white underline underline-offset-4 hover:text-misterfc-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green"
            >
              {t('seguridad.enlace')}
            </Link>
          </div>
        </div>
      </section>

      {/* 4.6 Web y móvil */}
      <section aria-labelledby="plataformas" className={`${container} py-16`}>
        <h2 id="plataformas" className={h2}>
          {t('plataformas.titulo')}
        </h2>
        <ul className="mt-8 grid gap-5 md:grid-cols-3">
          {plataformas.map(({ icon: Icon, t: title, d }) => (
            <li key={title} className="rounded-2xl border border-zinc-200 p-6">
              <Icon aria-hidden="true" className="h-6 w-6 text-misterfc-green-ink" />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="mt-2 text-zinc-600">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 4.7 Familias (§7.1) */}
      <section aria-labelledby="familias" className={`${container} pb-16`}>
        <div className="flex flex-col gap-5 rounded-2xl bg-emerald-50 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="max-w-2xl">
            <h2 id="familias" className="text-xl font-bold">
              {t('familias.titulo')}
            </h2>
            <p className="mt-2 text-zinc-700">{t('familias.texto')}</p>
            <p className="mt-2 text-zinc-700">{t('familias.suscripcion')}</p>
          </div>
          <StoreBadges
            locale={locale}
            alts={{ apple: tp('altAppStore'), google: tp('altGooglePlay') }}
          />
        </div>
      </section>

      {/* 4.8 Cómo empezamos */}
      <section aria-labelledby="pasos" className="bg-zinc-50">
        <div className={`${container} py-16`}>
          <h2 id="pasos" className={h2}>
            {t('pasos.titulo')}
          </h2>
          <ol className="mt-8 grid gap-5 md:grid-cols-3">
            {pasos.map((p) => (
              <li key={p.n} className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-zinc-200">
                <span
                  aria-hidden="true"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-misterfc-green font-bold text-misterfc-navy"
                >
                  {p.n}
                </span>
                <h3 className="mt-4 font-semibold">{p.t}</h3>
                <p className="mt-1 text-zinc-600">{p.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 4.9 Quién está detrás */}
      <section aria-labelledby="quien" className={`${container} py-16`}>
        <h2 id="quien" className={h2}>
          {t('quien.titulo')}
        </h2>
        <p className="mt-4 max-w-2xl text-lg text-zinc-700">{t('quien.texto')}</p>
      </section>

      {/* §7.2 Clubes: oculto salvo permiso firmado y NEXT_PUBLIC_WEB_SHOWCASE=on */}
      <ClubsShowcase />

      {/* 4.10 Preguntas frecuentes */}
      <section aria-labelledby="faq" className="bg-zinc-50">
        <div className={`${container} py-16`}>
          <h2 id="faq" className={h2}>
            {t('faq.titulo')}
          </h2>
          <div className="mt-8 divide-y divide-zinc-200 rounded-2xl bg-white ring-1 ring-zinc-200">
            {faq.map((k) => (
              <details key={k} className="group px-6 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {t(`faq.${k}P`)}
                  <span
                    aria-hidden="true"
                    className="text-misterfc-green-ink transition group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-zinc-600">
                  {t(`faq.${k}R`)}
                  {k === 'menores' && (
                    <>
                      {' '}
                      <Link href={`/${locale}/seguridad`} className={textLink}>
                        {t('faq.menoresEnlace')}
                      </Link>
                    </>
                  )}
                </p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 4.11 CTA final */}
      <section aria-labelledby="final" className={`${container} py-20 text-center`}>
        <BarChart3 aria-hidden="true" className="mx-auto h-8 w-8 text-misterfc-green-ink" />
        <h2 id="final" className={`${h2} mt-4`}>
          {t('final.titulo')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-zinc-600">{t('final.texto')}</p>
        <div className="mt-8">
          <DemoButton locale={locale} label={t('final.cta')} size="lg" />
        </div>
      </section>
    </main>
  );
}
