const CACHE_NAME = 'usa-trip-v29';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/city.js',
  '/notes.js',
  '/firebase-config.js',
  '/store.js',
  '/manifest.json',
  '/icon.svg',
  '/data/trip.json',
  '/data/new-york.json',
  '/data/washington-dc.json',
  '/data/san-francisco.json',
  '/data/los-angeles.json',
  '/data/tampa.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Never intercept POST requests or API calls
  if (e.request.method !== 'GET' || e.request.url.includes('/api/')) return;

  // Only handle same-origin GETs; let the browser handle cross-origin
  // requests (Firebase auth/Firestore/Storage, CDN scripts) untouched.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  // Hard refresh (Ctrl+Shift+R) — bypass SW cache entirely, fetch fresh and update cache
  if (e.request.cache === 'reload') {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // JSON data files — network first so edits are picked up without bumping SW version
  if (e.request.url.includes('/data/') && e.request.url.endsWith('.json')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // HTML navigations — network first so updates are picked up immediately
  if (e.request.mode === 'navigate' || e.request.url.endsWith('.html')) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Everything else — cache first, fall back to network
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('/index.html'));
    })
  );
});
