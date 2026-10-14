import { getRequestConfig } from 'next-intl/server';
import { hasLocale } from 'next-intl';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  // `webComercial` vive aparte (`apps/web/messages-web/`): son textos solo de la web
  // comercial, y el catálogo de `messages/` lo comparte la app nativa.
  return {
    locale,
    messages: {
      ...(await import(`../../../../messages/${locale}.json`)).default,
      webComercial: (await import(`../../messages-web/${locale}.json`)).default,
    },
  };
});
