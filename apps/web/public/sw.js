/**
 * MisterFC — Service Worker básico.
 *
 * Estrategia inicial (Fase 0):
 *   - Precache de la shell mínima (app shell vacío).
 *   - Network-first para todo lo demás, sin offline avanzado.
 *
 * Se ampliará en Fase 15 (testing + observabilidad) con estrategias por ruta
 * y soporte offline real para la pantalla de toma de datos en partido (Fase 7).
 */

const CACHE_NAME = 'misterfc-shell-v1';
const PRECACHE_URLS = ['/'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;
  if (!request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && request.destination !== 'document') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || Response.error())),
  );
});
