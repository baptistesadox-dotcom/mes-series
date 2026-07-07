/* Service worker — Mes Séries
   Shell : network-first (toujours à jour quand en ligne, cache en secours).
   Affiches TMDB : cache-first (économise les requêtes, dispo hors ligne). */
const VERSION = 'v2';
const SHELL_CACHE = 'shell-' + VERSION;
const IMG_CACHE = 'tmdb-img-' + VERSION;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL_CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== IMG_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API (TMDB / TVMaze / IMDb) : réseau uniquement (données fraîches, gérées par l'app)
  if (url.hostname === 'api.themoviedb.org' || url.hostname === 'api.tvmaze.com' || url.hostname === 'v2.sg.media-imdb.com') return;

  // Images (TMDB / TVMaze / IMDb) : cache-first
  if (url.hostname === 'image.tmdb.org' || url.hostname === 'static.tvmaze.com' || url.hostname === 'm.media-amazon.com') {
    e.respondWith(
      caches.open(IMG_CACHE).then(c =>
        c.match(e.request).then(hit => hit || fetch(e.request).then(r => {
          if (r.ok) c.put(e.request, r.clone());
          return r;
        }))
      )
    );
    return;
  }

  // Shell (même origine) : network-first avec repli cache
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(SHELL_CACHE).then(c => c.put(e.request, copy));
        return r;
      }).catch(() =>
        caches.match(e.request).then(hit => hit || caches.match('./index.html'))
      )
    );
  }
});
