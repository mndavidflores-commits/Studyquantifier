import { showToast, formatTime, hoyLocal } from './utils.js';
import { db, state, State } from './config.js';
import { guardarLocalYOutbox } from './sync.js';
import { updateBlindDisplay } from './ui.js';
import { transition } from './pomodoro.js';
import { crearErrorDesdeProblema, actualizarHistorialSubtema, actualizarConjeturasSesion } from './repasos.js';

// ===================== CRONÓMETRO DE PROBLEMAS =====================
export function startBlindTimer() {
  window.pomodoroPendiente = false;
  if (state.blindTimer.running || state.blindTimer.pendingResult) return;
  if (state.session.state !== State.FOCUS_RUNNING && state.session.state !== State.BREAK_RUNNING) return;
  if (state.session.modo === 'B' && !state.errorSeleccionado) {
    showToast('Selecciona un error de la cola primero.');
    return;
  }
  state.blindTimer.running = true;
  state.blindTimer.pendingResult = false;
  document.getElementById('timerLabel').textContent = 'Estudiando...';
  state.blindTimer.startTime = Date.now() - state.blindTimer.seconds * 1000;
  document.getElementById('active-view').classList.add('cronometro-corriendo');
  state.blindTimer.interval = setInterval(() => {
    state.blindTimer.seconds = (Date.now() - state.blindTimer.startTime) / 1000;
    updateBlindDisplay();
  }, 100);
}

export function stopBlindTimerAndShowResult() {
  if (!state.blindTimer.running) return;
  state.blindTimer.running = false;
  clearInterval(state.blindTimer.interval);
  document.getElementById('timerLabel').textContent = 'Detenido';
  updateBlindDisplay();
  document.getElementById('tiempoMostrado').textContent = `${formatTime(state.blindTimer.seconds)} (${(state.blindTimer.seconds / 60).toFixed(2)} min)`;
  if (state.session.modo !== 'B') {
    state.blindTimer.previousProblemaNum = parseInt(document.getElementById('numProblema').value) || 1;
  }
  document.getElementById('cardResultado').style.display = 'block';
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
  document.getElementById('timerDisplay').style.display = 'none';
  document.getElementById('conjetura-inline').classList.add('hidden');
  document.getElementById('left-panel').classList.add('hidden');
  if (window.pomodoroPendiente) {
    window.pomodoroPendiente = false;
    const breakMinutes = parseInt(document.getElementById('pomoBreak').value) || 20;
    if (breakMinutes > 0) {
      state.session.remainingSeconds = breakMinutes * 60;
      transition(State.BREAK_RUNNING);
    } else {
      transition(State.SESSION_ENDING);
    }
  }
  state.blindTimer.pendingResult = true;
}

// ===================== EVENTOS DE TECLADO =====================
document.addEventListener('keydown', e => {
  if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (state.session.state !== State.IDLE && state.session.state !== State.SESSION_ENDING) {
      if (document.activeElement === document.body || document.activeElement?.tagName === 'BODY') {
        e.preventDefault();
        state.session.distracciones++;
        showToast('registrado ✅', 1500);
      }
    }
  }
  if (e.key === ' ' || e.code === 'Space') {
    if (document.activeElement !== document.body && document.activeElement?.tagName !== 'BODY') return;
    if (document.getElementById('modalResumen').style.display === 'flex') return;
    if (state.session.state === State.IDLE || state.session.state === State.SESSION_ENDING) return;
    if (state.blindTimer.running) {
      e.preventDefault();
      stopBlindTimerAndShowResult();
    }
  }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ' || e.code === 'Space') {
    if (document.activeElement !== document.body && document.activeElement?.tagName !== 'BODY') return;
    if (state.session.state === State.IDLE || state.session.state === State.SESSION_ENDING) return;
    if (!state.blindTimer.running && !state.blindTimer.pendingResult) {
      e.preventDefault();
      startBlindTimer();
    }
  }
});

// ===================== EVENTOS TÁCTILES =====================
const activeViewElement = document.getElementById('active-view');

activeViewElement.addEventListener('touchstart', (e) => {
  if (!state.blindTimer.running && !state.blindTimer.pendingResult) {
    activeViewElement.classList.add('touch-pressed');
  }
}, { passive: true });

activeViewElement.addEventListener('touchend', (e) => {
  activeViewElement.classList.remove('touch-pressed');
  if (state.blindTimer.running) {
    e.preventDefault();
    stopBlindTimerAndShowResult();
  } else if (!state.blindTimer.running && !state.blindTimer.pendingResult) {
    e.preventDefault();
    startBlindTimer();
  }
}, { passive: false });

activeViewElement.addEventListener('click', (e) => {
  if (state.blindTimer.running) {
    stopBlindTimerAndShowResult();
  }
});

