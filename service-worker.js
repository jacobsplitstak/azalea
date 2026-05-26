// Azalea Fertility Tracker — service worker
// Provides offline access and handles scheduled / clicked notifications.
//
// Cache strategy:
//   - Network-first for HTML and JSON (so updates ship without a reload trap)
//   - Cache-first for static assets (icon, etc.)
// Bump CACHE_VERSION any time the cached asset list changes.

const CACHE_VERSION = 'azalea-v2';
const PRECACHE = [
  './',
  './index.html',
  './fertility-tracker.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  './favicon.ico',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDoc = req.destination === 'document'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');
  const isJson = url.pathname.endsWith('.json');

  if (isDoc || isJson) {
    // Network-first for HTML / JSON
    event.respondWith(
      fetch(req).then((resp) => {
        if (resp && resp.ok) {
          const clone = resp.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
        }
        return resp;
      }).catch(() =>
        caches.match(req).then((cached) => cached || caches.match('./fertility-tracker.html'))
      )
    );
    return;
  }

  // Cache-first for everything else
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((resp) => {
      if (resp && resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
      }
      return resp;
    }).catch(() => cached))
  );
});

// Bring the app forward when a notification is clicked.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      if ('focus' in client) {
        try { await client.focus(); return; } catch (e) {}
      }
    }
    if (self.clients.openWindow) {
      await self.clients.openWindow('./fertility-tracker.html');
    }
  })());
});

// Allow the page to ask the SW to clear caches (used by "Clear all data").
self.addEventListener('message', (event) => {
  if (event.data === 'CLEAR_CACHE') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
