// Hunt Tracker service worker: app shell cache-first, map tiles cached as you view them, weather network-first.
const V = 'ht-v1';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'manifest.json', 'lib/leaflet.js', 'lib/leaflet.css', 'lib/suncalc.js', 'icons/icon-180.png', 'icons/icon-192.png'];
const TILE_CACHE = 'ht-tiles-v1', MAX_TILES = 4000;
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILE_CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim() {
  const c = await caches.open(TILE_CACHE), keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.hostname.includes('open-meteo')) return; // app handles weather caching itself
  if (/arcgisonline|nationalmap|tile\.openstreetmap/.test(u.hostname)) {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(e.request);
      const net = fetch(e.request).then(r => { if (r.ok || r.type === 'opaque') { c.put(e.request, r.clone()); trim(); } return r; }).catch(() => hit);
      return hit || net;
    }));
    return;
  }
  if (u.origin === location.origin) {
    e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => {
      const net = fetch(e.request).then(r => { if (r.ok) caches.open(V).then(c => c.put(e.request, r.clone())); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
