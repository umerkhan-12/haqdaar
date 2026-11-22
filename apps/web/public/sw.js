// Haqdaar service worker: the app opens with no signal.
// Pages: network first, then cache, then /offline. Build assets: cache first (immutable hashes).
// API calls are never cached: offline claims go to the IndexedDB outbox instead.
const VERSION = 'haqdaar-v5';
const SHELL = ['/', '/login', '/citizen', '/citizen/claim', '/citizen/status', '/citizen/scam', '/citizen/ask', '/citizen/consents', '/signup', '/forgot-pin', '/helper', '/offline', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then(async (cache) => {
        // Only the screens: the app is usable offline within seconds of the first visit.
        await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      // Then every recorded Urdu sentence, so the app still speaks with no signal.
      .then(async () => {
        const cache = await caches.open(VERSION);
        const spoken = await fetch('/audio/manifest.json').then((r) => r.json()).catch(() => []);
        await Promise.allSettled(spoken.map((hash) => cache.add(`/audio/${hash}.mp3`)));
      }),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(async () => (await caches.match(req)) ?? (await caches.match('/offline'))),
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/audio/') || url.pathname.endsWith('.woff2')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});
