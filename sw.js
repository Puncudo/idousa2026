const CACHE_NAME = 'usa-trip-v42';
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
];

/* Third-party libs, incl. the Firebase SDK the app needs to read its offline cache.
   Cached best-effort so one CDN failure can't abort the whole install. */
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage-compat.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    await Promise.all(CDN_ASSETS.map(u => cache.add(u).catch(() => {})));
  })());
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

  // Cross-origin: serve the cached CDN libs when offline, but never intercept
  // Firebase's live auth/Firestore/Storage traffic.
  if (new URL(e.request.url).origin !== self.location.origin) {
    if (CDN_ASSETS.includes(e.request.url)) {
      e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
    }
    return;
  }

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
