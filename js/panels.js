import { actualizarHistorial } from './historial.js';
import { actualizarMetricas, actualizarPanelMetricas } from './metricas.js';
import { actualizarSleepHistorial, actualizarGraficoSueno, actualizarNotas } from './suenoNotas.js';
import { actualizarChecklist, actualizarMetas } from './checklistMetas.js';
import { actualizarConjeturasFull } from './conjeturas.js';
import { actualizarConjeturasSesion } from './repasos.js';

// ===================== ACTUALIZACIÓN SELECTIVA =====================
export function actualizarTodo() {
  actualizarHistorial();
  actualizarMetricas();
  actualizarSleepHistorial();
  actualizarGraficoSueno();
  actualizarConjeturasSesion();
  actualizarConjeturasFull();
  actualizarChecklist();
  actualizarMetas();
  actualizarPanelMetricas();
  actualizarNotas();
}

export function actualizarPanelesActivos() {
  const panelActivo = document.querySelector('.panel.active')?.id;
  if (!panelActivo) return;
  switch (panelActivo) {
    case 'panelHistorial': actualizarHistorial(); break;
    case 'panelMetricas': actualizarMetricas(); actualizarPanelMetricas(); break;
    case 'panelSueno': actualizarSleepHistorial(); actualizarGraficoSueno(); break;
    case 'panelConjeturas': actualizarConjeturasFull(); break;
    case 'panelNotas': actualizarNotas(); break;
    case 'panelChecklist': actualizarChecklist(); break;
    case 'panelMetas': actualizarMetas(); break;
    default: break;
  }
}
