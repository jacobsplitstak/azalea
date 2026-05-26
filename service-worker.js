// Azalea Fertility Tracker — service worker
// Provides offline access and handles scheduled / clicked notifications.
//
// Cache strategy:
//   - Network-first for HTML and JSON (so updates ship without a reload trap)
//   - Cache-first for static assets (icon, etc.)
// Bump CACHE_VERSION any time the cached asset list changes.

const CACHE_VERSION = 'azalea-v4';
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

// Synthesized response for the rare case where both cache and network fail.
const OFFLINE_RESPONSE = () => new Response(
  '<!doctype html><meta charset=utf-8><title>Offline</title>' +
  '<p style="font:14px sans-serif;padding:20px">Azalea is offline and ' +
  'this resource hasn\'t been cached yet. Reconnect and reload.</p>',
  { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/html; charset=utf-8' } }
);

self.addEventListener('install', (event) => {
  event.waitUntil(
    // addAll fails the whole install if any single fetch fails. Use Promise.all
    // of individual puts so a missing/renamed asset doesn't block activation.
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(PRECACHE.map(url =>
        fetch(url, { cache: 'reload' })
          .then(resp => resp.ok ? cache.put(url, resp) : null)
          .catch(() => null)
      ))
    )
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
    // Network-first for HTML / JSON.
    event.respondWith((async () => {
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) {
          const cache = await caches.open(CACHE_VERSION);
          cache.put(req, resp.clone());
        }
        return resp;
      } catch (e) {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = await caches.match('./fertility-tracker.html');
        return fallback || OFFLINE_RESPONSE();
      }
    })());
    return;
  }

  // Cache-first for everything else.
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const resp = await fetch(req);
      if (resp && resp.ok) {
        const cache = await caches.open(CACHE_VERSION);
        cache.put(req, resp.clone());
      }
      return resp;
    } catch (e) {
      return OFFLINE_RESPONSE();
    }
  })());
});

// Push event — fired by the browser when the Azalea worker sends a Web
// Push. Body is JSON with { title, body, tag, icon? }. Even if parsing
// fails we still show *something* because Chrome will surface a generic
// "site updated in the background" notification otherwise.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) {
    try { data = { body: event.data.text() }; } catch (e2) {}
  }
  const title = data.title || 'Azalea';
  const options = {
    body:  data.body  || '',
    tag:   data.tag   || 'azalea',
    icon:  data.icon  || './icons/icon-192.png',
    badge: './icons/icon-192.png',
    renotify: true,
    vibrate: [120, 60, 120],
    data: data,
  };
  event.waitUntil(self.registration.showNotification(title, options));
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
