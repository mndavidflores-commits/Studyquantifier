const CACHE_NAME = 'estudio-v29';

// Recursos críticos a precachar
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './codigo.js',
  './estilo.css'
];

// 1. Instalación: Precachar archivos core
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// 2. Activación: Limpieza de cachés antiguas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// 3. Intercepción de peticiones (Network First con fallback a Cache y manejo de Query Strings)
self.addEventListener('fetch', event => {
  const request = event.request;

  // Solo procesar peticiones GET e ignorar esquemas no HTTP/HTTPS (extensiones, etc.)
  if (request.method !== 'GET' || !request.url.startsWith('http')) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        // Guardar copia en caché si la respuesta es válida
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, responseClone);
          });
        }
        return response;
      })
      .catch(async () => {
        // Fallback cuando no hay red:
        // Intenta buscar coincidencia exacta o ignorando parámetros de búsqueda (?v=...)
        const cache = await caches.open(CACHE_NAME);
        const matchedResponse = await cache.match(request, { ignoreSearch: true });
        
        if (matchedResponse) {
          return matchedResponse;
        }

        // Si se pierde la conexión navegando entre páginas HTML, sirve el index
        if (request.headers.get('accept')?.includes('text/html')) {
          return cache.match('./index.html');
        }
      })
  );
});
