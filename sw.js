const CACHE = 'atelier-kinetik-v2.9.1';
const SHELL = [
  './',
  './index.html',
  './registry.json',
  './llms.txt',
  './assets/app.css',
  './assets/kinetik-v27.css',
  './assets/app.js',
  './assets/kinetik-v27.js',
  './assets/loader.js',
  './assets/shared-clock.js',
  './assets/hero-3d.js',
  './assets/iframe-lru.js',
  './assets/audio-engine.js',
  './assets/motion-lab.js',
  './assets/inspector.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDocOrData = req.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('registry.json')
    || url.pathname.endsWith('llms.txt');

  if (isDocOrData) {
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }))
  );
});
