import { db, state } from './config.js';
import { formatTime, fechaLocale } from './utils.js';
import { editarProblema } from './repasos.js';

// ===================== HISTORIAL COMPLETO CON PAGINACIÓN =====================
const LIMITE_FECHAS = 10;
let offsetFechas = 0;
let totalFechas = 0;

export async function actualizarHistorial(reset = true) {
  if (reset) offsetFechas = 0;

  const container = document.getElementById('historialContainer');
  if (!container) return;

  const allSessions = await db.sessions.orderBy('timestamp').reverse().toArray();
  const grouped = {};
  allSessions.forEach(s => {
    const fecha = s.fecha || fechaLocale(s.timestamp);
    if (!grouped[fecha]) grouped[fecha] = [];
    grouped[fecha].push(s);
  });

  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  totalFechas = sortedDates.length;
  const fechasVisibles = sortedDates.slice(offsetFechas, offsetFechas + LIMITE_FECHAS);

  const fragment = document.createDocumentFragment();

  for (const fecha of fechasVisibles) {
    const dateDiv = document.createElement('div');
    dateDiv.className = 'history-date';
    dateDiv.textContent = fecha;
    fragment.appendChild(dateDiv);

    const pomos = grouped[fecha].filter(s => s.tipo === 'pomodoro');
    for (const pomo of pomos) {
      const problemas = allSessions.filter(s => s.sesion_id === pomo.id && s.tipo === 'problema');
      const conjs = (await db.conjeturas.where('sesion_id').equals(pomo.id).toArray()).length;
      const duracion = pomo.tiempo_pomodoro || 1;

      const div = document.createElement('div');
      div.className = 'pomo-row';
      div.dataset.pomoid = pomo.id;
      div.innerHTML = `
        <div style="display:flex; justify-content:space-between;"><strong>${pomo.pomodoro_label || 'pomodoro_' + pomo.id}</strong><span>${formatTime(duracion)} | ${pomo.materia || 'sin materia'} | ${pomo.modo || ''} | Ej:${problemas.length}</span></div>
        <div class="pomo-details">
          <p>Fase: ${pomo.fase || '-'} | Modo: ${pomo.modo || '-'} | Materia: ${pomo.materia || '-'} | Subtema: ${pomo.subtema_nombre || pomo.subtema_id || '-'}</p>
          <p>Ejercicios: ${problemas.length} (${problemas.filter(p => p.resultado === 'bien').length} bien, ${problemas.filter(p => p.resultado === 'mal').length} mal, ${problemas.filter(p => p.resultado === 'no_resuelto').length} no resuelto)</p>
          <p>Conjeturas: ${conjs} | Ej/min: ${(problemas.length / (duracion / 60)).toFixed(1)} | Conj/min: ${(conjs / (duracion / 60)).toFixed(1)} | Lectura: ${Math.floor(pomo.tiempo_lectura / 60)}:${String(pomo.tiempo_lectura % 60).padStart(2, '0')}</p>
          <table><tr><th>#</th><th>Resultado</th><th>Tiempo</th><th>Error</th></tr>
            ${problemas.map(p => `<tr class="editable-problem" data-problem-id="${p.id}" style="cursor:pointer;"><td>${p.problema_num}</td><td>${p.resultado}</td><td>${formatTime(p.tiempo_s)}</td><td>${p.codigo_error || ''}</td></tr>`).join('')}
          </table>
        </div>
      `;
      fragment.appendChild(div);
    }
  }

  if (offsetFechas + LIMITE_FECHAS < totalFechas) {
    const btn = document.createElement('button');
    btn.textContent = 'Cargar más fechas';
    btn.className = 'small';
    btn.style.marginTop = '10px';
    btn.addEventListener('click', () => {
      offsetFechas += LIMITE_FECHAS;
      actualizarHistorial(false);
    });
    fragment.appendChild(btn);
  }

  container.innerHTML = '';
  container.appendChild(fragment);
}

// Delegación de eventos para historial completo
document.getElementById('historialContainer').addEventListener('click', (e) => {
  const row = e.target.closest('.pomo-row');
  if (row && !e.target.closest('.editable-problem')) {
    row.classList.toggle('expanded');
    return;
  }

  const tr = e.target.closest('.editable-problem');
  if (tr) {
    e.stopPropagation();
    editarProblema(tr.dataset.problemId);
  }
});