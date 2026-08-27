import { showToast, formatTime, hoyLocal } from './utils.js';
import { db, supabase, state, State } from './config.js';
import { showToast, formatTime } from './utils.js';
import { syncAll, guardarLocalYOutbox, corregirSesionId, pullChanges } from './sync.js';
import { actualizarPanelMetricas, actualizarMetricas } from './metricas.js';
import {
  actualizarHistorialSubtema, actualizarConjeturasSesion,
  actualizarUIPorModo, mostrarColaErrores
} from './repasos.js';
import {
  updatePomoDisplay, updatePomoStatusText, updatePomoButtons,
  setConfigEnabled, stopLecturaInterval, detenerTemporizadorCiego,
  updateBlindDisplay
} from './ui.js';
import { transition } from './pomodoro.js';
import { actualizarGraficoSueno } from './graficos.js';

// ===================== AUTENTICACIÓN =====================
export function actualizarUI(s) {
  state.sessionActual = s;
  if (s?.user) {
    document.getElementById('auth-status').textContent = `Conectado como ${s.user.email}`;
    document.getElementById('btn-login').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'inline-block';
    document.getElementById('app-content').style.display = 'block';
    document.getElementById('user-email').textContent = s.user.email;
    document.getElementById('auth-section').classList.add('hidden');
    if (!state.appInitialized) {
      state.appInitialized = true;
      initApp();
    }
  } else {
    state.appInitialized = false;
    document.getElementById('auth-status').textContent = 'No has iniciado sesión.';
    document.getElementById('btn-login').style.display = 'inline-block';
    document.getElementById('btn-logout').style.display = 'none';
    document.getElementById('app-content').style.display = 'none';
    document.getElementById('auth-section').classList.remove('hidden');
  }
}

// ===================== INICIALIZACIÓN =====================
export async function initApp() {
  await syncAll();
  const storedTemario = await db.temario.get('activo');
  if (storedTemario?.contenido) {
    state.currentTemario.length = 0;
    state.currentTemario.push(...storedTemario.contenido);
  }
  const diasGuardados = await db.metas.get('diasActivosMeta');
  if (diasGuardados && Array.isArray(diasGuardados.value)) {
    state.diasActivosMeta = diasGuardados.value;
  }
  marcarDiasActivos();
  await poblarMaterias();
  document.getElementById('selMateria').dispatchEvent(new Event('change'));
  document.getElementById('fechaSueno').value = hoyLocal();
  updatePomoDisplay(); updatePomoStatusText(); updatePomoButtons();
  setConfigEnabled(true);
  document.getElementById('btnDistraje').disabled = true;
  document.getElementById('btnLecturaStart').disabled = true;
  document.getElementById('btnLecturaStop').disabled = true;
  actualizarTodo();
}

// ===================== ACTUALIZACIÓN GLOBAL =====================
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

