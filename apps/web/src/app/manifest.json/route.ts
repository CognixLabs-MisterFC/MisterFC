import { buildWebManifest } from '@misterfc/core';

/**
 * `/manifest.json` de la PWA. Antes era `public/manifest.json`; pasa a ruta para que
 * `start_url` siga el interruptor de la web comercial (spec §1.5, decisión 4). Con la web
 * apagada devuelve el mismo manifiesto que el fichero (test en core).
 */
export const dynamic = 'force-static';

export function GET() {
  return Response.json(buildWebManifest(process.env), {
    headers: { 'Content-Type': 'application/manifest+json' },
  });
}
