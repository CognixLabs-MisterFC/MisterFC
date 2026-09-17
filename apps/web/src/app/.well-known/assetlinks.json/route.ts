import { NextResponse } from 'next/server';
import { buildAssetLinks } from '@misterfc/core';

/**
 * BUG-3 — App Links de Android: el fichero que Google lee para verificar que esta
 * app puede abrir enlaces de misterfc.es. Hermano del `apple-app-site-association`
 * de al lado; ahí está el porqué de que esto sirva ahora y no antes.
 *
 * VAN DOS HUELLAS, Y LAS DOS HACEN FALTA:
 *   · la de la clave de SUBIDA (EAS), con la que se firma el APK que se prueba a
 *     mano;
 *   · la de la clave de FIRMA DE GOOGLE (Play App Signing), con la que Google
 *     vuelve a firmar lo que descargan los usuarios.
 * Con solo la primera, los enlaces funcionarían en el APK de pruebas y NO en la
 * app de la tienda, que es el único sitio donde importa. Con solo la segunda, al
 * revés. El fallo es silencioso: el enlace simplemente abre el navegador.
 *
 * AQUÍ NO SE RESTRINGEN RUTAS. Android verifica el DOMINIO, no los paths: qué
 * enlaces abre la app lo decide el `intentFilters` del binario (`pathPrefix`).
 * Esto solo dice «esta app es de este dominio».
 */
export const dynamic = 'force-static';

export function GET() {
  return NextResponse.json(buildAssetLinks(), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'public, max-age=3600',
    },
  });
}
