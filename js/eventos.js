import { state, State, db, supabase } from './config.js';
import { showToast, hoyLocal } from './utils.js';
import { transition } from './pomodoro.js';
import {
  updatePomoDisplay, updatePomoStatusText, updatePomoButtons,
  setConfigEnabled, stopLecturaInterval, detenerTemporizadorCiego,
  actualizarBotonModoPomodoro
} from './ui.js';
import { guardarLocalYOutbox, corregirSesionId, syncAll, pullChanges } from './sync.js';
import { actualizarPanelesActivos } from './panels.js';
import {
  poblarMaterias, poblarSubtemas, poblarLibros, actualizarCapitulos,
  poblarSecciones, verificarAgregarSubtema, verificarAgregarSeccion
} from './selectores.js';
import { actualizarHistorialSubtema, mostrarColaErrores } from './repasos.js';
import { actualizarSleepHistorial, actualizarGraficoSueno, calcularHoras } from './suenoNotas.js';
import { actualizarMetas } from './checklistMetas.js';
import { actualizarConjeturasFull } from './conjeturas.js';
import { actualizarNotas } from './suenoNotas.js';
import { actualizarChecklist } from './checklistMetas.js';
import { actualizarMetricas, actualizarPanelMetricas } from './metricas.js';

export function initEventos() {
  // ===================== EVENTOS DE NAVEGACIÓN =====================
  document.getElementById('tabNav').addEventListener('click', e => {
    if (!e.target.classList.contains('tab-btn')) return;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    document.getElementById(e.target.dataset.panel).classList.add('active');
    actualizarPanelesActivos();
  });

  // ===================== AUTENTICACIÓN =====================
  document.getElementById('btn-login').addEventListener('click', async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href.split('#')[0] } });
  });
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await supabase.auth.signOut(); location.reload();
  });
  document.getElementById('btnLogoutTop').addEventListener('click', async () => {
    await supabase.auth.signOut(); location.reload();
  });

  // ===================== BOTONES POMODORO =====================
  document.getElementById('btnPomoStart').addEventListener('click', () => {
    if (state.session.state !== State.IDLE) return;
    state.session.remainingSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
    updatePomoDisplay(); transition(State.FOCUS_RUNNING);
  });
  document.getElementById('btnPomoPause').addEventListener('click', () => {
    if (state.session.state === State.FOCUS_RUNNING) transition(State.FOCUS_PAUSED);
    else if (state.session.state === State.BREAK_RUNNING) transition(State.BREAK_PAUSED);
  });
  document.getElementById('btnPomoResume').addEventListener('click', () => {
    if (state.session.state === State.FOCUS_PAUSED) transition(State.FOCUS_RUNNING);
    else if (state.session.state === State.BREAK_PAUSED) transition(State.BREAK_RUNNING);
  });
  document.getElementById('btnPomoStop').addEventListener('click', () => transition(State.SESSION_ENDING));
  document.getElementById('btnPomoReset').addEventListener('click', async () => {
    if (state.session.state !== State.IDLE && state.session.elapsedTotal > 0 && !confirm('¿Reiniciar? Se perderá la sesión actual.')) return;
    if (state.session.tempId) { await db.sessions.where('sesion_id').equals(state.session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(state.session.tempId).delete(); }
    transition(State.IDLE); actualizarPanelesActivos();
  });
  document.getElementById('btnPomoPauseFloat').addEventListener('click', () => {
    if (state.session.state === State.FOCUS_RUNNING || state.session.state === State.BREAK_RUNNING) {
      transition(state.session.state === State.FOCUS_RUNNING ? State.FOCUS_PAUSED : State.BREAK_PAUSED);
    } else if (state.session.state === State.FOCUS_PAUSED || state.session.state === State.BREAK_PAUSED) {
      transition(state.session.state === State.FOCUS_PAUSED ? State.FOCUS_RUNNING : State.BREAK_RUNNING);
    }
  });
  document.getElementById('btnPomoStopFloat').addEventListener('click', () => transition(State.SESSION_ENDING));
  document.getElementById('btnPomoResetFloat').addEventListener('click', async () => {
    if (state.session.state !== State.IDLE && state.session.elapsedTotal > 0 && !confirm('¿Reiniciar? Se perderá la sesión actual.')) return;
    if (state.session.tempId) { await db.sessions.where('sesion_id').equals(state.session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(state.session.tempId).delete(); }
    transition(State.IDLE); actualizarPanelesActivos();
  });

  // Botón modo Pomodoro
  document.getElementById('btnTogglePomodoroMode').addEventListener('click', () => {
    if (state.session.state !== State.IDLE) {
      showToast('Cambia de modo cuando la sesión esté detenida');
      return;
    }
    state.session.pomodoroMode = (state.session.pomodoroMode === 'countdown') ? 'timer' : 'countdown';
    actualizarBotonModoPomodoro();
  });

  // Cerrar modal detalle problema
  document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
    document.getElementById('modalDetalleProblema').style.display = 'none';
  });

  // ===================== GUARDAR RESUMEN =====================
  document.getElementById('btnGuardarResumen').addEventListener('click', async () => {
    const frustracion = parseInt(document.getElementById('resumenFrustracion').value) || 0;
    const energia = parseInt(document.getElementById('resumenEnergia').value) || 3;
    const problemas = await db.sessions.where('tipo').equals('problema').and(s => s.sesion_id === state.session.tempId).toArray();
    const total = problemas.length;
    const tiempoTotal = problemas.reduce((a, p) => a + (p.tiempo_s || 0), 0);
    const conjs = (await db.conjeturas.where('sesion_id').equals(state.session.tempId).toArray()).length;
    const idSesion = await guardarLocalYOutbox('study_sessions', 'sessions', {
      tipo: 'pomodoro', fecha: hoyLocal(), timestamp: Date.now(),
      modo: document.getElementById('selModo').value, fase: document.getElementById('selFase').value,
      materia: document.getElementById('selMateria').value, subtema_id: document.getElementById('selSubtema').value,
      libro: document.getElementById('selLibro').value, capitulo: document.getElementById('selCapitulo').value,
      seccion: document.getElementById('selSeccion').value,
      subtema_nombre: document.getElementById('selSubtema').selectedOptions[0]?.textContent || '',
      tiempo_pomodoro: state.session.elapsedTotal, tiempo_lectura: state.session.lecturaSeconds, frustracion, energia,
      resumen_ejercicios: total, resumen_correctos: problemas.filter(p => p.resultado === 'bien').length,
      resumen_incorrectos: problemas.filter(p => p.resultado === 'mal').length,
      resumen_no_resueltos: problemas.filter(p => p.resultado === 'no_resuelto').length,
      resumen_lectura: state.session.lecturaSeconds, resumen_tiempo_promedio: total ? tiempoTotal / total : 0,
      resumen_conjeturas: conjs, resumen_distracciones: state.session.distracciones,
      pomodoro_label: 'pomodoro_' + Date.now()
    });
    if (idSesion) await corregirSesionId(state.session.tempId, idSesion);
    document.getElementById('modalResumen').style.display = 'none';
    transition(State.IDLE);
    actualizarPanelesActivos();
  });

  document.getElementById('btnCancelarResumen').addEventListener('click', async () => {
    if (state.session.tempId) { await db.sessions.where('sesion_id').equals(state.session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(state.session.tempId).delete(); }
    document.getElementById('modalResumen').style.display = 'none';
    transition(State.IDLE);
    actualizarPanelesActivos();
  });

  // ===================== DISTRACCIÓN / LECTURA =====================
  document.getElementById('btnDistraje').addEventListener('click', () => {
    if (state.session.state !== State.FOCUS_RUNNING && state.session.state !== State.BREAK_RUNNING) return;
    state.session.distracciones++; showToast('registrado ✅', 1500);
  });
  document.getElementById('btnDistrajeFloat').addEventListener('click', () => {
    if (state.session.state !== State.FOCUS_RUNNING && state.session.state !== State.BREAK_RUNNING) return;
    state.session.distracciones++; showToast('registrado ✅', 1500);
  });

  let lecturaIntervalGlobal = null;
  function toggleLectura() {
    if (!state.session.lecturaRunning) {
      if (state.session.state !== State.FOCUS_RUNNING && state.session.state !== State.BREAK_RUNNING) return;
      state.session.lecturaRunning = true;
      const start = Date.now() - state.session.lecturaSeconds * 1000;
      lecturaIntervalGlobal = setInterval(() => {
        state.session.lecturaSeconds = Math.round((Date.now() - start) / 1000);
        const m = Math.floor(state.session.lecturaSeconds / 60);
        const s = state.session.lecturaSeconds % 60;
        const display = `${m}:${String(s).padStart(2, '0')}`;
        document.getElementById('lecturaAcumulado').textContent = display;
        document.getElementById('lecturaAcumuladoFloat').textContent = display;
        document.getElementById('btnLecturaToggleFloat').innerHTML = '⏹ <span id="lecturaAcumuladoFloat">' + display + '</span>';
      }, 1000);
      document.getElementById('btnLecturaToggleFloat').innerHTML = '⏹ <span id="lecturaAcumuladoFloat">0:00</span>';
    } else {
      stopLecturaInterval();
      clearInterval(lecturaIntervalGlobal);
      document.getElementById('btnLecturaToggleFloat').innerHTML = '▶ <span id="lecturaAcumuladoFloat">0:00</span>';
    }
  }
  document.getElementById('btnLecturaStart').addEventListener('click', () => { if (!state.session.lecturaRunning) toggleLectura(); });
  document.getElementById('btnLecturaStop').addEventListener('click', () => { if (state.session.lecturaRunning) stopLecturaInterval(); });
  document.getElementById('btnLecturaToggleFloat').addEventListener('click', toggleLectura);

  // ===================== AGREGAR MATERIA/SUBTEMA/SECCIÓN =====================
  document.getElementById('btnAgregarMateria').addEventListener('click', async () => {
    const nombre = document.getElementById('nuevaMateria').value.trim(); if (!nombre) return;
    await guardarLocalYOutbox('materias', 'materias', { nombre }, 'user_id,nombre');
    await poblarMaterias();
    document.getElementById('selMateria').value = nombre;
    document.getElementById('nuevaMateria').value = '';
    document.getElementById('agregarMateriaRow').style.display = 'none';
    document.getElementById('selMateria').dispatchEvent(new Event('change'));
  });

  document.getElementById('btnAgregarSubtema').addEventListener('click', async () => {
    const materia = document.getElementById('selMateria').value;
    const nombre = document.getElementById('nuevoSubtema').value.trim();
    if (!materia || materia === '__agregar__' || !nombre) return;
    const id = await guardarLocalYOutbox('subtemas_extra', 'subtemas_extra', { materia, nombre, etapa: 'Personalizado' });
    await poblarSubtemas(materia);
    document.getElementById('selSubtema').value = 'extra_' + id;
    document.getElementById('nuevoSubtema').value = '';
    document.getElementById('agregarSubtemaRow').style.display = 'none';
    state.currentProblemaNum = 1;
    document.getElementById('numProblema').value = 1;
  });

  document.getElementById('btnAgregarSeccion').addEventListener('click', async () => {
    const materia = document.getElementById('selMateria').value;
    const libro = document.getElementById('selLibro').value;
    const nombre = document.getElementById('nuevaSeccion').value.trim();
    if (!materia || !libro || !nombre) return;
    await guardarLocalYOutbox('secciones_libro', 'secciones_libro', { materia, libro, nombre }, 'id');
    document.getElementById('nuevaSeccion').value = '';
    await poblarSecciones(materia, libro);
    document.getElementById('agregarSeccionRow').style.display = 'none';
    document.getElementById('selSeccion').value = nombre;
  });

  // ===================== SUEÑO Y METAS =====================
  document.getElementById('btnGuardarSueno').addEventListener('click', async () => {
    const fecha = document.getElementById('fechaSueno').value;
    const acostar = document.getElementById('acostarSueno').value;
    const despertar = document.getElementById('despertarSueno').value;
    const horas = calcularHoras(acostar, despertar);
    const calidad = parseFloat(document.getElementById('calidadSueno').value);
    if (!fecha || isNaN(calidad)) return;
    await guardarLocalYOutbox('sueno', 'sueno', {
      fecha, horas, calidad,
      timestamp: new Date().toISOString(),
      acostar: acostar + ':00',
      despertar: despertar + ':00'
    }, 'user_id,fecha');
    document.getElementById('calidadSueno').value = '';
    document.getElementById('acostarSueno').value = '';
    document.getElementById('despertarSueno').value = '';
    document.getElementById('horasCalculadas').textContent = '--';
    showToast('Sueño registrado ✅');
    actualizarSleepHistorial();
    actualizarGraficoSueno();
  });

  document.getElementById('btnGuardarMetas').addEventListener('click', async () => {
    await guardarLocalYOutbox('metas', 'metas', { key: 'metaDiaria', value: parseFloat(document.getElementById('metaDiaria').value) || 3 }, 'key,user_id');
    await guardarLocalYOutbox('metas', 'metas', { key: 'metaSemanal', value: parseFloat(document.getElementById('metaSemanal').value) || 15 }, 'key,user_id');
    await guardarLocalYOutbox('metas', 'metas', { key: 'diasActivosMeta', value: state.diasActivosMeta }, 'key,user_id');
    actualizarMetas();
    showToast('Metas guardadas ✅');
  });

  document.getElementById('diasActivosMeta').addEventListener('click', e => {
    const btn = e.target.closest('button[data-dia]');
    if (!btn) return;
    const dia = parseInt(btn.dataset.dia);
    if (state.diasActivosMeta.includes(dia)) {
      state.diasActivosMeta = state.diasActivosMeta.filter(d => d !== dia);
      btn.classList.remove('active');
    } else {
      state.diasActivosMeta.push(dia);
      btn.classList.add('active');
    }
    db.metas.put({ key: 'diasActivosMeta', value: state.diasActivosMeta, updated_at: new Date().toISOString() });
  });

  // ===================== EXPORT/IMPORT/TEMARIO/SYNC =====================
  document.getElementById('btnExport').addEventListener('click', async () => {
    const data = {
      sessions: await db.sessions.toArray(),
      conjeturas: await db.conjeturas.toArray(),
      sueno: await db.sueno.toArray(),
      materias: await db.materias.toArray(),
      subtemas_extra: await db.subtemas_extra.toArray(),
      checklist: await db.checklist.toArray(),
      metas: await db.metas.toArray(),
      errores: await db.errores.toArray(),
      repasos: await db.repasos.toArray(),
      fsrs_pesos_congelados: await db.fsrs_pesos_congelados.toArray(),
      dominio_temas: await db.dominio_temas.toArray(),
      temario: await db.temario.toArray(),
      secciones_libro: await db.secciones_libro.toArray(),
      outbox: await db.outbox.toArray(),
      sync_metadata: await db.sync_metadata.toArray()
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'estudio_backup_completo.json';
    a.click();
  });

  document.getElementById('btnImport').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.sessions) { await db.sessions.clear(); await db.sessions.bulkPut(data.sessions); }
      if (data.conjeturas) { await db.conjeturas.clear(); await db.conjeturas.bulkPut(data.conjeturas); }
      if (data.sueno) { await db.sueno.clear(); await db.sueno.bulkPut(data.sueno); }
      if (data.materias) { await db.materias.clear(); await db.materias.bulkPut(data.materias); }
      if (data.subtemas_extra) { await db.subtemas_extra.clear(); await db.subtemas_extra.bulkPut(data.subtemas_extra); }
      if (data.checklist) { await db.checklist.clear(); await db.checklist.bulkPut(data.checklist); }
      if (data.metas) { await db.metas.clear(); await db.metas.bulkPut(data.metas); }
      if (data.errores) { await db.errores.clear(); await db.errores.bulkPut(data.errores); }
      if (data.repasos) { await db.repasos.clear(); await db.repasos.bulkPut(data.repasos); }
      if (data.fsrs_pesos_congelados) { await db.fsrs_pesos_congelados.clear(); await db.fsrs_pesos_congelados.bulkPut(data.fsrs_pesos_congelados); }
      if (data.dominio_temas) { await db.dominio_temas.clear(); await db.dominio_temas.bulkPut(data.dominio_temas); }
      if (data.temario) { await db.temario.clear(); await db.temario.bulkPut(data.temario); }
      if (data.secciones_libro) { await db.secciones_libro.clear(); await db.secciones_libro.bulkPut(data.secciones_libro); }
      if (data.sync_metadata) { await db.sync_metadata.clear(); await db.sync_metadata.bulkPut(data.sync_metadata); }
      await syncAll();
      actualizarPanelesActivos();
      showToast('Datos importados.');
    } catch (e) {
      showToast('Error al importar.');
    }
    this.value = '';
  });

  document.getElementById('btnLoadTemario').addEventListener('click', () => document.getElementById('temarioFile').click());
  document.getElementById('temarioFile').addEventListener('change', async function() {
    const file = this.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data) || !data.every(t => t.materia && t.nombre)) {
        showToast('Formato de temario inválido (se esperaba una lista con materia y nombre).');
        this.value = '';
        return;
      }
      state.currentTemario.length = 0;
      state.currentTemario.push(...data);
      await db.temario.put({ key: 'activo', contenido: data, updated_at: new Date().toISOString() });
      await poblarMaterias();
      document.getElementById('selMateria').dispatchEvent(new Event('change'));
      await actualizarChecklist();
      showToast('Temario cargado ✅');
    } catch (e) {
      showToast('Error al cargar el temario.');
    }
    this.value = '';
  });

  document.getElementById('btnSyncNow').addEventListener('click', async () => {
    if (!state.sessionActual?.user) { showToast('Inicia sesión primero', 2000); return; }
    showToast('Sincronizando…', 1500);
    const ops = await db.outbox.toArray();
    if (ops.length === 0) { alert('Outbox vacío. Nada que sincronizar.'); return; }
    let enviados = 0, errores = [];
    for (const op of ops) {
      let error;
      if (op.operation === 'delete') {
        const keys = (op.onConflict || 'id').split(',').map(k => k.trim());
        let query = supabase.from(op.table).update({ deleted_at: op.data.deleted_at || new Date().toISOString() });
        keys.forEach(k => { query = query.eq(k, op.data[k]); });
        ({ error } = await query);
      } else {
        const data = { ...op.data };
        if (op.table === 'checklist' || op.table === 'metas') delete data.id;
        ({ error } = await supabase.from(op.table).upsert(data, { onConflict: op.onConflict || 'id' }));
      }
      if (!error) { await db.outbox.delete(op.localId); enviados++; }
      else { errores.push({ table: op.table, id: op.record_id, mensaje: error?.message, detalles: error }); console.error('Error al sincronizar:', error); }
    }
    if (errores.length > 0) alert('Errores:\n' + JSON.stringify(errores, null, 2));
    else alert('Enviados: ' + enviados);
    await pullChanges();
    actualizarPanelesActivos();
  });

  // ===================== SELECTORES =====================
  document.getElementById('selMateria').addEventListener('change', async function() {
    if (this.value === '__agregar__') {
      document.getElementById('agregarMateriaRow').style.display = 'flex';
      return;
    }
    document.getElementById('agregarMateriaRow').style.display = 'none';
    state.currentProblemaNum = 1;
    document.getElementById('numProblema').value = 1;
    try {
      await poblarSubtemas(this.value);
      poblarLibros(document.getElementById('selSubtema').value);
      if (document.getElementById('active-view').classList.contains('active')) {
        await actualizarHistorialSubtema();
        document.getElementById('nombreSubtemaHistorial').textContent = this.selectedOptions[0]?.textContent || '';
      }
    } catch (e) {
      console.error('Error en change materia:', e);
    }
  });

  document.getElementById('selSubtema').addEventListener('change', async function() {
    verificarAgregarSubtema();
    poblarLibros(this.value);
    actualizarCapitulos(document.getElementById('selLibro').value, this.value);
    if (this.value !== '__agregar__') {
      state.currentProblemaNum = 1;
      document.getElementById('numProblema').value = 1;
    }
    if (document.getElementById('active-view').classList.contains('active')) {
      actualizarHistorialSubtema();
      const libro = document.getElementById('selLibro').value;
      const problemasPrevios = await db.sessions
        .where('tipo').equals('problema')
        .and(p => p.subtema_id === this.value && p.libro === libro)
        .toArray();
      const maxNum = problemasPrevios.reduce((max, p) => Math.max(max, p.problema_num || 0), 0);
      document.getElementById('numProblema').value = maxNum + 1;
      state.currentProblemaNum = maxNum + 1;
      document.getElementById('nombreSubtemaHistorial').textContent = this.selectedOptions[0]?.textContent || '';
      if (state.session.modo === 'B') mostrarColaErrores();
    }
  });

  document.getElementById('selLibro').addEventListener('change', function() {
    actualizarCapitulos(this.value, document.getElementById('selSubtema').value);
    poblarSecciones(document.getElementById('selMateria').value, this.value);
    document.getElementById('agregarSeccionRow').style.display = 'none';
  });

  document.getElementById('selSeccion').addEventListener('change', function() {
    verificarAgregarSeccion();
    if (document.getElementById('active-view').classList.contains('active')) {
      actualizarHistorialSubtema();
    }
  });

  document.getElementById('acostarSueno').addEventListener('change', actualizarHorasCalculadas);
  document.getElementById('despertarSueno').addEventListener('change', actualizarHorasCalculadas);
  function actualizarHorasCalculadas() {
    const acostar = document.getElementById('acostarSueno').value;
    const despertar = document.getElementById('despertarSueno').value;
    const horas = calcularHoras(acostar, despertar);
    document.getElementById('horasCalculadas').textContent = horas ? horas + ' h' : '--';
  }
}