import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DEMO_EQUIPOS, DEMO_PAPELES, isMarketingSiteOn } from '@misterfc/core';
import ClubLoginPage from '../../[slug]/page';
import { DemoForm, type DemoFormTextos } from './demo-form';

type Props = { params: Promise<{ locale: string }> };

const CONTACTO = 'info.cognixlabs@gmail.com';

/**
 * Formulario de demo (spec §8): Server Action + Zod, campo trampa, límite por IP y
 * Resend; página propia, sin pop-up.
 *
 * El formulario es de cliente (estado de envío y errores) y `webComercial` no viaja al
 * navegador: esta página le pasa los textos ya resueltos.
 *
 * APAGADA: antes de la web comercial, `/{idioma}/demo` caía en `[slug]` como un slug sin
 * club. Esta carpeta estática le gana a `[slug]`, así que se delega en esa misma página.
 */
export default async function DemoPage({ params }: Props) {
  const { locale } = await params;
  if (!isMarketingSiteOn(process.env)) {
    return ClubLoginPage({ params: Promise.resolve({ locale, slug: 'demo' }) });
  }
  setRequestLocale(locale);
  const t = await getTranslations('webComercial.demo');
  const container = 'mx-auto w-full max-w-6xl px-4 sm:px-6';
  const enlace =
    'rounded font-semibold text-misterfc-green-ink underline underline-offset-4 hover:text-misterfc-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink';
  const privacidad = (chunks: React.ReactNode) => (
    <Link href={`/${locale}/legal/privacidad`} className={enlace}>
      {chunks}
    </Link>
  );
  const correo = () => (
    <a href={`mailto:${CONTACTO}`} className={enlace}>
      {CONTACTO}
    </a>
  );
  const b = (chunks: React.ReactNode) => (
    <strong className="font-semibold text-misterfc-navy">{chunks}</strong>
  );

  const textos: DemoFormTextos = {
    campos: {
      nombre: t('campos.nombre'),
      papel: t('campos.papel'),
      club: t('campos.club'),
      municipio: t('campos.municipio'),
      equipos: t('campos.equipos'),
      email: t('campos.email'),
      telefono: t('campos.telefono'),
      comentario: t('campos.comentario'),
      privacidad: t.rich('campos.privacidad', { link: privacidad }),
    },
    opcional: t('opcional'),
    elige: t('elige'),
    comentarioMax: t('comentarioMax'),
    papeles: DEMO_PAPELES.map((v) => ({ v, label: t(`papeles.${v}`) })),
    equipos: DEMO_EQUIPOS.map((v) => ({ v, label: t(`equiposOpciones.${v}`) })),
    enviar: t('enviar'),
    enviando: t('enviando'),
    errores: {
      resumen: t('errores.resumen'),
      requerido: t('errores.requerido'),
      email: t('errores.email'),
      telefono: t('errores.telefono'),
      comentario: t('errores.comentario'),
      privacidad: t('errores.privacidad'),
      envio: t.rich('errores.envio', { correo }),
      limite: t.rich('errores.limite', { correo }),
    },
  };

  return (
    <main className="flex flex-1 flex-col">
      <section className="bg-misterfc-navy text-white">
        <div className={`${container} py-14 sm:py-16`}>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('titulo')}</h1>
        </div>
      </section>

      <div
        className={`${container} grid gap-8 py-10 sm:py-14 lg:gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]`}
      >
        <div>
          <DemoForm locale={locale} textos={textos} />
          <section
            aria-labelledby="proteccion-datos"
            className="mt-8 border-t border-zinc-200 pt-6 text-sm text-zinc-600"
          >
            <h2 id="proteccion-datos" className="font-semibold text-misterfc-navy">
              {t('proteccion.titulo')}
            </h2>
            <ul className="mt-2 flex flex-col gap-1">
              {(['responsable', 'finalidad', 'base', 'destinatarios'] as const).map((k) => (
                <li key={k}>{t.rich(`proteccion.${k}`, { b })}</li>
              ))}
              <li>{t.rich('proteccion.conservacion', { b, link: privacidad })}</li>
            </ul>
          </section>
        </div>

        <aside className="order-first h-fit rounded-2xl bg-misterfc-green/10 p-6 lg:sticky lg:top-6 lg:order-none">
          <h2 className="text-lg font-bold">{t('despues.titulo')}</h2>
          <p className="mt-3 text-zinc-700">{t('despues.texto')}</p>
        </aside>
      </div>
    </main>
  );
}
