import { NextResponse } from 'next/server';
import { buildAppleAppSiteAssociation } from '@misterfc/core';

/**
 * BUG-3 — Universal Links de iOS: el fichero que Apple lee para saber que esta app
 * puede abrir enlaces de misterfc.es.
 *
 * POR QUÉ ESTO EXISTE AHORA Y NO ANTES. El correo de invitación enlazaba a
 * `{{ .ConfirmationURL }}`, que es un enlace de `supabase.co` que REDIRIGE aquí.
 * Universal Links decide por el dominio del enlace QUE SE TOCA, y no se dispara en
 * una redirección de servidor: con aquel correo, este fichero no se habría
 * consultado nunca. La plantilla ya usa `{{ .RedirectTo }}`, que es el enlace a
 * misterfc.es directamente, y por eso ahora sirve de algo.
 *
 * SOLO LAS RUTAS DE INVITACIÓN. Reclamar `/*` haría que CUALQUIER enlace de
 * misterfc.es abriese la app —el panel web entero, los textos legales, la portada
 * de clubes— y eso es justo lo que no queremos: la web es una aplicación completa
 * por sí misma. Se reclama lo que la app sabe terminar y nada más.
 *
 * FORMATO: se emiten las dos formas. `components`/`appIDs` es la moderna (iOS 13+);
 * `paths`/`appID` la antigua, que siguen leyendo versiones viejas. Son
 * equivalentes y Apple usa la que entiende.
 *
 * REQUISITOS QUE APPLE IMPONE y que esta ruta cumple:
 *   · `application/json` — por eso es un route handler y no un fichero en public/,
 *     donde Next lo serviría sin extensión y con un tipo que Apple rechaza.
 *   · HTTPS y SIN redirección. El middleware no lo toca: su matcher excluye los
 *     paths con punto, y `.well-known` lleva uno.
 *   · Sin autenticación: lo descarga Apple, no el usuario.
 */
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(buildAppleAppSiteAssociation(), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