// ===================== HISTORIAL COMPLETO =====================
async function actualizarHistorial() {
  const container = document.getElementById('historialContainer');
  if (!container) return;
  const allSessions = await db.sessions.orderBy('timestamp').reverse().toArray();
  const grouped = {};
  allSessions.forEach(s => {
    const fecha = s.fecha || new Date(s.timestamp).toISOString().split('T')[0];
    if (!grouped[fecha]) grouped[fecha] = [];
    grouped[fecha].push(s);
  });
  let html = '';
  const sortedDates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  for (const fecha of sortedDates) {
    html += `<div class="history-date">${fecha}</div>`;
    const pomos = grouped[fecha].filter(s => s.tipo === 'pomodoro');
    for (const pomo of pomos) {
      const problemas = allSessions.filter(s => s.sesion_id === pomo.id && s.tipo === 'problema');
      const conjs = (await db.conjeturas.where('sesion_id').equals(pomo.id).toArray()).length;
      const duracion = pomo.tiempo_pomodoro || 1;
      html += `<div class="pomo-row" data-pomoid="${pomo.id}">
        <div style="display:flex; justify-content:space-between;"><strong>${pomo.pomodoro_label || 'pomodoro_' + pomo.id}</strong><span>${formatTime(duracion)} | ${pomo.materia || 'sin materia'} | ${pomo.modo || ''} | Ej:${problemas.length}</span></div>
        <div class="pomo-details">
          <p>Fase: ${pomo.fase || '-'} | Modo: ${pomo.modo || '-'} | Materia: ${pomo.materia || '-'} | Subtema: ${pomo.subtema_nombre || pomo.subtema_id || '-'}</p>
          <p>Ejercicios: ${problemas.length} (${problemas.filter(p => p.resultado === 'bien').length} bien, ${problemas.filter(p => p.resultado === 'mal').length} mal, ${problemas.filter(p => p.resultado === 'no_resuelto').length} no resuelto)</p>
          <p>Conjeturas: ${conjs} | Ej/min: ${(problemas.length / (duracion / 60)).toFixed(1)} | Conj/min: ${(conjs / (duracion / 60)).toFixed(1)} | Lectura: ${Math.floor(pomo.tiempo_lectura / 60)}:${String(pomo.tiempo_lectura % 60).padStart(2, '0')}</p>
          <table><tr><th>#</th><th>Resultado</th><th>Tiempo</th><th>Error</th></tr>${problemas.map(p => `<tr><td>${p.problema_num}</td><td>${p.resultado}</td><td>${formatTime(p.tiempo_s)}</td><td>${p.codigo_error || ''}</td></tr>`).join('')}</table>
        </div>
      </div>`;
    }
  }
  container.innerHTML = html;
  const lastPomo = container.querySelector('.pomo-row:last-child');
  if (lastPomo) lastPomo.classList.add('expanded');
  container.onclick = (e) => {
    const row = e.target.closest('.pomo-row');
    if (row) row.classList.toggle('expanded');
  };
}

