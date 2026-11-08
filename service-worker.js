/* CLIMA · Service Worker
   - App (HTML/CSS/JS/íconos): stale-while-revalidate → abre al instante y se actualiza sola.
   - Datos del clima (APIs): red primero, caché como respaldo → funciona sin conexión con los últimos datos.
   - Mosaicos del mapa: directo a la red (no se guardan para no llenar el almacenamiento). */
const VERSION = 'clima-v2.0.0';
const SHELL_CACHE = `${VERSION}-shell`;
const DATA_CACHE = `${VERSION}-data`;

const SHELL = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './images/icon-192x192.png',
  './images/icon-512x512.png',
];
const CDN = [
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js',
];
const DATA_HOSTS = ['api.open-meteo.com', 'air-quality-api.open-meteo.com', 'geocoding-api.open-meteo.com', 'api.openweathermap.org', 'api.rainviewer.com'];
const STATIC_HOSTS = ['cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    // Los recursos del CDN son opcionales: si alguno falla no bloquea la instalación.
    await Promise.all(CDN.map(u => cache.add(new Request(u, { mode: 'cors' })).catch(() => null)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(req) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req, event) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
  const update = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (hit) { event.waitUntil(update); return hit; }
  const res = await update;
  if (res) return res;
  if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
  return Response.error();
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (DATA_HOSTS.includes(url.hostname)) {
    event.respondWith(networkFirst(req));
    return;
  }
  if (url.origin === self.location.origin || STATIC_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req, event));
  }
  // El resto (mosaicos de mapas, íconos externos) va directo a la red.
});
