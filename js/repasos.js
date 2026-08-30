import { showToast, formatTime, hoyLocal } from './utils.js';
import { db, state, State } from './config.js';
import { guardarLocalYOutbox, syncAll } from './sync.js';
import { updateBlindDisplay } from './ui.js';
import { transition } from './pomodoro.js';
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

// ===================== HISTORIAL DEL SUBTEMA (ACORDEÓN) =====================
export async function actualizarHistorialSubtema() {
  const subtemaId = document.getElementById('selSubtema').value;
  if (!subtemaId || subtemaId === '__agregar__') return;

  const modoActual = state.session.modo;
  const seccionActual = document.getElementById('selSeccion')?.value;

  let problemas = await db.sessions.where('tipo').equals('problema')
    .and(p => p.subtema_id === subtemaId && p.modo === modoActual)
    .toArray();

  if (seccionActual && seccionActual !== '__agregar__') {
    problemas = problemas.filter(p => p.seccion === seccionActual);
  }

  const gruposMap = {};
  problemas.forEach(p => {
    const sid = p.sesion_id || 'sin-sesion';
    if (!gruposMap[sid]) gruposMap[sid] = [];
    gruposMap[sid].push(p);
  });

  const gruposArray = Object.entries(gruposMap).map(([sid, probs]) => {
    const minTime = Math.min(...probs.map(p => new Date(p.timestamp || p.fecha).getTime()));
    return { sid, probs, minTime };
  }).sort((a, b) => b.minTime - a.minTime);

  let html = '';

  gruposArray.forEach((grupo, index) => {
    grupo.probs.sort((a, b) => new Date(b.timestamp || b.fecha).getTime() - new Date(a.timestamp || a.fecha).getTime());
    const fecha = grupo.probs[0].fecha || new Date(grupo.probs[0].timestamp).toLocaleDateString('en-CA');
    const numProblemas = grupo.probs.length;
    const openClass = (index === 0) ? ' open' : '';

    html += `
      <div class="sesion-group${openClass}">
        <div class="sesion-header">
          <span>Sesión ${gruposArray.length - index} · ${fecha}</span>
          <span class="arrow">▶</span>
        </div>
        <div class="sesion-content">
          <table>
            <tr><th>#</th><th>Tiempo</th><th>Resultado</th><th>Sección</th></tr>
            ${grupo.probs.map(p => {
              const res = p.resultado === 'bien' ? 'B' : (p.resultado === 'mal' ? 'M' : 'NR');
              const badgeClass = `result-${p.resultado === 'bien' ? 'b' : (p.resultado === 'mal' ? 'm' : 'nr')}`;
              return `
                <tr class="editable-problem" data-problem-id="${p.id}" style="cursor:pointer;">
                  <td>${p.problema_num || '-'}</td>
                  <td>${formatTime(p.tiempo_s)}</td>
                  <td><span class="${badgeClass}">${res}</span></td>
                  <td>${p.seccion || '-'}</td>
                </tr>
              `;
            }).join('')}
          </table>
        </div>
      </div>
    `;
  });

  const wrap = document.getElementById('historialSubtemaTableWrap');
  wrap.innerHTML = html;

  wrap.querySelectorAll('.sesion-header').forEach(header => {
    header.addEventListener('click', () => {
      header.parentElement.classList.toggle('open');
    });
  });

  wrap.querySelectorAll('.editable-problem').forEach(tr => {
    tr.addEventListener('click', (e) => {
      e.stopPropagation();
      editarProblema(tr.dataset.problemId);
    });
  });
}

