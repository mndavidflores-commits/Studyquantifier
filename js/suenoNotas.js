import { db, state } from './config.js';
import { showToast } from './utils.js';
import { syncAll } from './sync.js';
import { actualizarGraficoSueno } from './graficos.js';

// Re-export para mantener compatibilidad con otros módulos
export { actualizarGraficoSueno };

// ===================== CÁLCULO DE HORAS =====================
export function calcularHoras(acostar, despertar) {
  if (!acostar || !despertar) return 0;
  const [hA, mA] = acostar.split(':').map(Number);
  const [hD, mD] = despertar.split(':').map(Number);
  let minutos = (hD * 60 + mD) - (hA * 60 + mA);
  if (minutos <= 0) minutos += 24 * 60;
  return Math.round(minutos / 60 * 10) / 10;
}

// ===================== HISTORIAL DE SUEÑO =====================
export async function actualizarSleepHistorial() {
  const wrap = document.getElementById('sleepHistorialTable');
  if (!wrap) return;
  const registros = await db.sueno.orderBy('fecha').reverse().limit(50).toArray();
  if (!registros.length) {
    wrap.innerHTML = '<p style="color:var(--text2);">Sin registros de sueño.</p>';
    return;
  }

  function formato12h(hora24) {
    if (!hora24) return '-';
    const [h, m] = hora24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }

  let html = `<table><thead><tr><th>Fecha</th><th>Horas</th><th>Calidad</th><th>Acostarse</th><th>Despertar</th><th></th></tr></thead><tbody>`;
  registros.forEach(r => {
    html += `<tr>
      <td>${r.fecha}</td><td>${r.horas}h</td>
      <td>${'★'.repeat(Math.floor(r.calidad))}${'☆'.repeat(10 - Math.floor(r.calidad))} ${r.calidad}/10</td>
      <td>${formato12h(r.acostar)}</td><td>${formato12h(r.despertar)}</td>
      <td><button class="small danger" data-del-sueno="${r.id}">X</button></td>
    </tr>`;
  });
  html += '</tbody></table>';
  wrap.innerHTML = html;

  wrap.querySelectorAll('[data-del-sueno]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delSueno;
      await db.sueno.delete(id);
      await db.outbox.put({
        table: 'sueno',
        record_id: id,
        operation: 'delete',
        data: { id, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() },
        onConflict: 'id',
        created_at: new Date().toISOString()
      });
      showToast('Sueño eliminado ✅');
      await syncAll();
      actualizarSleepHistorial();
      actualizarGraficoSueno();
    });
  });
}

// ===================== NOTAS =====================
export async function actualizarNotas() {
  const wrap = document.getElementById('listaNotas');
  if (!wrap) return;

  const problemas = await db.sessions.where('tipo').equals('problema').toArray();
  const notas = problemas.filter(p => p.modo === 'A' && p.nota && p.nota.trim() !== '');

  const selMat = document.getElementById('filtroNotaMateria');
  const selSub = document.getElementById('filtroNotaSubtema');
  const selCap = document.getElementById('filtroNotaCapitulo');

  if (selMat) {
    const materias = [...new Set(state.currentTemario.map(t => t.materia))];
    const matsDB = await db.materias.toArray();
    const todasMaterias = [...new Set([...materias, ...matsDB.map(m => m.nombre)])];
    const materiaActual = selMat.value || 'Todos';
    selMat.innerHTML = '<option value="Todos">Todas</option>' + todasMaterias.map(m => `<option value="${m}">${m}</option>`).join('');
    selMat.value = materiaActual;
  }

  if (selSub) {
    const materiaSeleccionada = selMat.value !== 'Todos' ? selMat.value : null;
    const subtemas = [];
    if (materiaSeleccionada) {
      const tem = state.currentTemario.filter(t => t.materia === materiaSeleccionada);
      const extras = await db.subtemas_extra.where('materia').equals(materiaSeleccionada).toArray();
      subtemas.push(...tem.map(t => ({ id: t.id.toString(), nombre: t.nombre })));
      subtemas.push(...extras.map(e => ({ id: 'extra_' + e.id, nombre: e.nombre })));
    } else {
      const tem = state.currentTemario;
      const extras = await db.subtemas_extra.toArray();
      subtemas.push(...tem.map(t => ({ id: t.id.toString(), nombre: t.nombre })));
      subtemas.push(...extras.map(e => ({ id: 'extra_' + e.id, nombre: e.nombre })));
    }
    const subActual = selSub.value || 'Todos';
    selSub.innerHTML = '<option value="Todos">Todos</option>' + subtemas.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
    selSub.value = subActual;
  }

  if (selCap) {
    const capitulos = new Set();
    notas.forEach(n => { if (n.capitulo) capitulos.add(n.capitulo); });
    const capActual = selCap.value || 'Todos';
    selCap.innerHTML = '<option value="Todos">Todos</option>' + [...capitulos].map(c => `<option value="${c}">${c}</option>`).join('');
    selCap.value = capActual;
  }

  const filtradas = notas.filter(n => {
    if (selMat.value !== 'Todos' && n.materia !== selMat.value) return false;
    if (selSub.value !== 'Todos' && n.subtema_id !== selSub.value) return false;
    if (selCap.value !== 'Todos' && n.capitulo !== selCap.value) return false;
    return true;
  });

  if (!filtradas.length) {
    wrap.innerHTML = '<p style="color:var(--text2);">Sin notas.</p>';
    return;
  }

  let html = '<table><tr><th>Materia</th><th>Subtema</th><th>Problema</th><th>Capítulo</th><th>Nota</th></tr>';
  filtradas.forEach(n => {
    html += `<tr><td>${n.materia || ''}</td><td>${n.subtema_nombre || n.subtema_id || ''}</td><td>${n.problema_num || '-'}</td><td>${n.capitulo || '-'}</td><td>${n.nota}</td></tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}