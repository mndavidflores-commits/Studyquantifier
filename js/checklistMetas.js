import { db, state } from './config.js';
import { guardarLocalYOutbox, syncAll } from './sync.js';
import { hoyLocal, fechaLocale } from './utils.js';

// ===================== CHECKLIST =====================
export async function actualizarChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;
  const completados = await db.checklist.toArray();
  const ids = new Map(completados.map(c => [c.subtema_id, c.fecha_completado]));
  const subtemasExtra = await db.subtemas_extra.toArray();
  const todasMaterias = [...new Set(state.currentTemario.map(t => t.materia))];
  subtemasExtra.forEach(e => { if (!todasMaterias.includes(e.materia)) todasMaterias.push(e.materia); });
  let totalSubtemas = 0;
  let html = '';
  for (const mat of todasMaterias) {
    const tem = state.currentTemario.filter(t => t.materia === mat);
    const extras = subtemasExtra.filter(e => e.materia === mat);
    const subs = [...tem.map(t => ({ id: t.id.toString(), nombre: t.nombre, etapa: t.etapa })), ...extras.map(e => ({ id: 'extra_' + e.id, nombre: e.nombre, etapa: e.etapa || 'Personalizado' }))];
    if (!subs.length) continue;
    html += `<h4>${mat}</h4>`;
    subs.forEach(st => {
      const fechaComp = ids.has(st.id) ? ` (${ids.get(st.id)})` : '';
      html += `<label><input type="checkbox" class="checklist-cb" data-stid="${st.id}" ${ids.has(st.id) ? 'checked' : ''}> ${st.nombre} (${st.etapa || ''})${fechaComp}</label><br>`;
      totalSubtemas++;
    });
  }
  container.innerHTML = html;
  const completado = completados.length;
  const pct = totalSubtemas ? Math.round(completado / totalSubtemas * 100) : 0;
  document.getElementById('progressChecklist').style.width = pct + '%';
  document.getElementById('checklistPercent').textContent = pct + '% completado (' + completado + '/' + totalSubtemas + ')';
}

// Delegación de eventos para checkboxes del checklist
document.getElementById('checklistContainer').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('checklist-cb')) return;
  const stid = e.target.dataset.stid;
  if (e.target.checked) {
    await guardarLocalYOutbox('checklist', 'checklist', { subtema_id: stid, fecha_completado: hoyLocal() }, 'subtema_id,user_id');
  } else {
    await db.checklist.where('subtema_id').equals(stid).delete();
    await db.outbox.put({
      table: 'checklist',
      record_id: stid,
      operation: 'delete',
      data: { subtema_id: stid, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() },
      onConflict: 'subtema_id,user_id',
      created_at: new Date().toISOString()
    });
    await syncAll();
  }
  actualizarChecklist();
});

// ===================== METAS =====================
export async function actualizarMetas() {
  const hoy = new Date();
  const diaSemana = hoy.getDay();
  const esDiaActivo = state.diasActivosMeta.includes(diaSemana);

  const sessionsHoy = await db.sessions.where('fecha').equals(hoyLocal()).and(s => s.tipo === 'pomodoro').toArray();
  const minHoy = sessionsHoy.reduce((a, s) => a + (s.tiempo_pomodoro || 0), 0) / 3600;
  const metaDiaria = parseFloat(document.getElementById('metaDiaria').value) || 3;

  if (esDiaActivo) {
    document.getElementById('progresoDiario').textContent = `${minHoy.toFixed(1)}h / ${metaDiaria}h`;
    document.getElementById('progressDiario').style.width = Math.min(100, (minHoy / metaDiaria) * 100) + '%';
  } else {
    document.getElementById('progresoDiario').textContent = `${minHoy.toFixed(1)}h (día no activo)`;
    document.getElementById('progressDiario').style.width = '0%';
  }

  const inicioSemana = new Date(hoy);
  inicioSemana.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const inicioSemanaStr = fechaLocale(inicioSemana);
  const fechaHoy = hoyLocal();
  const sessionsSem = await db.sessions.where('fecha').between(inicioSemanaStr, fechaHoy, true, true).and(s => s.tipo === 'pomodoro').toArray();
  const minSem = sessionsSem.reduce((a, s) => a + (s.tiempo_pomodoro || 0), 0) / 3600;
  const metaSemanal = parseFloat(document.getElementById('metaSemanal').value) || 15;
  document.getElementById('progresoSemanal').textContent = `${minSem.toFixed(1)}h / ${metaSemanal}h`;
  document.getElementById('progressSemanal').style.width = Math.min(100, (minSem / metaSemanal) * 100) + '%';
}