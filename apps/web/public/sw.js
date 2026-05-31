/**
 * MisterFC — Service Worker.
 *
 * Estrategia (Fase 0 + F5.4):
 *   - Precache de la shell mínima.
 *   - Network-first para todo lo demás, sin offline avanzado.
 *   - F5.4 — handlers de Web Push: `push` y `notificationclick`.
 *
 * Versión del cache se incrementa cuando se cambia esta SW para forzar
 * la activación nueva (clients refresh tras navegación).
 */

const CACHE_NAME = 'misterfc-shell-v2';
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

// ─── F5.4 — Web Push ────────────────────────────────────────────────────────

/**
 * Recibe payloads JSON con shape:
 *   { title: string, body: string, deep_link?: string, tag?: string }
 *
 * Si no hay payload (push silencioso del proveedor), fallback a un genérico.
 * `tag` permite colapsar notificaciones del mismo tipo — si llegan dos
 * `new_message` con tag='new_message', la segunda reemplaza visualmente la
 * primera en lugar de apilarse.
 */
self.addEventListener('push', (event) => {
  let payload = { title: 'MisterFC', body: 'Nueva notificación' };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload = { title: 'MisterFC', body: event.data.text() };
    }
  }

  const options = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { deep_link: payload.deep_link || '/' },
    tag: payload.tag || undefined,
    renotify: Boolean(payload.tag),
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

/**
 * Al hacer click en una notificación:
 *   - Si hay deep_link y ya hay una pestaña abierta del origen, navega allí.
 *   - Si no, abre nueva pestaña.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.deep_link) || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (
            client.url.startsWith(self.location.origin) &&
            'focus' in client &&
            'navigate' in client
          ) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
