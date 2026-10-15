// Offline service worker. Paths are relative to the SW scope so it works under
// /horde-run/ on GitHub Pages and / in preview. Bump VERSION to drop old caches.
const VERSION = 'v4';
const CACHE = `horde-run-${VERSION}`;
// Assets fetched by path (not hashed by the bundler) are precached here and refreshed by
// bumping VERSION whenever one of them changes: the look's HDRI, the oak floor textures,
// the champion's baked AO and the UI font.
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './look/bedroom-env.hdr',
  './models/environment-oak-albedo.jpg',
  './models/environment-oak-normal.jpg',
  './models/environment-oak-orm.jpg',
  './models/champion-ao.bin',
  './ui/fredoka-600.woff2',
  './ui/fredoka-700.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((p) => new URL(p, self.registration.scope).href)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('horde-run-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Network-first so new deploys arrive; fall back to the cached shell offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(new URL('./index.html', self.registration.scope).href, copy));
          }
          return res;
        })
        .catch(() =>
          caches.match(new URL('./index.html', self.registration.scope).href).then((r) => r || caches.match(req)),
        ),
    );
    return;
  }

  // Hashed assets never change: cache-first, filling the cache at runtime.
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
