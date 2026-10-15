import type { Metadata } from 'next';
import { hasLocale } from 'next-intl';
import {
  isMarketingSiteOn,
  marketingLanguages,
  marketingUrl,
  OG_LOCALE,
  type MarketingLocale,
} from '@misterfc/core';
import { routing } from '@/i18n/routing';
import { SITE_URL } from '@/lib/site-url';

/**
 * Metadatos de una página comercial (spec §11): título y descripción por página e
 * idioma, canonical a sí misma (la portada, a `/{idioma}`), hreflang con `ca` para `/va`
 * y `x-default` al castellano, y OpenGraph con la imagen de su idioma.
 *
 * Apagada (`MARKETING_SITE`), `{}`: la página delega en `[slug]` y su HTML tiene que ser
 * el de antes, sin una sola etiqueta de más.
 */
export function webMetadata(args: {
  locale: string;
  /** Ruta tras el idioma: `''` para la portada, `/funciones`… */
  path: string;
  title: string;
  description: string;
  /** La portada lleva el título entero, sin la plantilla «%s · MisterFC». */
  absoluteTitle?: boolean;
}): Metadata {
  if (!isMarketingSiteOn(process.env) || !hasLocale(routing.locales, args.locale)) return {};
  const locale = args.locale as MarketingLocale;
  const url = marketingUrl(SITE_URL, locale, args.path);
  const ogTitle = args.absoluteTitle ? args.title : `${args.title} · MisterFC`;

  return {
    metadataBase: new URL(SITE_URL),
    title: args.absoluteTitle ? { absolute: args.title } : args.title,
    description: args.description,
    alternates: { canonical: url, languages: marketingLanguages(SITE_URL, args.path) },
    openGraph: {
      type: 'website',
      siteName: 'MisterFC',
      url,
      title: ogTitle,
      description: args.description,
      locale: OG_LOCALE[locale],
      images: [{ url: `/web/og/${locale}.png`, width: 1200, height: 630, alt: 'MisterFC' }],
    },
    twitter: { card: 'summary_large_image', title: ogTitle, description: args.description },
  };
}
