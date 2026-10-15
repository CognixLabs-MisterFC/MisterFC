/**
 * Web comercial de misterfc.es — el interruptor y la decisión de la raíz.
 *
 * POR QUÉ HAY INTERRUPTOR. La web comercial vive en el MISMO proyecto de Vercel que la
 * app: cada merge a `main` sale en misterfc.es al momento. Mientras `MARKETING_SITE` no
 * esté encendida, misterfc.es tiene que comportarse EXACTAMENTE como antes de la web
 * comercial (spec `docs/spec-web-comercial.md` §13.1).
 *
 * CÓMO SE LEE:
 *   · `MARKETING_SITE=on`  → encendida, en cualquier entorno.
 *   · `MARKETING_SITE=off` → apagada, en cualquier entorno.
 *   · cualquier otra cosa (sin definir, `true`, `1`…) → encendida SOLO en las vistas
 *     previas de Vercel (`VERCEL_ENV=preview`). En producción y en local, apagada.
 *
 * Falla CERRADA a propósito: un valor mal escrito en producción deja la web como estaba,
 * que es lo que se puede permitir; nunca enciende la web comercial por error.
 */
/** La forma de `process.env`: solo se leen `MARKETING_SITE` y `VERCEL_ENV`. */
export type MarketingSiteEnv = Readonly<Record<string, string | undefined>>;

export function isMarketingSiteOn(env: MarketingSiteEnv): boolean {
  const value = env.MARKETING_SITE?.trim().toLowerCase();
  if (value === 'on') return true;
  if (value === 'off') return false;
  return env.VERCEL_ENV === 'preview';
}

/** Segmento interno de la portada. Nunca es una URL pública: `/{idioma}` la sirve. */
export const MARKETING_HOME_SEGMENT = 'portada';

export type MarketingRootDecision =
  | { readonly kind: 'next' }
  | { readonly kind: 'redirect'; readonly to: string; readonly status: 307 | 308 }
  | { readonly kind: 'rewrite'; readonly to: string };

/**
 * Qué hace el middleware con la raíz de cada idioma y con `/{idioma}/portada`.
 *
 *   · `/{idioma}` CON sesión → nada: es el Inicio de la app (con o sin interruptor).
 *   · `/{idioma}` SIN sesión:
 *       - apagada  → 307 a `/{idioma}/clubes`, que es lo de siempre (F14J-2);
 *       - encendida → rewrite a `/{idioma}/portada`: la URL sigue siendo `/{idioma}`.
 *   · `/{idioma}/portada`:
 *       - encendida → 308 a `/{idioma}`, para que la portada tenga UNA sola URL;
 *       - apagada  → nada: cae en `/{slug}` como cualquier slug sin club, como antes.
 *   · Todo lo demás → nada.
 *
 * Los artefactos de auth (`?code=`, `?token_hash=`) NO pasan por aquí: el middleware
 * los reenvía a `/auth/callback` antes de llegar a esta decisión.
 */
export function marketingRootDecision(
  pathname: string,
  opts: {
    readonly locales: readonly string[];
    readonly signedIn: boolean;
    readonly siteOn: boolean;
  },
): MarketingRootDecision {
  const [, locale, segment, ...rest] = pathname.split('/');
  if (locale === undefined || !opts.locales.includes(locale)) return { kind: 'next' };

  if (segment === undefined) {
    if (opts.signedIn) return { kind: 'next' };
    return opts.siteOn
      ? { kind: 'rewrite', to: `/${locale}/${MARKETING_HOME_SEGMENT}` }
      : { kind: 'redirect', to: `/${locale}/clubes`, status: 307 };
  }

  if (segment === MARKETING_HOME_SEGMENT && rest.length === 0 && opts.siteOn) {
    return { kind: 'redirect', to: `/${locale}`, status: 308 };
  }

  return { kind: 'next' };
}