// ===================== EDITAR PROBLEMA (CON SELECTS) =====================
export async function editarProblema(id) {
  const problema = await db.sessions.get(id);
  if (!problema) return;

  const modal = document.getElementById('modalDetalleProblema');
  const contenido = document.getElementById('detalleContenido');
  modal.style.display = 'flex';

  // Obtener opciones para selects
  const materia = problema.materia;
  const subtemaId = problema.subtema_id;

  // Secciones: predeterminadas + personalizadas
  let secciones = ['Problemas resueltos', 'Problemas propuestos'];
  const seccionesPersonalizadas = await db.secciones_libro
    .where('materia').equals(materia)
    .and(s => s.libro === problema.libro)
    .toArray();
  secciones = secciones.concat(seccionesPersonalizadas.map(s => s.nombre));
  // Asegurar que la sección actual esté incluida
  if (problema.seccion && !secciones.includes(problema.seccion)) {
    secciones.push(problema.seccion);
  }

  // Libros: desde el temario (currentTemario) para el subtema
  const tem = state.currentTemario.find(t => t.id.toString() === subtemaId);
  const libros = (tem && Array.isArray(tem.libros)) ? tem.libros.map(l => l.nombre) : [];
  // Asegurar que el libro actual esté incluido
  if (problema.libro && !libros.includes(problema.libro)) {
    libros.push(problema.libro);
  }

  // Capítulos: para el libro actual
  let capitulos = [];
  const libroActual = problema.libro;
  if (tem && libroActual) {
    const libroObj = tem.libros?.find(l => l.nombre === libroActual);
    if (libroObj && Array.isArray(libroObj.capitulos)) {
      capitulos = libroObj.capitulos;
    }
  }
  if (problema.capitulo && !capitulos.includes(problema.capitulo)) {
    capitulos.push(problema.capitulo);
  }

  contenido.innerHTML = `
    <div class="grid-2">
      <div><label>Problema #</label><input type="number" id="editProblemaNum" value="${problema.problema_num || ''}"></div>
      <div><label>Resultado</label>
        <select id="editResultado">
          <option value="bien" ${problema.resultado === 'bien' ? 'selected' : ''}>Bien</option>
          <option value="mal" ${problema.resultado === 'mal' ? 'selected' : ''}>Mal</option>
          <option value="no_resuelto" ${problema.resultado === 'no_resuelto' ? 'selected' : ''}>No resuelto</option>
        </select>
      </div>
      <div><label>Tiempo (s)</label><input type="number" step="0.1" id="editTiempo" value="${problema.tiempo_s || 0}"></div>
      <div><label>Error</label><input type="text" id="editCodigoError" value="${problema.codigo_error || ''}"></div>
      <div><label>Confianza</label><input type="number" id="editConfianza" min="1" max="5" value="${problema.confianza || ''}"></div>
      <div><label>Dificultad</label><input type="number" id="editDificultad" min="1" max="5" value="${problema.dificultad_experimentada || ''}"></div>
      <div><label>Intentos</label><input type="number" id="editIntentos" min="1" value="${problema.intentos || 1}"></div>
      <div><label>Bloom</label><input type="number" id="editBloom" min="1" max="6" value="${problema.nivel_bloom || ''}"></div>
      <div><label>Nota</label><input type="text" id="editNota" value="${problema.nota || ''}"></div>
      <div><label>Sección</label>
        <select id="editSeccion">
          ${secciones.map(s => `<option value="${s}" ${problema.seccion === s ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </div>
      <div><label>Libro</label>
        <select id="editLibro">
          ${libros.map(l => `<option value="${l}" ${problema.libro === l ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </div>
      <div><label>Capítulo</label>
        <select id="editCapitulo">
          ${capitulos.map(c => `<option value="${c}" ${problema.capitulo === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
    </div>
  `;

  // Configurar botón eliminar
  document.getElementById('btnEliminarProblema').style.display = 'inline-block';
  document.getElementById('btnEliminarProblema').onclick = async () => {
    if (!confirm('¿Eliminar este problema?')) return;
    await db.sessions.delete(id);
    await db.outbox.put({ table: 'study_sessions', record_id: id, operation: 'delete', data: { id, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() }, onConflict: 'id', created_at: new Date().toISOString() });
    await syncAll();
    modal.style.display = 'none';
    actualizarHistorialSubtema();
    const { actualizarTodo } = await import('./app.js');
    actualizarTodo();
  };

  // Configurar botón guardar
  const btnRow = document.querySelector('#modalDetalleProblema .btn-row');
  const btnGuardar = document.createElement('button');
  btnGuardar.textContent = 'Guardar cambios';
  btnGuardar.className = 'primary';
  btnGuardar.id = 'btnGuardarEdicion';
  btnGuardar.onclick = async () => {
    const cambios = {
      problema_num: parseInt(document.getElementById('editProblemaNum').value) || 1,
      resultado: document.getElementById('editResultado').value,
      tiempo_s: parseFloat(document.getElementById('editTiempo').value) || 0,
      codigo_error: document.getElementById('editCodigoError').value,
      confianza: parseInt(document.getElementById('editConfianza').value) || null,
      dificultad_experimentada: parseInt(document.getElementById('editDificultad').value) || null,
      intentos: parseInt(document.getElementById('editIntentos').value) || 1,
      nivel_bloom: parseInt(document.getElementById('editBloom').value) || null,
      nota: document.getElementById('editNota').value,
      seccion: document.getElementById('editSeccion').value,
      libro: document.getElementById('editLibro').value,
      capitulo: document.getElementById('editCapitulo').value
    };
    await guardarLocalYOutbox('study_sessions', 'sessions', { ...problema, ...cambios }, 'id');
    modal.style.display = 'none';
    actualizarHistorialSubtema();
    const { actualizarTodo } = await import('./app.js');
    actualizarTodo();
    showToast('Problema actualizado ✅');
  };

  // Reemplazar o insertar botón guardar
  const existingBtn = document.getElementById('btnGuardarEdicion');
  if (existingBtn) {
    btnRow.replaceChild(btnGuardar, existingBtn);
  } else {
    btnRow.insertBefore(btnGuardar, btnRow.firstChild);
  }
}

// ===================== CONJETURAS DE SESIÓN =====================
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
  const seccion = document.getElementById('selSeccion')?.value || null;
  const pesos = await getPesosCongelados(materia);
  const f = crearInstanciaFSRS(pesos);
  const ultimaRevision = await obtenerUltimaRevision(state.errorSeleccionado.id, state.errorSeleccionado.fecha_creacion);
  const cardReconstruida = reconstruirCardDesdeError(state.errorSeleccionado, ultimaRevision);
  const ahora = new Date();
  const resultado = f.next(cardReconstruida, ahora, calificacion);
  await guardarLocalYOutbox('repasos', 'repasos', {
    error_id: state.errorSeleccionado.id,
    fecha: hoyLocal(),
    timestamp: ahora.toISOString(),
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
    tipo: 'problema', fecha: hoyLocal(), timestamp: Date.now(),
    modo: 'B', fase: document.getElementById('selFase').value, materia, subtema_id: subtema,
    subtema_nombre: subtemaNombre,
    libro: document.getElementById('selLibro').value,
    capitulo: document.getElementById('selCapitulo').value,
    seccion,
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
  const { actualizarMetricas } = await import('./metricas.js');
  const { actualizarTodo } = await import('./app.js');
  actualizarMetricas();
  actualizarTodo();
  actualizarHistorialSubtema();
  document.getElementById('conjeturas-sesion-wrap').style.display = 'block';
  document.getElementById('left-panel').classList.remove('hidden');
  actualizarConjeturasSesion();

  if (state.session.pendingSessionEnd) {
    state.session.pendingSessionEnd = false;
    transition(State.SESSION_ENDING);
  }
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
  actualizarHistorialSubtema();

  if (state.session.pendingSessionEnd) {
    state.session.pendingSessionEnd = false;
    transition(State.SESSION_ENDING);
  }
});