// ===================== TOGGLE DE RESULTADO (MODO A) =====================
document.getElementById('toggleResultado').addEventListener('click', e => {
  if (!e.target.classList.contains('toggle-btn')) return;
  document.querySelectorAll('#toggleResultado .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const val = e.target.dataset.val;
  document.getElementById('divCodigoError').style.display = (val === 'mal' || val === 'no_resuelto') ? 'block' : 'none';
  document.getElementById('divConfianza').style.display = (val === 'no_resuelto') ? 'none' : 'block';
  document.getElementById('divNotaProblema').style.display = (val === 'mal' || val === 'no_resuelto') ? 'block' : 'none';
  const selError = document.getElementById('selCodigoError');
  if (val === 'mal') selError.innerHTML = '<option value="">Ninguno</option><option>EA</option><option>EC</option><option>EP</option><option>ET</option>';
  else if (val === 'no_resuelto') selError.innerHTML = '<option value="">Ninguno</option><option>ENR-I</option><option>ENR-B</option>';
});

// ===================== SIGUIENTE PROBLEMA (MODO A) =====================
document.getElementById('btnSiguienteProblema').addEventListener('click', async () => {
  const modo = document.getElementById('selModo').value;
  const fase = document.getElementById('selFase').value;
  const materia = document.getElementById('selMateria').value;
  const subtema = document.getElementById('selSubtema').value;
  const resultadoBtn = document.querySelector('#toggleResultado .toggle-btn.active');
  if (!resultadoBtn) return;
  const resultado = resultadoBtn.dataset.val;
  const codError = (resultado === 'mal' || resultado === 'no_resuelto') ? document.getElementById('selCodigoError').value : null;
  const confianza = (resultado === 'no_resuelto') ? null : parseInt(document.getElementById('selConfianza').value);
  const nota = (resultado === 'mal' || resultado === 'no_resuelto') ? document.getElementById('notaProblema').value.trim() : null;
  const subtemaNombreProblema = document.getElementById('selSubtema').selectedOptions[0]?.textContent || '';
  const idProblema = await guardarLocalYOutbox('study_sessions', 'sessions', {
    tipo: 'problema',
    fecha: hoyLocal(),
    timestamp: Date.now(),
    modo, fase, materia, subtema_id: subtema, subtema_nombre: subtemaNombreProblema,
    libro: document.getElementById('selLibro').value,
    capitulo: document.getElementById('selCapitulo').value,
    problema_num: state.blindTimer.previousProblemaNum,
    tiempo_s: Math.round(state.blindTimer.seconds * 10) / 10,
    resultado, codigo_error: codError, nota,
    dificultad_experimentada: parseInt(document.getElementById('selDifExp').value),
    confianza, intentos: parseInt(document.getElementById('numIntentos').value) || 1,
    nivel_bloom: parseInt(document.getElementById('selBloom').value),
    sesion_id: state.session.tempId
  });
  if (modo === 'A' && (resultado === 'mal' || resultado === 'no_resuelto')) {
    await crearErrorDesdeProblema({
      materia, subtemaId: subtema, subtemaNombre: subtemaNombreProblema,
      etiqueta: codError, fase, idProblema
    });
  }
  if (modo !== 'B') {
    document.getElementById('numProblema').value = state.blindTimer.previousProblemaNum + 1;
    state.currentProblemaNum = state.blindTimer.previousProblemaNum + 1;
  }
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  document.getElementById('notaProblema').value = '';
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
  document.getElementById('left-panel').classList.remove('hidden');
  document.getElementById('conjeturas-sesion-wrap').style.display = 'block';
  actualizarConjeturasSesion();
  const { actualizarMetricas } = await import('./metricas.js');
  const { actualizarTodo } = await import('./app.js'); 
  actualizarMetricas();
  actualizarTodo();
  actualizarHistorialSubtema();
});

// ===================== DESCARTAR PROBLEMA =====================
document.getElementById('btnDescartarProblema').addEventListener('click', () => {
  if (state.session.modo !== 'B') {
    document.getElementById('numProblema').value = state.blindTimer.previousProblemaNum;
    state.currentProblemaNum = state.blindTimer.previousProblemaNum;
  }
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  state.blindTimer.seconds = 0;
  updateBlindDisplay();
  state.blindTimer.pendingResult = false;
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
  document.getElementById('left-panel').classList.remove('hidden');
  actualizarHistorialSubtema();
});

// ===================== GUARDAR CONJETURA =====================
document.getElementById('btnGuardarConjetura').addEventListener('click', async () => {
  const texto = document.getElementById('textoConjetura').value.trim();
  if (!texto) return;
  const materia = document.getElementById('selMateria').value;
  const subtema = document.getElementById('selSubtema').value;
  const problemaNum = (state.blindTimer.running || state.blindTimer.pendingResult) ? state.blindTimer.previousProblemaNum : null;
  await guardarLocalYOutbox('conjeturas', 'conjeturas', {
    fecha: hoyLocal(),
    texto,
    materia: materia !== '__agregar__' ? materia : null,
    subtema_id: subtema !== '__agregar__' ? subtema : null,
    problema_num: problemaNum,
    sesion_id: state.session.tempId,
    timestamp: Date.now()
  });
  document.getElementById('textoConjetura').value = '';
  showToast('Conjetura guardada');
});