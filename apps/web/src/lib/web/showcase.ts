import type { ShowcaseClub } from '@misterfc/core';

/**
 * Clubes que se muestran en la portada (spec §7.2). VACÍA hasta tener permiso por
 * escrito de cada club. Al añadir uno: su logo, subido a mano a `public/web/clubes/`
 * (nunca sacado de la base de datos), y la fecha del permiso firmado. Además hace falta
 * `NEXT_PUBLIC_WEB_SHOWCASE=on` en Vercel; sin las dos cosas no se pinta nada.
 */
export const SHOWCASE_CLUBS: readonly ShowcaseClub[] = [];
