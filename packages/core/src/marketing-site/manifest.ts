import { isMarketingSiteOn, type MarketingSiteEnv } from './site';

/**
 * El manifiesto de la PWA (`/manifest.json`).
 *
 * Con la web comercial encendida, `/` deja de llevar al anónimo al selector de clubes
 * (le enseña la portada comercial). La PWA instalada es de entrenadores y familias, así
 * que DEBE seguir arrancando en el selector: `start_url` pasa a `/clubes` (spec §1.5,
 * decisión 4). Con sesión, `/clubes` ya manda al Inicio.
 *
 * Con la web APAGADA el manifiesto es, campo a campo, el que había en
 * `apps/web/public/manifest.json` hasta este cambio: misterfc.es no cambia en nada.
 */
export function buildWebManifest(env: MarketingSiteEnv) {
  return {
    name: 'MisterFC',
    short_name: 'MisterFC',
    description:
      'Gestión, metodología y desarrollo deportivo para entrenadores de fútbol base y amateur.',
    start_url: isMarketingSiteOn(env) ? '/clubes' : '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0F1B2E',
    theme_color: '#0F1B2E',
    lang: 'es',
    scope: '/',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any maskable',
      },
    ],
  };
}
