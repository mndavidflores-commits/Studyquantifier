import { db, state } from './config.js';
import { formatTime, showToast } from './utils.js';
import { guardarLocalYOutbox, syncAll } from './sync.js';
import { updateBlindDisplay } from './ui.js';
import { fsrs, generatorParameters, createEmptyCard, State as EstadoFSRS } from 'https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm';

// ===================== MODO B: SELECTOR DE ERRORES =====================
document.getElementById('selProblemaPendiente').addEventListener('change', function() {
  const errorId = this.value;
  state.errorSeleccionado = state.erroresPendientes.find(e => e.id === errorId) || null;
});

export async function mostrarColaErrores() {
  const materia = document.getElementById('selMateria').value;
  const subtema = document.getElementById('selSubtema').value;
  const finDeHoy = new Date(); finDeHoy.setHours(23, 59, 59, 999);
  const errores = (await db.errores.where('estado').equals('activo').toArray())
    .filter(e => e.materia === materia && e.subtema_id === subtema && new Date(e.proxima_revision) <= finDeHoy)
    .sort((a, b) => new Date(a.proxima_revision) - new Date(b.proxima_revision));

  state.erroresPendientes = errores;
  const select = document.getElementById('selProblemaPendiente');
  select.innerHTML = '';
  if (errores.length === 0) {
    select.innerHTML = '<option value="">Sin errores pendientes</option>';
    state.errorSeleccionado = null;
  } else {
    const numerosProblema = await Promise.all(errores.map(async e => {
      const filaOrigen = e.sesion_id_origen ? await db.sessions.get(e.sesion_id_origen) : null;
      return filaOrigen?.problema_num ?? '?';
    }));
    errores.forEach((e, i) => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `Problema #${numerosProblema[i]} – ${e.etiqueta || '—'} (vence ${new Date(e.proxima_revision).toLocaleDateString()})`;
      select.appendChild(opt);
    });
    select.selectedIndex = 0;
    state.errorSeleccionado = errores[0];
  }
}

export async function actualizarUIPorModo() {
  const esModoB = state.session.modo === 'B';
  document.getElementById('input-num-problema').style.display = esModoB ? 'none' : 'block';
  document.getElementById('sel-problema-pendiente').style.display = esModoB ? 'block' : 'none';
  document.getElementById('formResultadoA').style.display = esModoB ? 'none' : 'block';
  document.getElementById('formResultadoB').style.display = esModoB ? 'block' : 'none';
  if (esModoB) await mostrarColaErrores();
}

