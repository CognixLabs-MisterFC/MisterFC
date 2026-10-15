import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { WebLogo } from './logo';
import { LanguageSwitcher } from './language-switcher';
import { StoreBadges } from './store-badges';

const CONTACT_EMAIL = 'info.cognixlabs@gmail.com';

/**
 * Los legales se rotulan en castellano en los tres idiomas, como el pie legal de la app
 * (`components/legal/legal-footer.tsx`) y por el mismo motivo: los documentos SOLO
 * existen en castellano. Aviso legal y cookies llegan en W6 (spec §10).
 */
const LEGAL = [
  { slug: 'aviso-legal', label: 'Aviso legal' },
  { slug: 'privacidad', label: 'Privacidad' },
  { slug: 'cookies', label: 'Cookies' },
  { slug: 'terminos', label: 'Términos' },
] as const;

/** Pie de la web comercial (spec §3.4). */
export async function SiteFooter({ locale }: { locale: string }) {
  const t = await getTranslations('webComercial.pie');
  const tc = await getTranslations('webComercial.cabecera');
  const links = [
    { href: `/${locale}/funciones`, label: tc('funciones') },
    { href: `/${locale}/seguridad`, label: tc('seguridad') },
    { href: `/${locale}/demo`, label: tc('solicitarDemo') },
    { href: `/${locale}/clubes`, label: tc('accesoClubes') },
  ];
  const focus =
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-misterfc-green';
  const link = `rounded text-zinc-300 hover:text-white ${focus}`;

  return (
    <footer className="mt-auto bg-misterfc-navy text-sm text-zinc-300">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1.3fr]">
        <div className="flex flex-col gap-3">
          <WebLogo tone="dark" />
          <p>{t('producto')}</p>
          <p>
            {t('contacto')}:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className={`underline underline-offset-2 ${link}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
        </div>

        <nav aria-label={t('navWeb')}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            MisterFC
          </h2>
          <ul className="flex flex-col gap-2">
            {links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={link}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={t('legal')}>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('legal')}
          </h2>
          <ul className="flex flex-col gap-2">
            {LEGAL.map((l) => (
              <li key={l.slug}>
                <Link href={`/${locale}/legal/${l.slug}`} className={link} lang="es">
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            {t('app')}
          </h2>
          <StoreBadges
            locale={locale}
            alts={{ apple: t('altAppStore'), google: t('altGooglePlay') }}
          />
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-start justify-between gap-3 px-4 py-5 sm:flex-row sm:items-center sm:px-6">
          <p>© {new Date().getFullYear()} Cognix Labs</p>
          <LanguageSwitcher locale={locale} label={tc('idioma')} tone="dark" />
        </div>
      </div>
    </footer>
  );
}
