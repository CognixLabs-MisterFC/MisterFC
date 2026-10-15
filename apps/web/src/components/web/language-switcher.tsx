'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { localeSwitchHref } from '@misterfc/core';
import { routing } from '@/i18n/routing';

/** Cada idioma se nombra en su propia lengua (lo que busca quien no entiende el actual). */
const NAMES = { es: 'Castellano', va: 'Valencià', en: 'English' } as const;
const ORDER = ['es', 'va', 'en'] as const;

/**
 * Selector de idioma: la misma página en el otro idioma (spec §3.3). La ruta se calcula
 * en core (`localeSwitchHref`, con pruebas); aquí solo se pinta.
 */
export function LanguageSwitcher({
  locale,
  label,
  tone = 'light',
}: {
  locale: string;
  label: string;
  tone?: 'light' | 'dark';
}) {
  const pathname = usePathname() ?? `/${locale}`;
  const idle =
    tone === 'dark' ? 'text-zinc-300 hover:text-white' : 'text-zinc-600 hover:text-misterfc-navy';
  const active = tone === 'dark' ? 'text-white' : 'text-misterfc-navy';

  return (
    <nav aria-label={label}>
      <ul className="flex items-center gap-1 text-sm font-semibold">
        {ORDER.map((l, i) => (
          <li key={l} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden="true" className="text-zinc-400">
                ·
              </span>
            )}
            <Link
              href={localeSwitchHref(pathname, l, routing.locales)}
              hrefLang={l === 'va' ? 'ca' : l}
              lang={l === 'va' ? 'ca' : l}
              aria-label={NAMES[l]}
              aria-current={l === locale ? 'true' : undefined}
              className={`rounded px-1.5 py-1 uppercase ${l === locale ? `${active} underline underline-offset-4` : idle}`}
            >
              {l}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
