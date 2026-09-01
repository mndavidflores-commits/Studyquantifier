const CACHE = 'estudio-v34';

const STATIC_ASSETS = [
  './',
  './index.html',
  './css/base.css',
  './css/componentes.css',
  './css/layout.css',
  './css/metricas.css',
  './css/responsive.css',
  './js/main.js',
  './js/config.js',
  './js/utils.js',
  './js/sync.js',
  './js/ui.js',
  './js/pomodoro.js',
  './js/timer.js',
  './js/repasos.js',
  './js/graficos.js',
  './js/metricas.js',
  './js/auth.js',
  './js/panels.js',
  './js/historial.js',
  './js/suenoNotas.js',
  './js/checklistMetas.js',
  './js/conjeturas.js',
  './js/selectores.js',
  './js/eventos.js',
  './js/app.js'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

function isExternal(url) {
  return url.hostname === 'wrtmlucrxzewynnnikzh.supabase.co' ||
         url.hostname === 'cdn.jsdelivr.net' ||
         url.hostname === 'unpkg.com' ||
         url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com';
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Ignorar protocolos no soportados (chrome-extension, etc.)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  // No interceptar peticiones externas
  if (isExternal(url)) return;

  // Navegación: network-first con fallback a caché
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Estáticos: stale-while-revalidate
  event.respondWith(
    caches.match(request).then(cached => {
      const fetchPromise = fetch(request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});