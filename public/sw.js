// Offline support. The page and other unversioned files are fetched network-first so a new build shows up on a
// normal reload; hashed files under assets/ never change, so they are served cache-first.
// Registered from src/ui/hud.js in production builds served over https or localhost.
const CACHE = 'symbiote-city-v2';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Only same-origin, complete, successful responses are stored (no opaque or partial bodies).
const storable = (res) => res && res.ok && res.status === 200 && res.type === 'basic';
const put = (req, res) => { if (storable(res)) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const immutable = /\/assets\/[^/]+-[\w-]{8,}\.(?:js|css)$/.test(url.pathname);
  if (immutable) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
    return;
  }
  e.respondWith(
    fetch(req).then((res) => put(req, res)).catch(() => caches.match(req).then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
