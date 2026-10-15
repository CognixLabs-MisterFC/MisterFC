import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { WebLogo } from './logo';
import { LanguageSwitcher } from './language-switcher';

/**
 * Cabecera de la web comercial (spec §3.3).
 *
 *   escritorio: [MisterFC]  Funciones  Seguridad      ES·VA·EN  Acceso clubes  [Solicitar demo]
 *   móvil:      [MisterFC]                                     [Demo]  [Menú ▾]
 *
 * Con sesión, «Acceso clubes» pasa a «Ir a mi club» (→ /{idioma}, el Inicio de la app).
 * El menú del móvil es un <details>: se abre y se cierra sin JavaScript.
 *
 * «Solicitar demo» va relleno en verde (#10B981) con texto azul marino: en blanco sobre
 * ese verde el contraste es 2,5:1 y no llega al mínimo (4,5:1); en marino pasa de 7:1.
 */
export async function SiteHeader({ locale, signedIn }: { locale: string; signedIn: boolean }) {
  const t = await getTranslations('webComercial.cabecera');
  const access = signedIn
    ? { href: `/${locale}`, label: t('irAMiClub') }
    : { href: `/${locale}/clubes`, label: t('accesoClubes') };
  const links = [
    { href: `/${locale}/funciones`, label: t('funciones') },
    { href: `/${locale}/seguridad`, label: t('seguridad') },
  ];
  const focus =
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green-ink';

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href={`/${locale}`} aria-label={t('inicio')} className={`rounded-lg ${focus}`}>
          <WebLogo />
        </Link>

        <nav aria-label={t('navPrincipal')} className="hidden md:block">
          <ul className="flex items-center gap-6 text-sm font-medium text-zinc-700">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={`rounded hover:text-misterfc-navy ${focus}`}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto hidden items-center gap-5 md:flex">
          <LanguageSwitcher locale={locale} label={t('idioma')} />
          <Link
            href={access.href}
            className={`rounded text-sm font-medium text-zinc-700 hover:text-misterfc-navy ${focus}`}
          >
            {access.label}
          </Link>
          <Link
            href={`/${locale}/demo`}
            className={`rounded-lg bg-misterfc-green px-4 py-2 text-sm font-semibold text-misterfc-navy hover:bg-emerald-400 ${focus}`}
          >
            {t('solicitarDemo')}
          </Link>
        </div>

        <div className="ml-auto flex items-center gap-2 md:hidden">
          <Link
            href={`/${locale}/demo`}
            className={`rounded-lg bg-misterfc-green px-3 py-2 text-sm font-semibold text-misterfc-navy ${focus}`}
          >
            {t('demoCorto')}
          </Link>
          <details className="group">
            <summary
              className={`flex cursor-pointer list-none items-center gap-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-misterfc-navy [&::-webkit-details-marker]:hidden ${focus}`}
            >
              {t('menu')}
              <span aria-hidden="true" className="transition group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="absolute inset-x-0 top-16 border-b border-zinc-200 bg-white px-4 py-4 shadow-lg">
              <nav aria-label={t('navPrincipal')}>
                <ul className="flex flex-col gap-1 text-base font-medium text-misterfc-navy">
                  {[...links, access].map((l) => (
                    <li key={l.href}>
                      <Link
                        href={l.href}
                        className={`block rounded px-2 py-3 hover:bg-zinc-50 ${focus}`}
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-3 border-t border-zinc-200 px-2 pt-3">
                <LanguageSwitcher locale={locale} label={t('idioma')} />
              </div>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
