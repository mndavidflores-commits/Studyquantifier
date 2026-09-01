import { actualizarUI, initApp } from './auth.js';
import { actualizarTodo, actualizarPanelesActivos } from './panels.js';
import { initEventos } from './eventos.js';

export { actualizarUI, initApp, actualizarTodo, actualizarPanelesActivos };

// Inicializar eventos globales al cargar el módulo
initEventos();

// Registrar Service Worker
function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW no pudo registrarse', err));
  }
}
registerSW();