// Service worker: guarda la app para que funcione sin conexión.
// Solo sirve archivos propios; no hace ninguna petición a terceros.
const CACHE = 'afinador-v16';
const FILES = ['./', 'index.html', 'app.css', 'app.js', 'pitch.js', 'scales.js', 'manifest.webmanifest', 'icon.svg', 'chevron.svg', 'icon-192.png', 'icon-512.png', 'silence.wav'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
