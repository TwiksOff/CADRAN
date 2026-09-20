/* Cadran — service worker : coquille applicative hors ligne */
const CACHE = 'cadran-v1';
const SHELL = [
  './', './index.html', './styles.css', './styles-mobile.css', './app.js',
  './manifest.webmanifest', './icon.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(k => Promise.all(k.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Navigation : réseau d'abord, coquille en secours
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')));
    return;
  }

  // Ressources : cache d'abord, puis réseau (et mise en cache des polices)
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      if (res.ok && (req.url.startsWith(self.location.origin) || req.url.includes('fonts.g'))) {
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
