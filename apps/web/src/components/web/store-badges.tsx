import { STORE_BADGE_LOCALE } from '@misterfc/core';
import { APP_STORE_URL, PLAY_STORE_URL } from '@/lib/family-web-cut';

type BadgeLocale = keyof typeof STORE_BADGE_LOCALE;

/**
 * Distintivos OFICIALES de App Store y Google Play, en el idioma de la página
 * (valenciano: los catalanes). Ficheros descargados de Apple
 * (toolbox.marketingtools.apple.com) y Google (play.google.com/intl/…/badges) el
 * 2026-10-15. Los PNG de Google, recortados solo de su margen transparente (cada idioma
 * trae uno distinto); así los dos se pintan a 40 px de alto visible, como piden sus guías.
 * El espacio libre alrededor lo pone el `gap`.
 *
 * Los enlaces son los de `family-web-cut.ts`, los mismos que ya usa la app: si una
 * tienda deja de tener URL, su distintivo no se pinta.
 */
export function StoreBadges({
  locale,
  alts,
}: {
  locale: string;
  alts: { apple: string; google: string };
}) {
  const l = STORE_BADGE_LOCALE[(locale in STORE_BADGE_LOCALE ? locale : 'es') as BadgeLocale];
  return (
    <div className="flex flex-wrap items-center gap-3">
      {APP_STORE_URL && (
        <a href={APP_STORE_URL} rel="noopener" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- SVG oficial, sin optimizar */}
          <img
            src={`/web/tiendas/app-store-${l.apple}.svg`}
            alt={alts.apple}
            height={40}
            className="h-10 w-auto"
          />
        </a>
      )}
      {PLAY_STORE_URL && (
        <a href={PLAY_STORE_URL} rel="noopener" className="inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element -- PNG oficial, sin optimizar */}
          <img
            src={`/web/tiendas/google-play-${l.google}.png`}
            alt={alts.google}
            height={40}
            className="h-10 w-auto"
          />
        </a>
      )}
    </div>
  );
}
