/* Service worker — Mes Séries
   Code de l'app : réseau d'abord (toujours à jour quand on est en ligne), mais avec un
   délai maximal : sur un réseau faible, la copie en cache s'affiche au lieu d'un écran
   noir, et la version réseau la remplace pour la fois suivante.
   Affiches : cache d'abord (économise les requêtes, dispo hors ligne), cache plafonné.

   Attention : GitHub Pages sert les fichiers avec Cache-Control: max-age=600. Un simple
   fetch() peut donc répondre depuis le cache HTTP du navigateur et servir une version
   vieille de dix minutes. Pour les fichiers de l'app on contourne ce cache explicitement. */
const VERSION = 'v7';
const SHELL_CACHE = 'shell-' + VERSION;
const IMG_CACHE = 'affiches-v1';   // indépendant de VERSION : les affiches survivent aux mises à jour
const IMG_MAX = 800;               // nombre maximal d'affiches gardées
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon-maskable-512.png', './manrope.woff2'];
const HOTES_IMAGES = ['image.tmdb.org', 'static.tvmaze.com', 'm.media-amazon.com'];
const HOTES_API = ['api.themoviedb.org', 'api.tvmaze.com', 'v2.sg.media-imdb.com', 'api.github.com', 'gist.githubusercontent.com'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(SHELL_CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, {cache: 'reload'}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL_CACHE && k !== IMG_CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

/* Requête réseau sans passer par le cache HTTP, pour tout ce qui porte le code de l'app */
function fraiche(req) {
  const u = new URL(req.url);
  const code = req.mode === 'navigate' || u.pathname.endsWith('/') ||
               /\.(html|js|webmanifest)$/.test(u.pathname);
  if (!code) return fetch(req);
  u.searchParams.set('sw', Date.now());
  return fetch(u.toString(), {cache: 'no-store'});
}

/* Promesse qui échoue si le réseau n'a pas répondu à temps */
function avecDelai(promesse, ms) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('délai dépassé')), ms);
    promesse.then(r => { clearTimeout(t); res(r); }, err => { clearTimeout(t); rej(err); });
  });
}

/* Garde le cache d'affiches sous IMG_MAX entrées (les plus anciennes partent d'abord) */
let ajoutsDepuisMenage = 0;
async function rognerAffiches(c) {
  if (++ajoutsDepuisMenage < 25) return;
  ajoutsDepuisMenage = 0;
  const cles = await c.keys();
  if (cles.length > IMG_MAX) await Promise.all(cles.slice(0, cles.length - IMG_MAX).map(k => c.delete(k)));
}

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // API (TMDB / TVMaze / IMDb / GitHub) : réseau uniquement (données fraîches, gérées par l'app)
  if (HOTES_API.includes(url.hostname)) return;

  // Affiches : cache d'abord. Elles sont redemandées en mode CORS : une réponse « opaque »
  // (requête <img> classique) n'était jamais mise en cache, faute de statut lisible.
  if (HOTES_IMAGES.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(IMG_CACHE);
      const hit = await c.match(e.request.url);
      if (hit) return hit;
      try {
        const r = await fetch(e.request.url, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { c.put(e.request.url, r.clone()).then(() => rognerAffiches(c)).catch(() => {}); }
        return r;
      } catch (err) {
        return fetch(e.request); // l'hôte refuse le CORS : chargement classique, sans cache
      }
    })());
    return;
  }

  // Code de l'app (même origine) : réseau d'abord avec délai, repli sur le cache
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      const reseau = fraiche(e.request).then(r => {
        if (r.ok) {
          const copie = r.clone();
          caches.open(SHELL_CACHE).then(c => c.put(e.request, copie));   // clé = requête d'origine
        }
        return r;
      });
      try {
        return await avecDelai(reseau, e.request.mode === 'navigate' ? 3500 : 6000);
      } catch (err) {
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) { reseau.catch(() => {}); return hit; }   // la version réseau mettra le cache à jour
        if (e.request.mode === 'navigate') {
          const page = await caches.match('./index.html');
          if (page) return page;
        }
        return reseau; // aucune copie : on attend le réseau (ou son erreur)
      }
    })());
  }
});