// ===================== HISTORIAL DEL SUBTEMA =====================
export async function actualizarHistorialSubtema() {
  const subtemaId = document.getElementById('selSubtema').value;
  if (!subtemaId || subtemaId === '__agregar__') return;

    const modoActual = state.session.modo;
  const problemas = await db.sessions.where('tipo').equals('problema')
    .and(p => p.subtema_id === subtemaId && p.modo === modoActual)
    .toArray();
  
  problemas.sort((a, b) => (b.problema_num || 0) - (a.problema_num || 0) || new Date(b.timestamp) - new Date(a.timestamp));
  const wrap = document.getElementById('historialSubtemaTableWrap');
  let html = '<table><tr><th>#</th><th>Tiempo</th><th>Resultado</th></tr>';
  problemas.forEach(p => {
    const res = p.resultado === 'bien' ? 'B' : (p.resultado === 'mal' ? 'M' : 'NR');
    const badgeClass = `result-${p.resultado === 'bien' ? 'b' : (p.resultado === 'mal' ? 'm' : 'nr')}`;
    html += `<tr data-sesionid="${p.id}">
      <td>${p.problema_num || '-'}</td>
      <td>${formatTime(p.tiempo_s)}</td>
      <td><span class="${badgeClass}">${res}</span></td>
    </tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
  wrap.querySelectorAll('tr').forEach(row => {
    row.addEventListener('click', async () => {
      const sid = row.dataset.sesionid;
      if (!sid) return;
      const prob = await db.sessions.get(sid);
      if (!prob) return;
      document.getElementById('detalleContenido').innerHTML = `
        <p><strong>Problema #</strong> ${prob.problema_num}</p>
        <p><strong>Fecha:</strong> ${prob.fecha}</p>
        <p><strong>Tiempo:</strong> ${formatTime(prob.tiempo_s)}</p>
        <p><strong>Resultado:</strong> ${prob.resultado}</p>
        <p><strong>Error:</strong> ${prob.codigo_error || '—'}</p>
        <p><strong>Confianza:</strong> ${prob.confianza ?? '—'}</p>
        <p><strong>Dificultad:</strong> ${prob.dificultad_experimentada ?? '—'}</p>
        <p><strong>Intentos:</strong> ${prob.intentos ?? '—'}</p>
        <p><strong>Bloom:</strong> ${prob.nivel_bloom ?? '—'}</p>
      `;
      document.getElementById('modalDetalleProblema').style.display = 'flex';
      document.getElementById('btnEliminarProblema').onclick = async () => {
        await db.sessions.delete(sid);
        await db.outbox.put({ table: 'study_sessions', record_id: sid, operation: 'delete', data: { id: sid, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() }, onConflict: 'id', created_at: new Date().toISOString() });
        await syncAll();
        document.getElementById('modalDetalleProblema').style.display = 'none';
        actualizarHistorialSubtema();
        const { actualizarTodo } = await import('./app.js');
        actualizarTodo();
      };
    });
  });
}

export async function actualizarConjeturasSesion() {
  const conjs = await db.conjeturas.orderBy('timestamp').reverse().limit(20).toArray();
  const wrap = document.getElementById('listaConjeturasSesion');
  if (!conjs.length) { wrap.innerHTML = 'Sin conjeturas.'; return; }
  let html = '<table><tr><th>Conjetura</th><th>Materia</th><th>Ejercicio</th><th>Subtema</th><th>Fecha</th></tr>';
  conjs.forEach(c => {
    const d = new Date(c.timestamp);
    html += `<tr><td>${c.texto}</td><td>${c.materia || ''}</td><td>${c.problema_num || ''}</td><td>${c.subtema_id || ''}</td><td>${d.toLocaleTimeString()}</td></tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}

// ===================== FSRS Y DOMINIO =====================
export function crearInstanciaFSRS(pesos) {
  return fsrs(generatorParameters({
    request_retention: 0.9,
    enable_short_term: false,
    w: pesos
  }));
}

export async function getPesosCongelados(materia) {
  let fila = (await db.fsrs_pesos_congelados.where('materia').equals(materia).toArray())[0];
  if (!fila) {
    const id = await guardarLocalYOutbox('fsrs_pesos_congelados', 'fsrs_pesos_congelados', {
      materia, pesos_json: generatorParameters().w, fecha_congelado: new Date().toISOString()
    });
    fila = await db.fsrs_pesos_congelados.get(id);
  }
  return fila.pesos_json;
}

export function reconstruirCardDesdeError(error, ultimaRevision) {
  return {
    due: new Date(error.proxima_revision),
    stability: error.fsrs_estabilidad,
    difficulty: error.fsrs_dificultad,
    elapsed_days: 0,
    scheduled_days: 0,
    learning_steps: 0,
    reps: error.fsrs_reps,
    lapses: 0,
    state: error.fsrs_reps === 0 ? EstadoFSRS.New : EstadoFSRS.Review,
    last_review: ultimaRevision ? new Date(ultimaRevision) : undefined
  };
}

async function obtenerUltimaRevision(errorId, fechaCreacion) {
  const previos = await db.repasos.where('error_id').equals(errorId).toArray();
  if (previos.length === 0) return fechaCreacion;
  previos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  return previos[0].fecha;
}

async function actualizarErrorParcial(errorId, cambios) {
  const existente = await db.errores.get(errorId);
  if (!existente) return null;
  return await guardarLocalYOutbox('errores', 'errores', { ...existente, ...cambios, id: errorId });
}

export async function crearErrorDesdeProblema({ materia, subtemaId, subtemaNombre, etiqueta, fase, idProblema }) {
  await getPesosCongelados(materia);
  const ahora = new Date();
  const cardVacia = createEmptyCard(ahora);
  await guardarLocalYOutbox('errores', 'errores', {
    materia, subtema_id: subtemaId, subtema_nombre: subtemaNombre, etiqueta,
    condicion_origen: fase, fecha_creacion: ahora.toISOString(),
    sesion_id_origen: idProblema, estado: 'activo',
    fsrs_estabilidad: cardVacia.stability, fsrs_dificultad: cardVacia.difficulty,
    fsrs_reps: cardVacia.reps, proxima_revision: cardVacia.due.toISOString()
  });
}

// ===================== CALIFICACIÓN (MODO B) =====================
document.getElementById('toggleCalificacion').addEventListener('click', e => {
  if (!e.target.classList.contains('toggle-btn')) return;
  document.querySelectorAll('#toggleCalificacion .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
});

document.getElementById('btnGuardarRepaso').addEventListener('click', async () => {
  if (!state.errorSeleccionado) return;
  const calBtn = document.querySelector('#toggleCalificacion .toggle-btn.active');
  if (!calBtn) { showToast('Selecciona una calificación.'); return; }
  const calificacion = calBtn.dataset.val === 'bien' ? 3 : 1; // Good=3, Again=1
  const consultoSolucion = document.getElementById('chkConsultoSolucion').checked;
  const materia = document.getElementById('selMateria').value;
  const subtema = document.getElementById('selSubtema').value;
  const subtemaNombre = document.getElementById('selSubtema').selectedOptions[0]?.textContent || '';
  const pesos = await getPesosCongelados(materia);
  const f = crearInstanciaFSRS(pesos);
  const ultimaRevision = await obtenerUltimaRevision(state.errorSeleccionado.id, state.errorSeleccionado.fecha_creacion);
  const cardReconstruida = reconstruirCardDesdeError(state.errorSeleccionado, ultimaRevision);
  const ahora = new Date();
  const resultado = f.next(cardReconstruida, ahora, calificacion);
  await guardarLocalYOutbox('repasos', 'repasos', {
    error_id: state.errorSeleccionado.id,
    fecha: ahora.toISOString(),
    calificacion,
    intervalo_dias_asignado: resultado.log.scheduled_days,
    dias_desde_repaso_anterior: resultado.log.elapsed_days,
    tiempo_recall_s: Math.round(state.blindTimer.seconds * 10) / 10,
    consulto_solucion: consultoSolucion,
    estabilidad: resultado.card.stability,
    dificultad: resultado.card.difficulty
  });
  await actualizarErrorParcial(state.errorSeleccionado.id, {
    fsrs_estabilidad: resultado.card.stability,
    fsrs_dificultad: resultado.card.difficulty,
    fsrs_reps: resultado.card.reps,
    proxima_revision: resultado.card.due.toISOString()
  });
  await guardarLocalYOutbox('study_sessions', 'sessions', {
    tipo: 'problema', fecha: new Date().toISOString().split('T')[0], timestamp: Date.now(),
    modo: 'B', fase: document.getElementById('selFase').value, materia, subtema_id: subtema,
    subtema_nombre: subtemaNombre,
    libro: document.getElementById('selLibro').value,
    capitulo: document.getElementById('selCapitulo').value,
    tiempo_s: Math.round(state.blindTimer.seconds * 10) / 10,
    resultado: calificacion >= 3 ? 'bien' : 'mal',
    sesion_id: state.session.tempId
  });
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;
  document.querySelectorAll('#toggleCalificacion .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chkConsultoSolucion').checked = false;
  state.errorSeleccionado = null;
  await mostrarColaErrores();
  const { actualizarMetricas, actualizarTodo } = await import('./app.js');
  actualizarMetricas();
  actualizarTodo();
  actualizarHistorialSubtema();
  document.getElementById('conjeturas-sesion-wrap').style.display = 'block';
  document.getElementById('left-panel').classList.remove('hidden');
  actualizarConjeturasSesion();
});

document.getElementById('btnDescartarRepaso').addEventListener('click', () => {
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;
  document.querySelectorAll('#toggleCalificacion .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chkConsultoSolucion').checked = false;
  document.getElementById('left-panel').classList.remove('hidden');
});
