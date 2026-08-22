const CACHE = 'estudio-v30';
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(['./', './index.html', './codigo.js', './estilo.css']))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
/* ===== NUEVO PANEL DE MÉTRICAS ===== */
.metric-header {
  display: flex;
  align-items: center;
  gap: 15px;
}
.avatar {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  font-size: 1.2rem;
}
.user-info {
  flex: 1;
}
.user-name {
  font-size: 1.2rem;
  font-weight: 600;
  color: #fff;
}
.user-register {
  font-size: 0.8rem;
  color: var(--text2);
}
.user-streak {
  font-size: 0.9rem;
  color: var(--accent3);
  margin-bottom: 4px;
}

.metric-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  text-align: center;
}
.stat-item {
  background: var(--surface2);
  border-radius: var(--radius-sm);
  padding: 15px;
}
.stat-value {
  font-size: 1.8rem;
  font-weight: 700;
  color: #fff;
  font-family: var(--mono);
}
.stat-label {
  font-size: 0.75rem;
  color: var(--text2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.metric-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
}
.metric-card {
  background: var(--surface2);
  padding: 15px;
  border-radius: var(--radius-sm);
}
.metric-card h4 {
  color: #fff;
  margin-bottom: 10px;
  font-size: 0.9rem;
}
.metric-row {
  display: flex;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 0.85rem;
}
.metric-row strong {
  color: var(--accent3);
  font-family: var(--mono);
}

/* Heatmap */
.heatmap-container {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 10px;
}
.heatmap-day {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  background: var(--surface2);
  transition: transform 0.15s;
}
.heatmap-day:hover {
  transform: scale(1.3);
}
.heatmap-day[data-level="0"] { background: #1e1e38; }
.heatmap-day[data-level="1"] { background: #2a2a55; }
.heatmap-day[data-level="2"] { background: #3b4a8a; }
.heatmap-day[data-level="3"] { background: #5c7cfa; }
.heatmap-day[data-level="4"] { background: #8aa2ff; }

/* ===== MEJORAS SCROLL MÓVIL ===== */
html, body {
  height: 100dvh;
  overflow-y: auto;
}
.app-container {
  height: 100dvh;
  overflow-y: auto;
}
#main-area {
  overflow-y: auto;
}
.panel.active {
  overflow-y: auto;
}
