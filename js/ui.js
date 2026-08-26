import { state, State } from './config.js';
import { formatTime } from './utils.js';

// ===================== UI HELPERS =====================
export function setConfigEnabled(enabled) {
  document.getElementById('selFase').disabled = !enabled;
  document.getElementById('selModo').disabled = !enabled;
  document.getElementById('selMateria').disabled = !enabled;
  document.getElementById('selSubtema').disabled = !enabled;
  document.getElementById('selLibro').disabled = !enabled;
  document.getElementById('selCapitulo').disabled = !enabled;
}

export function updatePomoDisplay() {
  const m = Math.floor(state.session.remainingSeconds / 60), s = state.session.remainingSeconds % 60;
  const time = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  document.getElementById('pomoCircle').textContent = time;
  document.getElementById('pomoFloatTime').textContent = time;
}

export function updatePomoStatusText() {
  const el = document.getElementById('pomoStatus');
  switch (state.session.state) {
    case State.FOCUS_RUNNING: el.textContent = 'Foco'; break;
    case State.FOCUS_PAUSED: el.textContent = 'Foco (pausado)'; break;
    case State.BREAK_RUNNING: el.textContent = 'Descanso'; break;
    case State.BREAK_PAUSED: el.textContent = 'Descanso (pausado)'; break;
    case State.SESSION_ENDING: el.textContent = 'Detenido'; break;
    default: el.textContent = 'Foco';
  }
  document.getElementById('pomoCircle').classList.toggle('break', state.session.state.startsWith('BREAK'));
}

export function updatePomoButtons() {
  const st = state.session.state;
  document.getElementById('btnPomoStart').style.display = (st === State.IDLE) ? 'inline-flex' : 'none';
  document.getElementById('btnPomoPause').style.display = (st === State.FOCUS_RUNNING || st === State.BREAK_RUNNING) ? 'inline-flex' : 'none';
  document.getElementById('btnPomoResume').style.display = (st === State.FOCUS_PAUSED || st === State.BREAK_PAUSED) ? 'inline-flex' : 'none';
  document.getElementById('btnPomoStop').style.display = (st !== State.IDLE && st !== State.SESSION_ENDING) ? 'inline-flex' : 'none';
  document.getElementById('btnPomoReset').style.display = (st !== State.IDLE && st !== State.SESSION_ENDING) ? 'inline-flex' : 'none';

  const floatPause = document.getElementById('btnPomoPauseFloat');
  const isActiveSession = (st !== State.IDLE && st !== State.SESSION_ENDING);
  floatPause.style.display = isActiveSession ? '' : 'none';
  if (isActiveSession) {
    if (st === State.FOCUS_RUNNING || st === State.BREAK_RUNNING) {
      floatPause.textContent = '⏯';
    } else {
      floatPause.textContent = '▶';
    }
  }
  document.getElementById('btnPomoStopFloat').style.display = isActiveSession ? '' : 'none';
  document.getElementById('btnPomoResetFloat').style.display = isActiveSession ? '' : 'none';
}

export function stopPomoInterval() {
  if (state.session.pomoInterval) {
    clearInterval(state.session.pomoInterval);
    state.session.pomoInterval = null;
  }
}

export function stopLecturaInterval() {
  if (state.session.lecturaInterval) {
    clearInterval(state.session.lecturaInterval);
    state.session.lecturaInterval = null;
  }
  if (state.session.lecturaRunning) {
    state.session.lecturaRunning = false;
    const m = Math.floor(state.session.lecturaSeconds / 60), s = state.session.lecturaSeconds % 60;
    document.getElementById('lecturaAcumulado').textContent = `${m}:${String(s).padStart(2, '0')}`;
    document.getElementById('btnLecturaToggleFloat').innerHTML = '▶ <span id="lecturaAcumuladoFloat">0:00</span>';
  }
}

export function detenerTemporizadorCiego() {
  if (state.blindTimer.running) {
    state.blindTimer.running = false;
    clearInterval(state.blindTimer.interval);
    state.blindTimer.interval = null;
  }
  state.blindTimer.pendingResult = false;
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerLabel').textContent = 'En pausa';
  updateBlindDisplay();
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
}

export function updateBlindDisplay() {
  document.getElementById('timerDisplay').textContent = formatTime(state.blindTimer.seconds);
}
