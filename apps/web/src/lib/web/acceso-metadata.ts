import type { Metadata } from 'next';
import { isMarketingSiteOn } from '@misterfc/core';

/**
 * `noindex` de las páginas de acceso (`/clubes`, `/{slug}` y `/signin`; spec §11): con
 * la web comercial encendida, en Google tiene que salir la portada y no el selector de
 * clubes. Apagada no hay portada que proteger y estas páginas no cambian: `{}`.
 */
export function accesoMetadata(): Metadata {
  return isMarketingSiteOn(process.env) ? { robots: { index: false, follow: true } } : {};
}
