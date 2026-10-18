/**
 * Cabeceras de seguridad básicas de todo misterfc.es (la app, la web comercial, las
 * legales y la API). Las pone `headers()` de `next.config.ts`.
 *
 * Sin dependencias a propósito: `next.config.ts` lo importa al compilar, y el test
 * (`packages/core/.../cabeceras-seguridad.test.ts`) lo lee sin arrastrar Next.
 *
 *   · `X-Content-Type-Options: nosniff` — el navegador no adivina tipos: un fichero
 *     servido como texto no se ejecuta como script.
 *   · `Referrer-Policy: strict-origin-when-cross-origin` — a otros sitios solo les llega
 *     el dominio, nunca la ruta: las URLs de la app llevan ids de jugadores, equipos y
 *     partidos.
 *   · `X-Frame-Options: DENY` — nadie puede meter misterfc.es en un iframe (clickjacking).
 *     Nada lo embebe: ni la web ni la app nativa, que no usa WebView. Cuando llegue la
 *     CSP irá también `frame-ancestors 'none'`, que es su equivalente moderno.
 *   · `Permissions-Policy` — cámara, micrófono y ubicación apagados para la página y para
 *     cualquier cosa que cargue: la web no los usa (las fotos se suben con el selector de
 *     ficheros, que no depende de este permiso).
 *
 * `Strict-Transport-Security` no va aquí: la pone Vercel en todo el dominio
 * (`max-age=63072000`).
 */
export const SECURITY_HEADERS: readonly { key: string; value: string }[] = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];