async function actualizarConjeturasFull() {
  const conjs = await db.conjeturas.orderBy('timestamp').reverse().toArray();
  const wrap = document.getElementById('listaConjeturasFull');
  if (!wrap) return;
  if (!conjs.length) { wrap.innerHTML = 'Sin conjeturas.'; return; }
  let html = '<table><tr><th>Conjetura</th><th>Materia</th><th>Ejercicio</th><th>Subtema</th><th>Fecha</th></tr>';
  conjs.forEach(c => {
    const d = new Date(c.timestamp);
    html += `<tr><td>${c.texto}</td><td>${c.materia || ''}</td><td>${c.problema_num || ''}</td><td>${c.subtema_id || ''}</td><td>${d.toLocaleString()}</td></tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}

function calcularHoras(acostar, despertar) {
  if (!acostar || !despertar) return 0;
  const [hA, mA] = acostar.split(':').map(Number);
  const [hD, mD] = despertar.split(':').map(Number);
  let minutos = (hD * 60 + mD) - (hA * 60 + mA);
  if (minutos <= 0) minutos += 24 * 60;
  return Math.round(minutos / 60 * 10) / 10;
}

async function actualizarSleepHistorial() {
  const wrap = document.getElementById('sleepHistorialTable');
  if (!wrap) return;
  const registros = await db.sueno.orderBy('fecha').reverse().toArray();
  if (!registros.length) { wrap.innerHTML = '<p style="color:var(--text2);">Sin registros de sueño.</p>'; return; }
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
      await db.outbox.put({ table: 'sueno', record_id: id, operation: 'delete', data: { id, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() }, onConflict: 'id', created_at: new Date().toISOString() });
      showToast('Sueño eliminado ✅');
      await syncAll();
      actualizarSleepHistorial();
      actualizarGraficoSueno();
    });
  });
}

async function actualizarChecklist() {
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
  container.querySelectorAll('.checklist-cb').forEach(cb => cb.addEventListener('change', async function() {
    const stid = this.dataset.stid;
    if (this.checked) {
      await guardarLocalYOutbox('checklist', 'checklist', { id: stid, subtema_id: stid, fecha_completado: hoyLocal() }, 'subtema_id,user_id');
    } else {
      await db.checklist.where('subtema_id').equals(stid).delete();
      await db.outbox.put({ table: 'checklist', record_id: stid, operation: 'delete', data: { subtema_id: stid, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() }, onConflict: 'subtema_id,user_id', created_at: new Date().toISOString() });
      await syncAll();
    }
    actualizarChecklist();
  }));
}

async function actualizarMetas() {
  const hoy = new Date();
  const diaSemana = hoy.getDay();
  const esDiaActivo = state.diasActivosMeta.includes(diaSemana);

  const sessionsHoy = await db.sessions.where('fecha').equals(hoy.toISOString().split('T')[0]).and(s => s.tipo === 'pomodoro').toArray();
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
  const sessionsSem = await db.sessions.where('fecha').between(inicioSemana.toISOString().split('T')[0], hoy.toISOString().split('T')[0], true, true).and(s => s.tipo === 'pomodoro').toArray();
  const minSem = sessionsSem.reduce((a, s) => a + (s.tiempo_pomodoro || 0), 0) / 3600;
  const metaSemanal = parseFloat(document.getElementById('metaSemanal').value) || 15;
  document.getElementById('progresoSemanal').textContent = `${minSem.toFixed(1)}h / ${metaSemanal}h`;
  document.getElementById('progressSemanal').style.width = Math.min(100, (minSem / metaSemanal) * 100) + '%';
}

async function actualizarNotas() {
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

// ===================== SELECTORES MATERIA/SUBTEMA =====================
async function poblarMaterias() {
  const sel = document.getElementById('selMateria');
  const matsDB = await db.materias.toArray();
  const matsTem = [...new Set(state.currentTemario.map(t => t.materia))];
  const todas = [...new Set([...matsTem, ...matsDB.map(m => m.nombre)])];
  sel.innerHTML = '<option value="__agregar__">+ Agregar nueva materia...</option>';
  todas.forEach(m => sel.innerHTML += `<option value="${m}">${m}</option>`);
  if (todas.length > 0 && sel.options.length > 1) sel.selectedIndex = 1;
}

async function poblarSubtemas(mat) {
  const sel = document.getElementById('selSubtema');
  const tem = state.currentTemario.filter(t => t.materia === mat);
  const extras = await db.subtemas_extra.where('materia').equals(mat).toArray();
  sel.innerHTML = '<option value="__agregar__">+ Agregar nuevo subtema...</option>';
  const grupos = { A0: [], B1: [], B2: [], Personalizado: [] };
  tem.forEach(t => { if (grupos[t.etapa]) grupos[t.etapa].push({ ...t, isExtra: false }); });
  extras.forEach(e => { const etapa = e.etapa || 'Personalizado'; if (grupos[etapa]) grupos[etapa].push({ ...e, id: e.id, isExtra: true }); });
  for (const [etapa, subs] of Object.entries(grupos)) {
    if (!subs.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = etapa;
    subs.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.isExtra ? 'extra_' + s.id : s.id.toString();
      opt.textContent = s.nombre;
      optgroup.appendChild(opt);
    });
    sel.appendChild(optgroup);
  }
  verificarAgregarSubtema();
}

function verificarAgregarSubtema() {
  document.getElementById('agregarSubtemaRow').style.display = (document.getElementById('selSubtema').value === '__agregar__') ? 'flex' : 'none';
}

function poblarLibros(subtemaId) {
  const selLibro = document.getElementById('selLibro');
  const selCapitulo = document.getElementById('selCapitulo');
  selLibro.innerHTML = '';
  selCapitulo.innerHTML = '';
  if (!subtemaId || subtemaId === '__agregar__') {
    selLibro.innerHTML = '<option value="">—</option>';
    selCapitulo.innerHTML = '<option value="">—</option>';
    return;
  }
  const tema = state.currentTemario.find(t => t.id.toString() === subtemaId);
  const libros = (tema && Array.isArray(tema.libros)) ? tema.libros : [];
  if (!libros.length) {
    selLibro.innerHTML = '<option value="">Sin libro</option>';
    selCapitulo.innerHTML = '<option value="">Sin capítulo</option>';
    return;
  }
  selLibro.innerHTML = libros.map(l => `<option value="${l.nombre}">${l.nombre}</option>`).join('');
  actualizarCapitulos(libros[0].nombre, subtemaId);
}

function actualizarCapitulos(libroSeleccionado, subtemaId) {
  const selCapitulo = document.getElementById('selCapitulo');
  selCapitulo.innerHTML = '';
  if (!subtemaId || !libroSeleccionado) {
    selCapitulo.innerHTML = '<option value="">—</option>';
    return;
  }
  const tema = state.currentTemario.find(t => t.id.toString() === subtemaId);
  const libro = tema?.libros?.find(l => l.nombre === libroSeleccionado);
  if (libro && Array.isArray(libro.capitulos) && libro.capitulos.length) {
    selCapitulo.innerHTML = libro.capitulos.map(c => `<option value="${c}">${c}</option>`).join('');
  } else {
    selCapitulo.innerHTML = '<option value="">Sin capítulo</option>';
  }
}

// ===================== EVENTOS GLOBALES =====================
document.getElementById('tabNav').addEventListener('click', e => {
  if (!e.target.classList.contains('tab-btn')) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById(e.target.dataset.panel).classList.add('active');
  if (e.target.dataset.panel === 'panelHistorial') actualizarHistorial();
  if (e.target.dataset.panel === 'panelMetricas') actualizarPanelMetricas();
  if (e.target.dataset.panel === 'panelSueno') { actualizarSleepHistorial(); actualizarGraficoSueno(); }
  if (e.target.dataset.panel === 'panelConjeturas') actualizarConjeturasFull();
  if (e.target.dataset.panel === 'panelNotas') actualizarNotas();
  if (e.target.dataset.panel === 'panelChecklist') actualizarChecklist();
  if (e.target.dataset.panel === 'panelMetas') actualizarMetas();
  if (e.target.dataset.panel === 'panelDominio') { poblarSelectoresDominio(); actualizarDominioHistorial(); }
});

document.getElementById('btn-login').addEventListener('click', async () => {
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href.split('#')[0] } });
});
document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabase.auth.signOut(); actualizarUI(null);
});
document.getElementById('btnLogoutTop').addEventListener('click', async () => {
  await supabase.auth.signOut(); actualizarUI(null);
});

// Pomodoro buttons
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
  transition(State.IDLE); actualizarTodo();
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
  transition(State.IDLE); actualizarTodo();
});

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
  actualizarTodo();
});
document.getElementById('btnCancelarResumen').addEventListener('click', async () => {
  if (state.session.tempId) { await db.sessions.where('sesion_id').equals(state.session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(state.session.tempId).delete(); }
  document.getElementById('modalResumen').style.display = 'none';
  transition(State.IDLE);
  actualizarTodo();
});

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

document.getElementById('btnAgregarMateria').addEventListener('click', async () => {
  const nombre = document.getElementById('nuevaMateria').value.trim(); if (!nombre) return;
  await guardarLocalYOutbox('materias', 'materias', { nombre }, 'user_id,nombre');
  await poblarMaterias();
  document.getElementById('selMateria').value = nombre;
  document.getElementById('nuevaMateria').value = '';
  document.getElementById('agregarMateriaRow').style.display = 'none';
  document.getElementById('selMateria').dispatchEvent(new Event('change'));
  await poblarSelectoresDominio();
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
  await poblarSelectoresDominio();
});
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

function marcarDiasActivos() {
  document.querySelectorAll('#diasActivosMeta button[data-dia]').forEach(btn => {
    const dia = parseInt(btn.dataset.dia);
    if (state.diasActivosMeta.includes(dia)) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

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
    if (data.sync_metadata) { await db.sync_metadata.clear(); await db.sync_metadata.bulkPut(data.sync_metadata); }
    await syncAll();
    actualizarTodo();
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
    await poblarSelectoresDominio();
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
      ({ error } = await supabase.from(op.table).upsert(op.data, { onConflict: op.onConflict || 'id' }));
    }
    if (!error) { await db.outbox.delete(op.localId); enviados++; }
    else { errores.push({ table: op.table, id: op.record_id, mensaje: error?.message, detalles: error }); console.error('Error al sincronizar:', error); }
  }
  if (errores.length > 0) alert('Errores:\n' + JSON.stringify(errores, null, 2));
  else alert('Enviados: ' + enviados);
  await pullChanges();
  actualizarTodo();
});

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
});

document.getElementById('acostarSueno').addEventListener('change', actualizarHorasCalculadas);
document.getElementById('despertarSueno').addEventListener('change', actualizarHorasCalculadas);
function actualizarHorasCalculadas() {
  const acostar = document.getElementById('acostarSueno').value;
  const despertar = document.getElementById('despertarSueno').value;
  const horas = calcularHoras(acostar, despertar);
  document.getElementById('horasCalculadas').textContent = horas ? horas + ' h' : '--';
}

async function poblarSelectoresDominio() {
  const selMat = document.getElementById('domMateria');
  if (!selMat) return;
  const matsTem = [...new Set(state.currentTemario.map(t => t.materia))];
  const matsDB = await db.materias.toArray();
  const todas = [...new Set([...matsTem, ...matsDB.map(m => m.nombre)])];
  selMat.innerHTML = todas.map(m => `<option value="${m}">${m}</option>`).join('');
  await poblarSubtemasDominio(selMat.value);
}
async function poblarSubtemasDominio(materia) {
  const selSub = document.getElementById('domSubtema');
  if (!selSub) return;
  const tem = state.currentTemario.filter(t => t.materia === materia);
  const extras = materia ? await db.subtemas_extra.where('materia').equals(materia).toArray() : [];
  const subs = [...tem.map(t => ({ id: t.id.toString(), nombre: t.nombre })), ...extras.map(e => ({ id: 'extra_' + e.id, nombre: e.nombre }))];
  selSub.innerHTML = subs.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}
document.getElementById('domMateria').addEventListener('change', function() { poblarSubtemasDominio(this.value); });
async function buscarDominioTema(materia, subtemaId) {
  const filas = await db.dominio_temas.where('subtema_id').equals(subtemaId).toArray();
  return filas.find(f => f.materia === materia) || null;
}
async function guardarDominioTema(existente, cambios) {
  const base = existente || {};
  return await guardarLocalYOutbox('dominio_temas', 'dominio_temas', { ...base, ...cambios });
}
async function actualizarDominioHistorial() {
  const wrap = document.getElementById('dominioHistorialTable');
  if (!wrap) return;
  const filas = await db.dominio_temas.toArray();
  if (!filas.length) {
    wrap.innerHTML = '<p style="color:var(--text2);">Sin registros.</p>';
    return;
  }
  let html = '<table><tr><th>Materia</th><th>Subtema</th><th>Cond.</th><th>Intento</th><th>Inmediata</th><th>Diferida</th><th>Estado</th></tr>';
  filas.forEach(f => {
    const estado = f.dominio_alcanzado ? 'Dominado ✅' : (f.censurado ? 'Censurado ⚠️' : 'En curso');
    html += `<tr><td>${f.materia}</td><td>${f.subtema_id}</td><td>${f.condicion_origen || ''}</td><td>${f.intento_num}</td><td>${f.resultado_inmediata ?? '-'}</td><td>${f.resultado_diferida ?? '-'}</td><td>${estado}</td></tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}
document.getElementById('btnGuardarDominio').addEventListener('click', async () => {
  const materia = document.getElementById('domMateria').value;
  const subtemaId = document.getElementById('domSubtema').value;
  const condicion = document.getElementById('domCondicion').value;
  const tipoEval = document.getElementById('domTipoEval').value;
  const aciertos = parseInt(document.getElementById('domAciertos').value);
  if (!materia || !subtemaId || isNaN(aciertos)) {
    showToast('Completa materia, subtema y aciertos.');
    return;
  }
  const existente = await buscarDominioTema(materia, subtemaId);
  const hoy = hoyLocal();
  const cambios = {};
  const aprobado = aciertos >= 9;
  if (tipoEval === 'inmediata') {
    cambios.fecha_evaluacion_inmediata = hoy;
    cambios.resultado_inmediata = aciertos;
  } else {
    cambios.fecha_evaluacion_diferida = hoy;
    cambios.resultado_diferida = aciertos;
  }
  if (!aprobado) {
    const intentoActual = existente?.intento_num || 1;
    if (intentoActual >= 2) cambios.censurado = true;
    else cambios.intento_num = 2;
  } else if (tipoEval === 'diferida') {
    const inmediataAprobada = (existente?.resultado_inmediata ?? -1) >= 9;
    if (inmediataAprobada) {
      cambios.dominio_alcanzado = true;
      cambios.fecha_dominio = hoy;
    }
  }
  if (!existente) {
    cambios.materia = materia;
    cambios.subtema_id = subtemaId;
    cambios.condicion_origen = condicion;
    cambios.intento_num = cambios.intento_num || 1;
    cambios.dominio_alcanzado = cambios.dominio_alcanzado || false;
    cambios.censurado = cambios.censurado || false;
  }
  await guardarDominioTema(existente, cambios);
  showToast('Resultado guardado ✅');
  document.getElementById('domAciertos').value = 0;
  actualizarDominioHistorial();
});

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW no pudo registrarse', err));
  }
}
registerSW();