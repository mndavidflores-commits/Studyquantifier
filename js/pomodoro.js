import { stopBlindTimerAndShowResult } from './timer.js';
import { db, state, State } from './config.js';
import { formatTime, showToast } from './utils.js';
import { guardarLocalYOutbox, corregirSesionId, syncAll } from './sync.js';
import { setConfigEnabled, updatePomoDisplay, updatePomoStatusText, updatePomoButtons, stopPomoInterval, stopLecturaInterval, detenerTemporizadorCiego, actualizarBotonModoPomodoro } from './ui.js';
import { actualizarUIPorModo, actualizarHistorialSubtema } from './repasos.js';

export async function transition(newState) {
  const prev = state.session.state;
  if (prev === newState && newState !== State.SESSION_ENDING) return;
  if (prev === State.SESSION_ENDING && newState !== State.IDLE) return;

  if (newState === State.IDLE) {
    state.session.pendingSessionEnd = false;
    stopPomoInterval(); stopLecturaInterval(); detenerTemporizadorCiego();
    state.session.tempId = null; state.session.distracciones = 0; state.session.lecturaSeconds = 0;
    state.session.elapsedTotal = 0; state.session.lecturaRunning = false;
    state.session.remainingSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
    state.session.pomodoroMode = 'countdown';
    state.session.pomoStartTime = null;
    actualizarBotonModoPomodoro();
    updatePomoDisplay();
    document.getElementById('pomoCircle').classList.remove('break');
    setConfigEnabled(true);
    document.getElementById('pomoWork').disabled = false; document.getElementById('pomoBreak').disabled = false;
    document.getElementById('btnDistraje').disabled = true;
    document.getElementById('btnLecturaStart').disabled = true; document.getElementById('btnLecturaStop').disabled = true;
    document.getElementById('lecturaAcumulado').textContent = '0:00';
    state.session.modo = null; state.errorSeleccionado = null;
    document.getElementById('topbar').classList.remove('hidden');
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('idle-view').classList.remove('hidden');
    document.getElementById('active-view').classList.remove('active');
    document.getElementById('active-view').classList.remove('cronometro-corriendo');
    document.getElementById('pomo-float').classList.add('hidden');
    document.getElementById('left-panel').classList.add('hidden');
    state.session.state = State.IDLE;
    updatePomoStatusText(); updatePomoButtons();
    return;
  }

  if (newState === State.FOCUS_RUNNING || newState === State.BREAK_RUNNING) {
    if (prev === State.IDLE) {
      const materia = document.getElementById('selMateria').value, subtema = document.getElementById('selSubtema').value;
      if (materia === '__agregar__' || subtema === '__agregar__') { showToast('Selecciona materia y subtema válidos.'); return; }
      state.session.tempId = 'temp_' + Date.now();
      state.session.distracciones = 0; state.session.lecturaSeconds = 0;
      document.getElementById('lecturaAcumulado').textContent = '0:00';
      state.session.modo = document.getElementById('selModo').value;
      await actualizarUIPorModo();
      document.getElementById('topbar').classList.add('hidden');
      document.getElementById('auth-section').classList.add('hidden');

      const idleView = document.getElementById('idle-view');
      const activeView = document.getElementById('active-view');

      idleView.classList.add('fade-out');

      setTimeout(() => {
        idleView.classList.add('hidden');
        idleView.classList.remove('fade-out');

        activeView.classList.add('active');
        void activeView.offsetWidth;
        activeView.classList.add('fade-in');
      }, 400);
      
      document.getElementById('pomo-float').classList.remove('hidden');
      document.getElementById('left-panel').classList.remove('hidden');
      document.getElementById('nombreSubtemaHistorial').textContent = document.getElementById('selSubtema').selectedOptions[0]?.textContent || '';
      await actualizarHistorialSubtema();
      setConfigEnabled(false);
      const libro = document.getElementById('selLibro').value;
      const problemasPrevios = await db.sessions
          .where('tipo').equals('problema')
          .and(p => p.subtema_id === subtema && p.libro === libro)
          .toArray();
      const maxNum = problemasPrevios.reduce((max, p) => Math.max(max, p.problema_num || 0), 0);
      document.getElementById('numProblema').value = maxNum + 1;
      state.currentProblemaNum = maxNum + 1;

      document.getElementById('pomoWork').disabled = true; document.getElementById('pomoBreak').disabled = true;
      document.getElementById('btnDistraje').disabled = false;
      document.getElementById('btnLecturaStart').disabled = false; document.getElementById('btnLecturaStop').disabled = false;
    }

    // Configurar el inicio real del temporizador
    state.session.pomoStartTime = Date.now() - state.session.elapsedTotal * 1000;
    state.session.state = newState;
    stopPomoInterval();
    state.session.pomoInterval = setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.floor((now - state.session.pomoStartTime) / 1000);
      state.session.elapsedTotal = elapsedSeconds;

      if (state.session.pomodoroMode === 'countdown') {
        const totalWorkSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
        state.session.remainingSeconds = Math.max(0, totalWorkSeconds - elapsedSeconds);
      }

      updatePomoDisplay();

      if (state.session.pomodoroMode === 'countdown' && state.session.remainingSeconds <= 0) {
        stopPomoInterval();
        if (state.session.state === State.FOCUS_RUNNING) {
          if (state.blindTimer.running) {
            stopBlindTimerAndShowResult();
            state.session.pendingSessionEnd = true;
          } else {
            transition(State.SESSION_ENDING);
          }
        } else if (state.session.state === State.BREAK_RUNNING) {
          state.session.remainingSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
          state.session.elapsedTotal = 0;
          state.session.pomoStartTime = Date.now();
          transition(State.FOCUS_RUNNING);
        }
      }
    }, 1000);
    actualizarBotonModoPomodoro();
    updatePomoStatusText(); updatePomoButtons();
    return;
  }

  if (newState === State.FOCUS_PAUSED || newState === State.BREAK_PAUSED) {
    stopPomoInterval(); stopLecturaInterval(); detenerTemporizadorCiego();
    // Al pausar no se resetea pomoStartTime; el elapsedTotal ya está actualizado
    state.session.state = newState;
    updatePomoStatusText(); updatePomoButtons();
    return;
  }

  if (newState === State.SESSION_ENDING) {
    stopPomoInterval(); stopLecturaInterval(); detenerTemporizadorCiego();
    document.getElementById('btnDistraje').disabled = true;
    document.getElementById('btnLecturaStart').disabled = true; document.getElementById('btnLecturaStop').disabled = true;
    document.getElementById('pomoWork').disabled = false; document.getElementById('pomoBreak').disabled = false;
    setConfigEnabled(false);
    state.session.state = State.SESSION_ENDING;
    updatePomoStatusText(); updatePomoButtons();
    await mostrarResumen();
    return;
  }
}

async function mostrarResumen() {
  const problemas = await db.sessions.where('tipo').equals('problema').and(s => s.sesion_id === state.session.tempId).toArray();
  const total = problemas.length, correctos = problemas.filter(p => p.resultado === 'bien').length;
  const incorrectos = problemas.filter(p => p.resultado === 'mal').length, noResueltos = problemas.filter(p => p.resultado === 'no_resuelto').length;
  const tiempoTotal = problemas.reduce((a, p) => a + (p.tiempo_s || 0), 0);
  const conjs = (await db.conjeturas.where('sesion_id').equals(state.session.tempId).toArray()).length;
  document.getElementById('resumenContenido').innerHTML = `
    Ejercicios: ${total} (✅${correctos} ❌${incorrectos} ⚪${noResueltos})<br>
    Tiempo lectura: ${Math.floor(state.session.lecturaSeconds/60)}:${String(state.session.lecturaSeconds%60).padStart(2,'0')}<br>
    Tiempo prom/problema: ${total ? formatTime(tiempoTotal/total) : '-'}<br>
    Conjeturas: ${conjs}<br>
    Distracciones: ${state.session.distracciones}
  `;
  document.getElementById('modalResumen').style.display = 'flex';
}