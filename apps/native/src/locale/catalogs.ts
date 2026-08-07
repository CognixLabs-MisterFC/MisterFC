import type { Messages } from '@misterfc/core';
import esJson from '../../../../messages/es.json';
import enJson from '../../../../messages/en.json';
import vaJson from '../../../../messages/va.json';

/**
 * CATÁLOGO COMPARTIDO web+app. La FUENTE DE VERDAD es `messages/{es,en,va}.json`
 * en la raíz del monorepo (el mismo JSON que consume next-intl en apps/web). Metro
 * lo resuelve porque su `watchFolders` incluye la raíz (ver metro.config.js); tsc
 * lo importa por `resolveJsonModule` de la base de Expo. NO se duplica ni se copia.
 */
export const LOCALES = ['es', 'en', 'va'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'es';

/** true si el string es uno de los locales soportados (guarda profiles.locale, etc.). */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

// El tipo que infiere resolveJsonModule es más estrecho que Messages; el cast es seguro
// (son objetos anidados de strings) y evita arrastrar los literales al motor genérico.
export const CATALOGS: Record<Locale, Messages> = {
  es: esJson as unknown as Messages,
  en: enJson as unknown as Messages,
  va: vaJson as unknown as Messages,
};
