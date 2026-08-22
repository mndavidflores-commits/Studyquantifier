import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';
import { fsrs, generatorParameters, createEmptyCard, Rating, State as EstadoFSRS } from 'https://cdn.jsdelivr.net/npm/ts-fsrs@5.4.1/+esm';

const SUPABASE_URL = 'https://wrtmlucrxzewynnnikzh.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qJcUe3t_K5Yl0m7lkV3C_A_5bcdtOFs';
const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
window.supabase = supabase;

const db = new Dexie('EstudioDBv26');
window.db = db;
db.version(2).stores({
  sessions: 'id, updated_at, sesion_id, tipo, fecha, timestamp',
  conjeturas: 'id, updated_at, sesion_id, timestamp',
  sueno: 'id, updated_at, fecha',
  materias: 'id, nombre, updated_at',
  subtemas_extra: 'id, materia, nombre, updated_at',
  checklist: 'subtema_id, updated_at',
  metas: 'key, updated_at',
  outbox: '++localId, table, record_id, operation, data, created_at',
  sync_metadata: 'key'
});
db.version(3).stores({
  conjeturas: 'id, updated_at, sesion_id, timestamp, materia'
});
db.version(4).stores({
  errores: 'id, updated_at, materia, subtema_id, estado, proxima_revision',
  repasos: 'id, updated_at, error_id, fecha',
  fsrs_pesos_congelados: 'id, updated_at, materia',
  dominio_temas: 'id, updated_at, materia, subtema_id'
});
db.version(5).stores({
  temario: 'key'
});

const State = {
  IDLE: 'IDLE', FOCUS_RUNNING: 'FOCUS_RUNNING', FOCUS_PAUSED: 'FOCUS_PAUSED',
  BREAK_RUNNING: 'BREAK_RUNNING', BREAK_PAUSED: 'BREAK_PAUSED', SESSION_ENDING: 'SESSION_ENDING'
};
const session = {
  state: State.IDLE, tempId: null, modo: null, remainingSeconds: 90*60, elapsedTotal: 0,
  distracciones: 0, lecturaSeconds: 0, lecturaRunning: false, lecturaInterval: null, pomoInterval: null
};
let errorSeleccionado = null;
const blindTimer = {
  running: false, seconds: 0, interval: null, startTime: null, pendingResult: false, previousProblemaNum: 1
};
let currentProblemaNum = 1;
let sessionActual = null;
const temarioEmbebido = [
  {id:1,materia:'Álgebra',etapa:'A1',nombre:'Ecuaciones'},
  {id:2,materia:'Álgebra',etapa:'B1',nombre:'Polinomios'}
];
let currentTemario = [...temarioEmbebido];
let chartTiempo, chartRadar, chartEvolucion;

let appInitialized = false;
let erroresPendientes = [];

function actualizarUI(s) {
  sessionActual = s;
  if (s?.user) {
    document.getElementById('auth-status').textContent = `Conectado como ${s.user.email}`;
    document.getElementById('btn-login').style.display = 'none';
    document.getElementById('btn-logout').style.display = 'inline-block';
    document.getElementById('app-content').style.display = 'block';
    document.getElementById('user-email').textContent = s.user.email;
    document.getElementById('auth-section').classList.add('hidden');
    if (!appInitialized) { appInitialized = true; initApp(); }
  } else {
    appInitialized = false;
    document.getElementById('auth-status').textContent = 'No has iniciado sesión.';
    document.getElementById('btn-login').style.display = 'inline-block';
    document.getElementById('btn-logout').style.display = 'none';
    document.getElementById('app-content').style.display = 'none';
    document.getElementById('auth-section').classList.remove('hidden');
  }
}

const { data: { session: s } } = await supabase.auth.getSession();
actualizarUI(s);
supabase.auth.onAuthStateChange((event, s) => actualizarUI(s));

document.getElementById('btn-login').addEventListener('click', async () => {
  await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.href.split('#')[0] } });
});
document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabase.auth.signOut(); actualizarUI(null);
});
document.getElementById('btnLogoutTop').addEventListener('click', async () => {
  await supabase.auth.signOut(); actualizarUI(null);
});

// ===================== SINCRONIZACIÓN =====================
async function pushChanges() {
  const ops = await db.outbox.toArray();
  if (ops.length === 0) { showToast('Nada pendiente por sincronizar', 2000); return; }
  let enviados = 0, fallidos = 0;
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
    else { console.error('Error al sincronizar registro:', error); fallidos++; }
  }
  showToast(`Sincronizado: ${enviados} registros. ${fallidos ? 'Fallidos: ' + fallidos : ''}`, 3000);
}
function pkFieldFor(coleccion) {
  if (coleccion === 'checklist') return 'subtema_id';
  if (coleccion === 'metas') return 'key';
  return 'id';
}
async function pullChanges() {
  const tablas = ['study_sessions','conjeturas','sueno','materias','subtemas_extra','checklist','metas','errores','repasos','fsrs_pesos_congelados','dominio_temas'];
  for (const tabla of tablas) {
    const lastSync = await db.sync_metadata.get(`last_pull_${tabla}`);
    const lastPullTime = lastSync?.value || new Date(0).toISOString();
    const { data: nuevos } = await supabase.from(tabla).select('*').gt('updated_at', lastPullTime);
    if (nuevos?.length > 0) {
      const coleccion = tabla === 'study_sessions' ? 'sessions' : tabla;
      const activos = nuevos.filter(r => !r.deleted_at);
      const borrados = nuevos.filter(r => r.deleted_at);
      if (activos.length > 0) await db[coleccion].bulkPut(activos);
      if (borrados.length > 0) {
        const pk = pkFieldFor(coleccion);
        await db[coleccion].bulkDelete(borrados.map(r => r[pk]));
      }
    }
    await db.sync_metadata.put({ key: `last_pull_${tabla}`, value: new Date().toISOString() });
  }
}
async function syncAll() {
  if (!sessionActual?.user) return;
  await pushChanges(); await pullChanges();
}
async function guardarLocalYOutbox(tablaSupabase, coleccionDexie, datos, onConflict = 'id') {
  if (!sessionActual?.user) return null;
  const id = datos.id || crypto.randomUUID();
  const existente = datos.id ? await db[coleccionDexie].get(id) : null;
  const registro = { ...datos, id, user_id: sessionActual.user.id, created_at: existente?.created_at || datos.created_at || new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null };
  await db[coleccionDexie].put(registro);
  await db.outbox.put({ table: tablaSupabase, record_id: id, operation: 'insert', data: registro, onConflict, created_at: new Date().toISOString() });
  syncAll();  // sin await para no bloquear la UI
  return id;
}
async function corregirSesionId(tempId, idSesionReal) {
  const problemas = await db.sessions.where('sesion_id').equals(tempId).toArray();
  await db.sessions.where('sesion_id').equals(tempId).modify({ sesion_id: idSesionReal });
  for (const p of problemas) {
    await db.outbox.put({
      table: 'study_sessions', record_id: p.id, operation: 'insert',
      data: { ...p, sesion_id: idSesionReal, user_id: sessionActual.user.id, updated_at: new Date().toISOString() },
      onConflict: 'id', created_at: new Date().toISOString()
    });
  }
  const conjs = await db.conjeturas.where('sesion_id').equals(tempId).toArray();
  await db.conjeturas.where('sesion_id').equals(tempId).modify({ sesion_id: idSesionReal });
  for (const c of conjs) {
    await db.outbox.put({
      table: 'conjeturas', record_id: c.id, operation: 'insert',
      data: { ...c, sesion_id: idSesionReal, user_id: sessionActual.user.id, updated_at: new Date().toISOString() },
      onConflict: 'id', created_at: new Date().toISOString()
    });
  }
  syncAll();
}

function formatTime(sec) {
  if (isNaN(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60), d = Math.floor((sec % 1) * 10);
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${d}`;
}

// ===================== UI HELPERS =====================
function showToast(msg, d=2600) {
  const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show');
  clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),d);
}

function setConfigEnabled(enabled) {
  document.getElementById('selFase').disabled = !enabled;
  document.getElementById('selModo').disabled = !enabled;
  document.getElementById('selMateria').disabled = !enabled;
  document.getElementById('selSubtema').disabled = !enabled;
  document.getElementById('selLibro').disabled = !enabled;
  document.getElementById('selCapitulo').disabled = !enabled;
}

function updatePomoDisplay() {
  const m = Math.floor(session.remainingSeconds / 60), s = session.remainingSeconds % 60;
  const time = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  document.getElementById('pomoCircle').textContent = time;
  document.getElementById('pomoFloatTime').textContent = time;
}
function updatePomoStatusText() {
  const el = document.getElementById('pomoStatus');
  switch (session.state) {
    case State.FOCUS_RUNNING: el.textContent = 'Foco'; break;
    case State.FOCUS_PAUSED: el.textContent = 'Foco (pausado)'; break;
    case State.BREAK_RUNNING: el.textContent = 'Descanso'; break;
    case State.BREAK_PAUSED: el.textContent = 'Descanso (pausado)'; break;
    case State.SESSION_ENDING: el.textContent = 'Detenido'; break;
    default: el.textContent = 'Foco';
  }
  document.getElementById('pomoCircle').classList.toggle('break', session.state.startsWith('BREAK'));
}
function updatePomoButtons() {
  const st = session.state;
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
function stopPomoInterval() { if (session.pomoInterval) { clearInterval(session.pomoInterval); session.pomoInterval = null; } }
function stopLecturaInterval() {
  if (session.lecturaInterval) { clearInterval(session.lecturaInterval); session.lecturaInterval = null; }
  if (session.lecturaRunning) {
    session.lecturaRunning = false;
    const m = Math.floor(session.lecturaSeconds / 60), s = session.lecturaSeconds % 60;
    document.getElementById('lecturaAcumulado').textContent = `${m}:${String(s).padStart(2,'0')}`;
    document.getElementById('btnLecturaToggleFloat').innerHTML = '▶ <span id="lecturaAcumuladoFloat">0:00</span>';
  }
}
function detenerTemporizadorCiego() {
  if (blindTimer.running) { blindTimer.running = false; clearInterval(blindTimer.interval); blindTimer.interval = null; }
  blindTimer.pendingResult = false;
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerLabel').textContent = 'En pausa';
  blindTimer.seconds = 0;
  updateBlindDisplay();
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
}

function updateBlindDisplay() {
  document.getElementById('timerDisplay').textContent = formatTime(blindTimer.seconds);
}

async function transition(newState) {
  const prev = session.state;
  if (prev === newState && newState !== State.SESSION_ENDING) return;
  if (prev === State.SESSION_ENDING && newState !== State.IDLE) return;

  if (newState === State.IDLE) {
    stopPomoInterval(); stopLecturaInterval(); detenerTemporizadorCiego();
    session.tempId = null; session.distracciones = 0; session.lecturaSeconds = 0;
    session.elapsedTotal = 0; session.lecturaRunning = false;
    session.remainingSeconds = parseInt(document.getElementById('pomoWork').value)*60;
    updatePomoDisplay();
    document.getElementById('pomoCircle').classList.remove('break');
    setConfigEnabled(true);
    document.getElementById('pomoWork').disabled = false; document.getElementById('pomoBreak').disabled = false;
    document.getElementById('btnDistraje').disabled = true;
    document.getElementById('btnLecturaStart').disabled = true; document.getElementById('btnLecturaStop').disabled = true;
    document.getElementById('lecturaAcumulado').textContent = '0:00';
    session.modo = null; errorSeleccionado = null;
    document.getElementById('topbar').classList.remove('hidden');
    document.getElementById('auth-section').classList.remove('hidden');
    document.getElementById('idle-view').classList.remove('hidden');
    document.getElementById('active-view').classList.remove('active');
    document.getElementById('active-view').classList.remove('cronometro-corriendo');
    document.getElementById('pomo-float').classList.add('hidden');
    document.getElementById('left-panel').classList.add('hidden');
    session.state = State.IDLE;
    updatePomoStatusText(); updatePomoButtons();
    return;
  }

  if (newState === State.FOCUS_RUNNING || newState === State.BREAK_RUNNING) {
    if (prev === State.IDLE) {
      const materia = document.getElementById('selMateria').value, subtema = document.getElementById('selSubtema').value;
      if (materia === '__agregar__' || subtema === '__agregar__') { showToast('Selecciona materia y subtema válidos.'); return; }
      session.tempId = 'temp_' + Date.now();
      session.distracciones = 0; session.lecturaSeconds = 0;
      document.getElementById('lecturaAcumulado').textContent = '0:00';
      session.modo = document.getElementById('selModo').value;
      await actualizarUIPorModo();
      document.getElementById('topbar').classList.add('hidden');
      document.getElementById('auth-section').classList.add('hidden');
      document.getElementById('idle-view').classList.add('hidden');
      document.getElementById('active-view').classList.add('active');
      document.getElementById('pomo-float').classList.remove('hidden');
      document.getElementById('left-panel').classList.remove('hidden');
      document.getElementById('nombreSubtemaHistorial').textContent = document.getElementById('selSubtema').selectedOptions[0]?.textContent || '';
      await actualizarHistorialSubtema();
      setConfigEnabled(false);
      // Ajustar el número de problema al siguiente disponible
      const libro = document.getElementById('selLibro').value;
      const problemasPrevios = await db.sessions
          .where('tipo').equals('problema')
          .and(p => p.subtema_id === subtema && p.libro === libro)
          .toArray();
      const maxNum = problemasPrevios.reduce((max, p) => Math.max(max, p.problema_num || 0), 0);
      document.getElementById('numProblema').value = maxNum + 1;
      currentProblemaNum = maxNum + 1;
      
      document.getElementById('pomoWork').disabled = true; document.getElementById('pomoBreak').disabled = true;
      document.getElementById('btnDistraje').disabled = false;
      document.getElementById('btnLecturaStart').disabled = false; document.getElementById('btnLecturaStop').disabled = false;
    }
    session.state = newState;
    stopPomoInterval();
    session.pomoInterval = setInterval(() => {
      session.remainingSeconds--; session.elapsedTotal++; updatePomoDisplay();
      if (session.remainingSeconds <= 0) {
        stopPomoInterval();
        if (session.state === State.FOCUS_RUNNING) {
  // Ahora al terminar el foco, se abre el modal de resumen automáticamente.
  transition(State.SESSION_ENDING);
} else if (session.state === State.BREAK_RUNNING) {
  session.remainingSeconds = parseInt(document.getElementById('pomoWork').value)*60;
  transition(State.FOCUS_RUNNING);
}
      }
    }, 1000);
    updatePomoStatusText(); updatePomoButtons();
    return;
  }

  if (newState === State.FOCUS_PAUSED || newState === State.BREAK_PAUSED) {
    stopPomoInterval(); stopLecturaInterval(); detenerTemporizadorCiego();
    session.state = newState;
    updatePomoStatusText(); updatePomoButtons();
    return;
  }

  if (newState === State.SESSION_ENDING) {
    stopPomoInterval(); stopLecturaInterval(); detenerTemporizadorCiego();
    document.getElementById('btnDistraje').disabled = true;
    document.getElementById('btnLecturaStart').disabled = true; document.getElementById('btnLecturaStop').disabled = true;
    document.getElementById('pomoWork').disabled = false; document.getElementById('pomoBreak').disabled = false;
    setConfigEnabled(false);
    session.state = State.SESSION_ENDING;
    updatePomoStatusText(); updatePomoButtons();
    await mostrarResumen();
    return;
  }
}

async function mostrarResumen() {
  const problemas = await db.sessions.where('tipo').equals('problema').and(s => s.sesion_id === session.tempId).toArray();
  const total = problemas.length, correctos = problemas.filter(p => p.resultado === 'bien').length;
  const incorrectos = problemas.filter(p => p.resultado === 'mal').length, noResueltos = problemas.filter(p => p.resultado === 'no_resuelto').length;
  const tiempoTotal = problemas.reduce((a, p) => a + (p.tiempo_s || 0), 0);
  const conjs = (await db.conjeturas.where('sesion_id').equals(session.tempId).toArray()).length;
  document.getElementById('resumenContenido').innerHTML = `
    Ejercicios: ${total} (✅${correctos} ❌${incorrectos} ⚪${noResueltos})<br>
    Tiempo lectura: ${Math.floor(session.lecturaSeconds/60)}:${String(session.lecturaSeconds%60).padStart(2,'0')}<br>
    Tiempo prom/problema: ${total ? formatTime(tiempoTotal/total) : '-'}<br>
    Conjeturas: ${conjs}<br>
    Distracciones: ${session.distracciones}
  `;
  document.getElementById('modalResumen').style.display = 'flex';
}

// ===================== EVENT LISTENERS =====================
document.getElementById('btnPomoStart').addEventListener('click', () => {
  if (session.state !== State.IDLE) return;
  session.remainingSeconds = parseInt(document.getElementById('pomoWork').value) * 60;
  updatePomoDisplay(); transition(State.FOCUS_RUNNING);
});
document.getElementById('btnPomoPause').addEventListener('click', () => {
  if (session.state === State.FOCUS_RUNNING) transition(State.FOCUS_PAUSED);
  else if (session.state === State.BREAK_RUNNING) transition(State.BREAK_PAUSED);
});
document.getElementById('btnPomoResume').addEventListener('click', () => {
  if (session.state === State.FOCUS_PAUSED) transition(State.FOCUS_RUNNING);
  else if (session.state === State.BREAK_PAUSED) transition(State.BREAK_RUNNING);
});
document.getElementById('btnPomoStop').addEventListener('click', () => transition(State.SESSION_ENDING));
document.getElementById('btnPomoReset').addEventListener('click', async () => {
  if (session.state !== State.IDLE && session.elapsedTotal > 0 && !confirm('¿Reiniciar? Se perderá la sesión actual.')) return;
  if (session.tempId) { await db.sessions.where('sesion_id').equals(session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(session.tempId).delete(); }
  transition(State.IDLE);
  actualizarTodo();
});

// Float buttons
document.getElementById('btnPomoPauseFloat').addEventListener('click', () => {
  if (session.state === State.FOCUS_RUNNING || session.state === State.BREAK_RUNNING) {
    transition(session.state === State.FOCUS_RUNNING ? State.FOCUS_PAUSED : State.BREAK_PAUSED);
  } else if (session.state === State.FOCUS_PAUSED || session.state === State.BREAK_PAUSED) {
    transition(session.state === State.FOCUS_PAUSED ? State.FOCUS_RUNNING : State.BREAK_RUNNING);
  }
});
document.getElementById('btnPomoStopFloat').addEventListener('click', () => transition(State.SESSION_ENDING));
document.getElementById('btnPomoResetFloat').addEventListener('click', async () => {
  if (session.state !== State.IDLE && session.elapsedTotal > 0 && !confirm('¿Reiniciar? Se perderá la sesión actual.')) return;
  if (session.tempId) { await db.sessions.where('sesion_id').equals(session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(session.tempId).delete(); }
  transition(State.IDLE);
  actualizarTodo();
});

document.getElementById('btnGuardarResumen').addEventListener('click', async () => {
  const frustracion = parseInt(document.getElementById('resumenFrustracion').value) || 0;
  const energia = parseInt(document.getElementById('resumenEnergia').value) || 3;
  const problemas = await db.sessions.where('tipo').equals('problema').and(s => s.sesion_id === session.tempId).toArray();
  const total = problemas.length, tiempoTotal = problemas.reduce((a, p) => a + (p.tiempo_s || 0), 0);
  const conjs = (await db.conjeturas.where('sesion_id').equals(session.tempId).toArray()).length;
  const idSesion = await guardarLocalYOutbox('study_sessions', 'sessions', {
    tipo: 'pomodoro', fecha: new Date().toISOString().split('T')[0], timestamp: Date.now(),
    modo: document.getElementById('selModo').value, fase: document.getElementById('selFase').value,
    materia: document.getElementById('selMateria').value, subtema_id: document.getElementById('selSubtema').value, libro: document.getElementById('selLibro').value,capitulo: document.getElementById('selCapitulo').value,
    
    subtema_nombre: document.getElementById('selSubtema').selectedOptions[0]?.textContent || '',
    tiempo_pomodoro: session.elapsedTotal, tiempo_lectura: session.lecturaSeconds, frustracion, energia,
    resumen_ejercicios: total, resumen_correctos: problemas.filter(p=>p.resultado==='bien').length,
    resumen_incorrectos: problemas.filter(p=>p.resultado==='mal').length, resumen_no_resueltos: problemas.filter(p=>p.resultado==='no_resuelto').length,
    resumen_lectura: session.lecturaSeconds, resumen_tiempo_promedio: total ? tiempoTotal/total : 0,
    resumen_conjeturas: conjs, resumen_distracciones: session.distracciones,
    pomodoro_label: 'pomodoro_' + Date.now()
  });
  if (idSesion) { await corregirSesionId(session.tempId, idSesion); }
  document.getElementById('modalResumen').style.display = 'none';
  transition(State.IDLE);
  actualizarTodo();
});
document.getElementById('btnCancelarResumen').addEventListener('click', async () => {
  if (session.tempId) { await db.sessions.where('sesion_id').equals(session.tempId).delete(); await db.conjeturas.where('sesion_id').equals(session.tempId).delete(); }
  document.getElementById('modalResumen').style.display = 'none';
  transition(State.IDLE);
  actualizarTodo();
});

document.getElementById('btnDistraje').addEventListener('click', () => {
  if (session.state !== State.FOCUS_RUNNING && session.state !== State.BREAK_RUNNING) return;
  session.distracciones++; showToast('registrado ✅', 1500);
});
document.getElementById('btnDistrajeFloat').addEventListener('click', () => {
  if (session.state !== State.FOCUS_RUNNING && session.state !== State.BREAK_RUNNING) return;
  session.distracciones++; showToast('registrado ✅', 1500);
});

// Lectura toggle
function toggleLectura() {
  if (!session.lecturaRunning) {
    if (session.state !== State.FOCUS_RUNNING && session.state !== State.BREAK_RUNNING) return;
    session.lecturaRunning = true;
    const start = Date.now() - session.lecturaSeconds * 1000;
    session.lecturaInterval = setInterval(() => {
      session.lecturaSeconds = Math.round((Date.now() - start) / 1000);
      const m = Math.floor(session.lecturaSeconds / 60);
      const s = session.lecturaSeconds % 60;
      const display = `${m}:${String(s).padStart(2, '0')}`;
      document.getElementById('lecturaAcumulado').textContent = display;
      document.getElementById('lecturaAcumuladoFloat').textContent = display;
      document.getElementById('btnLecturaToggleFloat').innerHTML = '⏹ <span id="lecturaAcumuladoFloat">' + display + '</span>';
    }, 1000);
    document.getElementById('btnLecturaToggleFloat').innerHTML = '⏹ <span id="lecturaAcumuladoFloat">0:00</span>';
  } else {
    stopLecturaInterval();
    document.getElementById('btnLecturaToggleFloat').innerHTML = '▶ <span id="lecturaAcumuladoFloat">0:00</span>';
  }
}
document.getElementById('btnLecturaStart').addEventListener('click', () => { if (!session.lecturaRunning) toggleLectura(); });
document.getElementById('btnLecturaStop').addEventListener('click', () => { if (session.lecturaRunning) stopLecturaInterval(); });
document.getElementById('btnLecturaToggleFloat').addEventListener('click', toggleLectura);

// ===================== CRONÓMETRO DE PROBLEMAS =====================
function startBlindTimer() {
  window.pomodoroPendiente = false;
  if (blindTimer.running || blindTimer.pendingResult) return;
  if (session.state !== State.FOCUS_RUNNING && session.state !== State.BREAK_RUNNING) return;
  if (session.modo === 'B' && !errorSeleccionado) { showToast('Selecciona un error de la cola primero.'); return; }
  blindTimer.running = true; blindTimer.pendingResult = false;
  document.getElementById('timerLabel').textContent = 'Estudiando...';
  blindTimer.startTime = Date.now() - blindTimer.seconds * 1000;
  document.getElementById('active-view').classList.add('cronometro-corriendo');
  blindTimer.interval = setInterval(() => { blindTimer.seconds = (Date.now() - blindTimer.startTime) / 1000; updateBlindDisplay(); }, 100);
}

function stopBlindTimerAndShowResult() {
  if (!blindTimer.running) return;
  blindTimer.running = false; clearInterval(blindTimer.interval);
  document.getElementById('timerLabel').textContent = 'Detenido';
  updateBlindDisplay();
  document.getElementById('tiempoMostrado').textContent = `${formatTime(blindTimer.seconds)} (${(blindTimer.seconds/60).toFixed(2)} min)`;
  if (session.modo !== 'B') {
    blindTimer.previousProblemaNum = parseInt(document.getElementById('numProblema').value) || 1;
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
      session.remainingSeconds = breakMinutes * 60;
      transition(State.BREAK_RUNNING);
    } else {
      transition(State.SESSION_ENDING);
    }
  }
  blindTimer.pendingResult = true;
}

// Keyboard controls
document.addEventListener('keydown', e => {
  if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    if (session.state !== State.IDLE && session.state !== State.SESSION_ENDING) {
      if (document.activeElement === document.body || document.activeElement?.tagName === 'BODY') {
        e.preventDefault();
        session.distracciones++;
        showToast('registrado ✅', 1500);
      }
    }
  }
  if (e.key === ' ' || e.code === 'Space') {
    if (document.activeElement !== document.body && document.activeElement?.tagName !== 'BODY') return;
    if (document.getElementById('modalResumen').style.display === 'flex') return;
    if (session.state === State.IDLE || session.state === State.SESSION_ENDING) return;
    if (blindTimer.running) {
      e.preventDefault();
      stopBlindTimerAndShowResult();
    }
  }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ' || e.code === 'Space') {
    if (document.activeElement !== document.body && document.activeElement?.tagName !== 'BODY') return;
    if (session.state === State.IDLE || session.state === State.SESSION_ENDING) return;
    if (!blindTimer.running && !blindTimer.pendingResult) {
      e.preventDefault();
      startBlindTimer();
    }
  }
});

// --- Eventos táctiles para móvil ---
const activeViewElement = document.getElementById('active-view');

activeViewElement.addEventListener('touchstart', (e) => {
  // Indicación visual opcional: añadir una clase para feedback
  if (!blindTimer.running && !blindTimer.pendingResult) {
    activeViewElement.classList.add('touch-pressed');
  }
}, { passive: true });

activeViewElement.addEventListener('touchend', (e) => {
  activeViewElement.classList.remove('touch-pressed');
  
  // Si el timer está corriendo, un toque lo detiene
  if (blindTimer.running) {
    e.preventDefault();
    stopBlindTimerAndShowResult();
  }
  // Si no está corriendo y no hay resultado pendiente, el toque inicia
  else if (!blindTimer.running && !blindTimer.pendingResult) {
    e.preventDefault();
    startBlindTimer();
  }
}, { passive: false });

// Para PC: clic también detiene si está corriendo
activeViewElement.addEventListener('click', (e) => {
  if (blindTimer.running) {
    stopBlindTimerAndShowResult();
  }
});

// Toggle resultado
document.getElementById('toggleResultado').addEventListener('click', e => {
  if (!e.target.classList.contains('toggle-btn')) return;
  document.querySelectorAll('#toggleResultado .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
  const val = e.target.dataset.val;
  document.getElementById('divCodigoError').style.display = (val === 'mal' || val === 'no_resuelto') ? 'block' : 'none';
  document.getElementById('divConfianza').style.display = (val === 'no_resuelto') ? 'none' : 'block';
  const selError = document.getElementById('selCodigoError');
  if (val === 'mal') selError.innerHTML = '<option value="">Ninguno</option><option>EA</option><option>EC</option><option>EP</option><option>ET</option>';
  else if (val === 'no_resuelto') selError.innerHTML = '<option value="">Ninguno</option><option>ENR-I</option><option>ENR-B</option>';
});

// Siguiente problema
document.getElementById('btnSiguienteProblema').addEventListener('click', async () => {
  const modo = document.getElementById('selModo').value, fase = document.getElementById('selFase').value;
  const materia = document.getElementById('selMateria').value, subtema = document.getElementById('selSubtema').value;
  const resultadoBtn = document.querySelector('#toggleResultado .toggle-btn.active');
  if (!resultadoBtn) return;
  const resultado = resultadoBtn.dataset.val;
  const codError = (resultado === 'mal' || resultado === 'no_resuelto') ? document.getElementById('selCodigoError').value : null;
  const confianza = (resultado === 'no_resuelto') ? null : parseInt(document.getElementById('selConfianza').value);
  const subtemaNombreProblema = document.getElementById('selSubtema').selectedOptions[0]?.textContent || '';
  const idProblema = await guardarLocalYOutbox('study_sessions', 'sessions', {
    tipo: 'problema', fecha: new Date().toISOString().split('T')[0], timestamp: Date.now(),
    modo, fase, materia, subtema_id: subtema, subtema_nombre: subtemaNombreProblema, libro: document.getElementById('selLibro').value,capitulo: document.getElementById('selCapitulo').value,
    
    problema_num: blindTimer.previousProblemaNum, tiempo_s: Math.round(blindTimer.seconds * 10) / 10,
    resultado, codigo_error: codError, dificultad_experimentada: parseInt(document.getElementById('selDifExp').value),
    confianza, intentos: parseInt(document.getElementById('numIntentos').value) || 1,
    nivel_bloom: parseInt(document.getElementById('selBloom').value), sesion_id: session.tempId
  });
  if (modo === 'A' && (resultado === 'mal' || resultado === 'no_resuelto')) {
    await crearErrorDesdeProblema({ materia, subtemaId: subtema, subtemaNombre: subtemaNombreProblema, etiqueta: codError, fase, idProblema });
  }
  if (modo !== 'B') {
    document.getElementById('numProblema').value = blindTimer.previousProblemaNum + 1;
    currentProblemaNum = blindTimer.previousProblemaNum + 1;
  }
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  blindTimer.seconds = 0; updateBlindDisplay(); blindTimer.pendingResult = false;
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
  document.getElementById('left-panel').classList.remove('hidden');
  document.getElementById('conjeturas-sesion-wrap').style.display = 'block';
  actualizarConjeturasSesion();
  actualizarMetricas(); actualizarTodo();
  actualizarHistorialSubtema();
});

document.getElementById('btnDescartarProblema').addEventListener('click', () => {
  if (session.modo !== 'B') {
    document.getElementById('numProblema').value = blindTimer.previousProblemaNum;
    currentProblemaNum = blindTimer.previousProblemaNum;
  }
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  blindTimer.seconds = 0; updateBlindDisplay(); blindTimer.pendingResult = false;
  document.getElementById('active-view').classList.remove('cronometro-corriendo');
  document.getElementById('left-panel').classList.remove('hidden');
});

// Conjetura inline
document.getElementById('btnGuardarConjetura').addEventListener('click', async () => {
  const texto = document.getElementById('textoConjetura').value.trim(); if (!texto) return;
  const materia = document.getElementById('selMateria').value, subtema = document.getElementById('selSubtema').value;
  const problemaNum = (blindTimer.running || blindTimer.pendingResult) ? blindTimer.previousProblemaNum : null;
  await guardarLocalYOutbox('conjeturas', 'conjeturas', {
    fecha: new Date().toISOString().split('T')[0], texto, materia: materia !== '__agregar__' ? materia : null,
    subtema_id: subtema !== '__agregar__' ? subtema : null, problema_num: problemaNum, sesion_id: session.tempId, timestamp: Date.now()
  });
  document.getElementById('textoConjetura').value = '';
  showToast('Conjetura guardada');
});

// ===================== ACTUALIZACIONES DE UI =====================
async function actualizarHistorial() {
  const container = document.getElementById('historialContainer');
  const allSessions = await db.sessions.orderBy('timestamp').reverse().toArray();
  const grouped = {};
  allSessions.forEach(s => { const fecha = s.fecha || new Date(s.timestamp).toISOString().split('T')[0]; if (!grouped[fecha]) grouped[fecha] = []; grouped[fecha].push(s); });
  let html = '';
  const sortedDates = Object.keys(grouped).sort((a,b)=>b.localeCompare(a));
  for (const fecha of sortedDates) {
    html += `<div class="history-date">${fecha}</div>`;
    const pomos = grouped[fecha].filter(s => s.tipo === 'pomodoro');
    for (const pomo of pomos) {
      const problemas = allSessions.filter(s => s.sesion_id === pomo.id && s.tipo === 'problema');
      const conjs = (await db.conjeturas.where('sesion_id').equals(pomo.id).toArray()).length;
      const duracion = pomo.tiempo_pomodoro || 1;
      html += `<div class="pomo-row" data-pomoid="${pomo.id}">
        <div style="display:flex; justify-content:space-between;"><strong>${pomo.pomodoro_label || 'pomodoro_'+pomo.id}</strong><span>${formatTime(duracion)} | ${pomo.materia||'sin materia'} | ${pomo.modo||''} | Ej:${problemas.length}</span></div>
        <div class="pomo-details">
          <p>Fase: ${pomo.fase||'-'} | Modo: ${pomo.modo||'-'} | Materia: ${pomo.materia||'-'} | Subtema: ${pomo.subtema_nombre||pomo.subtema_id||'-'}</p>
          <p>Ejercicios: ${problemas.length} (${problemas.filter(p=>p.resultado==='bien').length} bien, ${problemas.filter(p=>p.resultado==='mal').length} mal, ${problemas.filter(p=>p.resultado==='no_resuelto').length} no resuelto)</p>
          <p>Conjeturas: ${conjs} | Ej/min: ${(problemas.length/(duracion/60)).toFixed(1)} | Conj/min: ${(conjs/(duracion/60)).toFixed(1)} | Lectura: ${Math.floor(pomo.tiempo_lectura/60)}:${String(pomo.tiempo_lectura%60).padStart(2,'0')}</p>
          <table><tr><th>#</th><th>Resultado</th><th>Tiempo</th><th>Error</th></tr>${problemas.map(p=>`<tr><td>${p.problema_num}</td><td>${p.resultado}</td><td>${formatTime(p.tiempo_s)}</td><td>${p.codigo_error||''}</td></tr>`).join('')}</table>
        </div>
      </div>`;
    }
  }
  container.innerHTML = html;
  const lastPomo = container.querySelector('.pomo-row:last-child');
  if(lastPomo) lastPomo.classList.add('expanded');
  container.onclick = (e) => { const row = e.target.closest('.pomo-row'); if(row) row.classList.toggle('expanded'); };
}

async function actualizarConjeturasSesion() {
  const conjs = await db.conjeturas.orderBy('timestamp').reverse().limit(20).toArray();
  const wrap = document.getElementById('listaConjeturasSesion');
  if (!conjs.length) { wrap.innerHTML = 'Sin conjeturas.'; return; }
  let html = '<table><tr><th>Conjetura</th><th>Materia</th><th>Ejercicio</th><th>Subtema</th><th>Fecha</th></tr>';
  conjs.forEach(c => { const d = new Date(c.timestamp); html += `<tr><td>${c.texto}</td><td>${c.materia||''}</td><td>${c.problema_num||''}</td><td>${c.subtema_id||''}</td><td>${d.toLocaleTimeString()}</td></tr>`; });
  html += '</table>'; wrap.innerHTML = html;
}

async function actualizarConjeturasFull() {
  const conjs = await db.conjeturas.orderBy('timestamp').reverse().toArray();
  const wrap = document.getElementById('listaConjeturasFull');
  if (!conjs.length) { wrap.innerHTML = 'Sin conjeturas.'; return; }
  let html = '<table><tr><th>Conjetura</th><th>Materia</th><th>Ejercicio</th><th>Subtema</th><th>Fecha</th></tr>';
  conjs.forEach(c => { const d = new Date(c.timestamp); html += `<tr><td>${c.texto}</td><td>${c.materia||''}</td><td>${c.problema_num||''}</td><td>${c.subtema_id||''}</td><td>${d.toLocaleString()}</td></tr>`; });
  html += '</table>'; wrap.innerHTML = html;
}

// ===================== HISTORIAL DEL SUBTEMA (panel izquierdo) =====================
async function actualizarHistorialSubtema() {
  const subtemaId = document.getElementById('selSubtema').value;
  if (!subtemaId || subtemaId === '__agregar__') return;
  const problemas = await db.sessions.where('tipo').equals('problema').and(p => p.subtema_id === subtemaId).toArray();
  problemas.sort((a,b) => (b.problema_num||0) - (a.problema_num||0) || new Date(b.timestamp) - new Date(a.timestamp));
  const wrap = document.getElementById('historialSubtemaTableWrap');
  let html = '<table><tr><th>#</th><th>Tiempo</th><th>Resultado</th></tr>';
  problemas.forEach(p => {
    const res = p.resultado === 'bien' ? 'B' : (p.resultado === 'mal' ? 'M' : 'NR');
    const badgeClass = `result-${p.resultado === 'bien' ? 'b' : (p.resultado === 'mal' ? 'm' : 'nr')}`;
    html += `<tr data-sesionid="${p.id}">
      <td>${p.problema_num||'-'}</td>
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
        await db.outbox.put({ table: 'study_sessions', record_id: sid, operation: 'delete', data: { id: sid, user_id: sessionActual.user.id, deleted_at: new Date().toISOString() }, onConflict: 'id', created_at: new Date().toISOString() });
        await syncAll();
        document.getElementById('modalDetalleProblema').style.display = 'none';
        actualizarHistorialSubtema();
        actualizarTodo();
      };
    });
  });
}
document.getElementById('btnCerrarDetalle').addEventListener('click', () => {
  document.getElementById('modalDetalleProblema').style.display = 'none';
});

// ===================== MODO B: SELECTOR DE ERRORES =====================
document.getElementById('selProblemaPendiente').addEventListener('change', function() {
  const errorId = this.value;
  errorSeleccionado = erroresPendientes.find(e => e.id === errorId) || null;
});

async function mostrarColaErrores() {
  const materia = document.getElementById('selMateria').value;
  const subtema = document.getElementById('selSubtema').value;
  const finDeHoy = new Date(); finDeHoy.setHours(23, 59, 59, 999);
  const errores = (await db.errores.where('estado').equals('activo').toArray())
    .filter(e => e.materia === materia && e.subtema_id === subtema && new Date(e.proxima_revision) <= finDeHoy)
    .sort((a, b) => new Date(a.proxima_revision) - new Date(b.proxima_revision));
  
  erroresPendientes = errores;
  const select = document.getElementById('selProblemaPendiente');
  select.innerHTML = '';
  if (errores.length === 0) {
    select.innerHTML = '<option value="">Sin errores pendientes</option>';
    errorSeleccionado = null;
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
    errorSeleccionado = errores[0];
  }
}

async function actualizarUIPorModo() {
  const esModoB = session.modo === 'B';
  document.getElementById('input-num-problema').style.display = esModoB ? 'none' : 'block';
  document.getElementById('sel-problema-pendiente').style.display = esModoB ? 'block' : 'none';
  document.getElementById('formResultadoA').style.display = esModoB ? 'none' : 'block';
  document.getElementById('formResultadoB').style.display = esModoB ? 'block' : 'none';
  if (esModoB) await mostrarColaErrores();
}

// ===================== FSRS Y DOMINIO =====================
function crearInstanciaFSRS(pesos) {
  return fsrs(generatorParameters({
    request_retention: 0.9,
    enable_short_term: false,
    w: pesos
  }));
}
async function getPesosCongelados(materia) {
  let fila = (await db.fsrs_pesos_congelados.where('materia').equals(materia).toArray())[0];
  if (!fila) {
    const id = await guardarLocalYOutbox('fsrs_pesos_congelados', 'fsrs_pesos_congelados', {
      materia, pesos_json: generatorParameters().w, fecha_congelado: new Date().toISOString()
    });
    fila = await db.fsrs_pesos_congelados.get(id);
  }
  return fila.pesos_json;
}
function reconstruirCardDesdeError(error, ultimaRevision) {
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
async function crearErrorDesdeProblema({ materia, subtemaId, subtemaNombre, etiqueta, fase, idProblema }) {
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
document.getElementById('toggleCalificacion').addEventListener('click', e => {
  if (!e.target.classList.contains('toggle-btn')) return;
  document.querySelectorAll('#toggleCalificacion .toggle-btn').forEach(b => b.classList.remove('active'));
  e.target.classList.add('active');
});
document.getElementById('btnGuardarRepaso').addEventListener('click', async () => {
  if (!errorSeleccionado) return;
  const calBtn = document.querySelector('#toggleCalificacion .toggle-btn.active');
  if (!calBtn) { showToast('Selecciona una calificación.'); return; }
  const calificacion = parseInt(calBtn.dataset.val);
  const consultoSolucion = document.getElementById('chkConsultoSolucion').checked;
  const materia = document.getElementById('selMateria').value, subtema = document.getElementById('selSubtema').value;
  const subtemaNombre = document.getElementById('selSubtema').selectedOptions[0]?.textContent || '';
  const pesos = await getPesosCongelados(materia);
  const f = crearInstanciaFSRS(pesos);
  const ultimaRevision = await obtenerUltimaRevision(errorSeleccionado.id, errorSeleccionado.fecha_creacion);
  const cardReconstruida = reconstruirCardDesdeError(errorSeleccionado, ultimaRevision);
  const ahora = new Date();
  const resultado = f.next(cardReconstruida, ahora, calificacion);
  await guardarLocalYOutbox('repasos', 'repasos', {
    error_id: errorSeleccionado.id, fecha: ahora.toISOString(), calificacion,
    intervalo_dias_asignado: resultado.log.scheduled_days,
    dias_desde_repaso_anterior: resultado.log.elapsed_days,
    tiempo_recall_s: Math.round(blindTimer.seconds * 10) / 10,
    consulto_solucion: consultoSolucion
  });
  await actualizarErrorParcial(errorSeleccionado.id, {
    fsrs_estabilidad: resultado.card.stability,
    fsrs_dificultad: resultado.card.difficulty,
    fsrs_reps: resultado.card.reps,
    proxima_revision: resultado.card.due.toISOString()
  });
  await guardarLocalYOutbox('study_sessions', 'sessions', {
    tipo: 'problema', fecha: new Date().toISOString().split('T')[0], timestamp: Date.now(),
    modo: 'B', fase: document.getElementById('selFase').value, materia, subtema_id: subtema, subtema_nombre: subtemaNombre, libro: document.getElementById('selLibro').value,capitulo: document.getElementById('selCapitulo').value,
    tiempo_s: Math.round(blindTimer.seconds * 10) / 10,
    resultado: calificacion >= 3 ? 'bien' : 'mal',
    sesion_id: session.tempId
  });
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  blindTimer.seconds = 0; updateBlindDisplay(); blindTimer.pendingResult = false;
  document.querySelectorAll('#toggleCalificacion .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chkConsultoSolucion').checked = false;
  errorSeleccionado = null;
  await mostrarColaErrores();
  actualizarMetricas(); actualizarTodo();
  actualizarHistorialSubtema();
  document.getElementById('conjeturas-sesion-wrap').style.display = 'block';
  document.getElementById('left-panel').classList.remove('hidden');
  actualizarConjeturasSesion();
});
document.getElementById('btnDescartarRepaso').addEventListener('click', () => {
  document.getElementById('cardResultado').style.display = 'none';
  document.getElementById('timerDisplay').style.display = 'block';
  document.getElementById('conjetura-inline').classList.remove('hidden');
  blindTimer.seconds = 0; updateBlindDisplay(); blindTimer.pendingResult = false;
  document.querySelectorAll('#toggleCalificacion .toggle-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('chkConsultoSolucion').checked = false;
  document.getElementById('left-panel').classList.remove('hidden');
});

// ===================== DOMINIO =====================
async function poblarSelectoresDominio() {
  const selMat = document.getElementById('domMateria');
  if (!selMat) return;
  const matsTem = [...new Set(currentTemario.map(t => t.materia))];
  const matsDB = await db.materias.toArray();
  const todas = [...new Set([...matsTem, ...matsDB.map(m => m.nombre)])];
  selMat.innerHTML = todas.map(m => `<option value="${m}">${m}</option>`).join('');
  await poblarSubtemasDominio(selMat.value);
}
async function poblarSubtemasDominio(materia) {
  const selSub = document.getElementById('domSubtema');
  if (!selSub) return;
  const tem = currentTemario.filter(t => t.materia === materia);
  const extras = materia ? await db.subtemas_extra.where('materia').equals(materia).toArray() : [];
  const subs = [...tem.map(t => ({ id: t.id.toString(), nombre: t.nombre })), ...extras.map(e => ({ id: 'extra_' + e.id, nombre: e.nombre }))];
  selSub.innerHTML = subs.map(s => `<option value="${s.id}">${s.nombre}</option>`).join('');
}
document.getElementById('domMateria').addEventListener('change', function () { poblarSubtemasDominio(this.value); });
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
  if (!filas.length) { wrap.innerHTML = '<p style="color:var(--text2);">Sin registros.</p>'; return; }
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
  if (!materia || !subtemaId || isNaN(aciertos)) { showToast('Completa materia, subtema y aciertos.'); return; }
  const existente = await buscarDominioTema(materia, subtemaId);
  const hoy = new Date().toISOString().split('T')[0];
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

// ===================== MÉTRICAS Y GRÁFICOS =====================
async function actualizarMetricas() {
  const problemas = await db.sessions.where('tipo').equals('problema').toArray();
  const bien = problemas.filter(s => s.resultado === 'bien').length, mal = problemas.filter(s => s.resultado === 'mal').length;
  const total = problemas.length, tiempoTotal = problemas.reduce((a, s) => a + (s.tiempo_s || 0), 0);
  const conjeturasTotal = await db.conjeturas.count();
  const conjPorMin = tiempoTotal ? (conjeturasTotal / (tiempoTotal / 60)).toFixed(2) : '0';
  const mg = document.getElementById('metricasGenerales');
  if (mg) mg.innerHTML = `
      <span>Tasa aciertos: ${bien+mal>0?Math.round(bien/(bien+mal)*100):0}%</span>
      <span>Tiempo prom: ${total?formatTime(tiempoTotal/total):'-'}</span>
      <span>Conjeturas/min: ${conjPorMin}</span>
      <span>Total: ${total}</span>
    `;

  if (chartTiempo) chartTiempo.destroy();
  const ctxBar = document.getElementById('chartTiempoMateria')?.getContext('2d');
  if (ctxBar) {
    const mats = {};
    problemas.forEach(s => { if (!mats[s.materia]) mats[s.materia] = { total:0, count:0 }; mats[s.materia].total += (s.tiempo_s||0); mats[s.materia].count++; });
    const labels = Object.keys(mats);
    const data = labels.map(m => mats[m].count ? Math.round(mats[m].total/mats[m].count) : 0);
    chartTiempo = new Chart(ctxBar, { type: 'bar', data: { labels, datasets: [{ label: 'Tiempo prom (s)', data, backgroundColor: 'rgba(92,124,250,0.6)' }] }, options: { responsive: true, scales: { y: { beginAtZero: true } } } });
  }
  if (chartRadar) chartRadar.destroy();
  const ctxRadar = document.getElementById('chartRadar')?.getContext('2d');
  if (ctxRadar) {
    const velocidad = total ? Math.min(100, Math.round((total/(tiempoTotal/60))*10)) : 0;
    const precision = bien+mal>0 ? Math.round(bien/(bien+mal)*100) : 0;
    const retencion = problemas.filter(s=>s.modo==='B' && s.resultado==='bien').length / (problemas.filter(s=>s.modo==='B').length||1)*100;
    const consolidacion = total ? problemas.filter(s=>s.modo==='B').length/total*100 : 0;
    const generacionC = total ? problemas.filter(s=>s.modo==='C').length/total*100 : 0;
    chartRadar = new Chart(ctxRadar, { type: 'radar', data: { labels: ['Velocidad','Precisión','Retención','Consolidación','Generación C'], datasets: [{ data: [velocidad,precision,retencion,consolidacion,generacionC], backgroundColor: 'rgba(92,124,250,0.2)' }] }, options: { scales: { r: { beginAtZero: true, max: 100 } } } });
  }
  if (chartEvolucion) chartEvolucion.destroy();
  const ctxLine = document.getElementById('chartEvolucion')?.getContext('2d');
  if (ctxLine) {
    const dias = {};
    problemas.forEach(s => { const dia = s.fecha || new Date(s.timestamp).toISOString().split('T')[0]; if (!dias[dia]) dias[dia] = { bien:0, mal:0 }; if (s.resultado === 'bien') dias[dia].bien++; else if (s.resultado === 'mal') dias[dia].mal++; });
    const sorted = Object.keys(dias).sort();
    const labels = sorted;
    const data = sorted.map(d => { const b = dias[d].bien, m = dias[d].mal; return b+m>0 ? Math.round(b/(b+m)*100) : null; });
    chartEvolucion = new Chart(ctxLine, { type: 'line', data: { labels, datasets: [{ label: 'Tasa aciertos %', data, borderColor: '#3dd6c8' }] }, options: { responsive: true } });
  }
}

async function actualizarProgreso() {
  const wrap = document.getElementById('progresoTemaTableWrap');
  const problemas = await db.sessions.where('tipo').equals('problema').toArray();
  const agg = {};
  problemas.forEach(s => { const k = s.materia+'|||'+s.subtema_id; if(!agg[k]) agg[k] = {materia:s.materia, subtema:s.subtema_nombre||s.subtema_id, intentos:0, bien:0}; agg[k].intentos++; if(s.resultado==='bien') agg[k].bien++; });
  let html = '<table><tr><th>Materia</th><th>Subtema</th><th>Intentos</th><th>Aciertos</th></tr>';
  Object.values(agg).forEach(r => html+=`<tr><td>${r.materia}</td><td>${r.subtema}</td><td>${r.intentos}</td><td>${r.intentos?Math.round(r.bien/r.intentos*100):0}%</td></tr>`);
  html+='</table>'; wrap.innerHTML=html;
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
  const registros = await db.sueno.orderBy('fecha').reverse().toArray();
  if (!registros.length) { wrap.innerHTML = '<p style="color:var(--text2);">Sin registros de sueño.</p>'; return; }
  function formato12h(hora24) {
    if (!hora24) return '-';
    const [h, m] = hora24.split(':').map(Number);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
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
      await db.outbox.put({ table: 'sueno', record_id: id, operation: 'delete', data: { id, user_id: sessionActual.user.id, deleted_at: new Date().toISOString() }, onConflict: 'id', created_at: new Date().toISOString() });
      showToast('Sueño eliminado ✅');
      await syncAll();
      actualizarSleepHistorial();
      actualizarGraficoSueno();
    });
  });
}

let chartSuenoInst = null;
async function actualizarGraficoSueno() {
  const ctx = document.getElementById('chartSueno')?.getContext('2d');
  if (!ctx) return;
  if (chartSuenoInst) chartSuenoInst.destroy();
  const registros = await db.sueno.orderBy('fecha').toArray();
  if (registros.length === 0) return;
  const labels = registros.map(r => r.fecha);
  const calidadData = registros.map(r => r.calidad);
  const acostarMin = registros.map(r => {
    if (!r.acostar) return null;
    const [h, m] = r.acostar.split(':').map(Number);
    return h * 60 + m;
  });
  const despertarMin = registros.map(r => {
    if (!r.despertar) return null;
    const [h, m] = r.despertar.split(':').map(Number);
    return h * 60 + m;
  });
  chartSuenoInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Calidad (0-10)', data: calidadData, borderColor: '#5c7cfa', backgroundColor: 'transparent', yAxisID: 'y', tension: 0.3, pointRadius: 4 },
        { label: 'Hora acostarse', data: acostarMin, borderColor: '#ffb347', backgroundColor: 'transparent', yAxisID: 'y1', tension: 0.3, pointRadius: 4 },
        { label: 'Hora despertar', data: despertarMin, borderColor: '#3dd6c8', backgroundColor: 'transparent', yAxisID: 'y1', tension: 0.3, pointRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: { type: 'linear', display: true, position: 'left', min: 0, max: 10, title: { display: true, text: 'Calidad (0-10)' } },
        y1: {
          type: 'linear', display: true, position: 'right', min: 0, max: 1440, title: { display: true, text: 'Minutos desde medianoche' },
          ticks: {
            stepSize: 60,
            callback: function(value) {
              const totalMin = value;
              const h24 = Math.floor(totalMin / 60);
              const m = totalMin % 60;
              const ampm = h24 >= 12 ? 'PM' : 'AM';
              let h12 = h24 % 12;
              if (h12 === 0) h12 = 12;
              return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
            }
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.dataset.yAxisID === 'y1') {
                const mins = context.parsed.y;
                const h24 = Math.floor(mins / 60);
                const m = mins % 60;
                const ampm = h24 >= 12 ? 'PM' : 'AM';
                let h12 = h24 % 12;
                if (h12 === 0) h12 = 12;
                label += `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
              } else {
                label += context.parsed.y;
              }
              return label;
            }
          }
        }
      }
    }
  });
}

async function actualizarMetas() {
  const hoy = new Date().toISOString().split('T')[0];
  const sessionsHoy = await db.sessions.where('fecha').equals(hoy).and(s=>s.tipo==='pomodoro').toArray();
  const minHoy = sessionsHoy.reduce((a,s)=>a+(s.tiempo_pomodoro||0),0)/3600;
  const metaDiaria = parseFloat(document.getElementById('metaDiaria').value)||3;
  document.getElementById('progresoDiario').textContent = `${minHoy.toFixed(1)}h / ${metaDiaria}h`;
  document.getElementById('progressDiario').style.width = Math.min(100, (minHoy/metaDiaria)*100)+'%';
  const inicio = new Date(); inicio.setDate(inicio.getDate()-inicio.getDay()+1);
  const sessionsSem = await db.sessions.where('fecha').between(inicio.toISOString().split('T')[0], hoy, true, true).and(s=>s.tipo==='pomodoro').toArray();
  const minSem = sessionsSem.reduce((a,s)=>a+(s.tiempo_pomodoro||0),0)/3600;
  const metaSemanal = parseFloat(document.getElementById('metaSemanal').value)||15;
  document.getElementById('progresoSemanal').textContent = `${minSem.toFixed(1)}h / ${metaSemanal}h`;
  document.getElementById('progressSemanal').style.width = Math.min(100, (minSem/metaSemanal)*100)+'%';
}
async function actualizarChecklist() {
  const container = document.getElementById('checklistContainer');
  const completados = await db.checklist.toArray();
  const ids = new Map(completados.map(c=>[c.subtema_id, c.fecha_completado]));
  const subtemasExtra = await db.subtemas_extra.toArray();
  const todasMaterias = [...new Set(currentTemario.map(t=>t.materia))];
  subtemasExtra.forEach(e=>{ if(!todasMaterias.includes(e.materia)) todasMaterias.push(e.materia); });
  let totalSubtemas = 0;
  let html = '';
  for(const mat of todasMaterias) {
    const tem = currentTemario.filter(t=>t.materia===mat);
    const extras = subtemasExtra.filter(e=>e.materia===mat);
    const subs = [...tem.map(t=>({id:t.id.toString(), nombre:t.nombre, etapa:t.etapa})), ...extras.map(e=>({id:'extra_'+e.id, nombre:e.nombre, etapa:e.etapa||'Personalizado'}))];
    if(!subs.length) continue;
    html+=`<h4>${mat}</h4>`;
    subs.forEach(st=>{ const fechaComp = ids.has(st.id) ? ` (${ids.get(st.id)})` : ''; html+=`<label><input type="checkbox" class="checklist-cb" data-stid="${st.id}" ${ids.has(st.id)?'checked':''}> ${st.nombre} (${st.etapa||''})${fechaComp}</label><br>`; totalSubtemas++; });
  }
  container.innerHTML = html;
  const completado = completados.length;
  const pct = totalSubtemas ? Math.round(completado/totalSubtemas*100) : 0;
  document.getElementById('progressChecklist').style.width = pct+'%';
  document.getElementById('checklistPercent').textContent = pct+'% completado ('+completado+'/'+totalSubtemas+')';
  container.querySelectorAll('.checklist-cb').forEach(cb=>cb.addEventListener('change', async function(){
    const stid = this.dataset.stid;
    if(this.checked) await guardarLocalYOutbox('checklist','checklist',{id:stid, subtema_id:stid, fecha_completado:new Date().toISOString().split('T')[0]}, 'subtema_id,user_id');
    else {
      await db.checklist.where('subtema_id').equals(stid).delete();
      await db.outbox.put({table:'checklist', record_id:stid, operation:'delete', data:{subtema_id:stid, user_id:sessionActual.user.id, deleted_at:new Date().toISOString()}, onConflict:'subtema_id,user_id', created_at:new Date().toISOString()});
      await syncAll();
    }
    actualizarChecklist();
  }));
}

function actualizarTodo() {
  actualizarHistorial(); actualizarProgreso(); actualizarMetricas();
  actualizarSleepHistorial(); actualizarGraficoSueno();
  actualizarConjeturasSesion(); actualizarConjeturasFull();
  actualizarChecklist(); actualizarMetas();
  actualizarPanelMetricas(); // <-- añade esta línea

}

// ===================== INICIALIZACIÓN =====================
async function poblarMaterias() {
  const sel = document.getElementById('selMateria');
  const matsDB = await db.materias.toArray();
  const matsTem = [...new Set(currentTemario.map(t=>t.materia))];
  const todas = [...new Set([...matsTem, ...matsDB.map(m=>m.nombre)])];
  sel.innerHTML = '<option value="__agregar__">+ Agregar nueva materia...</option>';
  todas.forEach(m=>sel.innerHTML += `<option value="${m}">${m}</option>`);
  if (todas.length > 0 && sel.options.length > 1) sel.selectedIndex = 1;
}
async function poblarSubtemas(mat) {
  const sel = document.getElementById('selSubtema');
  const tem = currentTemario.filter(t=>t.materia===mat);
  const extras = await db.subtemas_extra.where('materia').equals(mat).toArray();
  sel.innerHTML = '<option value="__agregar__">+ Agregar nuevo subtema...</option>';
  const grupos = { A0:[], B1:[], B2:[], Personalizado:[] };
  tem.forEach(t=>{ if(grupos[t.etapa]) grupos[t.etapa].push({...t, isExtra:false}); });
  extras.forEach(e=>{ const etapa = e.etapa||'Personalizado'; if(grupos[etapa]) grupos[etapa].push({...e, id:e.id, isExtra:true}); });
  for(const [etapa, subs] of Object.entries(grupos)) {
    if(!subs.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = etapa;
    subs.forEach(s=>{
      const opt = document.createElement('option');
      opt.value = s.isExtra ? 'extra_'+s.id : s.id.toString();
      opt.textContent = s.nombre;
      optgroup.appendChild(opt);
    });
    sel.appendChild(optgroup);
  }
  verificarAgregarSubtema();
}
function verificarAgregarSubtema() {
  document.getElementById('agregarSubtemaRow').style.display = (document.getElementById('selSubtema').value==='__agregar__')?'flex':'none';
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
  const tema = currentTemario.find(t => t.id.toString() === subtemaId);
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
  const tema = currentTemario.find(t => t.id.toString() === subtemaId);
  const libro = tema?.libros?.find(l => l.nombre === libroSeleccionado);
  if (libro && Array.isArray(libro.capitulos) && libro.capitulos.length) {
    selCapitulo.innerHTML = libro.capitulos.map(c => `<option value="${c}">${c}</option>`).join('');
  } else {
    selCapitulo.innerHTML = '<option value="">Sin capítulo</option>';
  }
}

// Evento para cambiar capítulos al cambiar de libro
document.getElementById('selLibro').addEventListener('change', function() {
  actualizarCapitulos(this.value, document.getElementById('selSubtema').value);
});
document.getElementById('selMateria').addEventListener('change', async function(){
  if(this.value==='__agregar__'){ 
    document.getElementById('agregarMateriaRow').style.display='flex'; 
    return; 
  }
  document.getElementById('agregarMateriaRow').style.display='none';
  currentProblemaNum=1; 
  document.getElementById('numProblema').value=1;
  try {
    await poblarSubtemas(this.value);
    poblarLibros(document.getElementById('selSubtema').value);
    if (document.getElementById('active-view').classList.contains('active')) {
      await actualizarHistorialSubtema();
      document.getElementById('nombreSubtemaHistorial').textContent = this.selectedOptions[0]?.textContent || '';
    }
  } catch(e) {
    console.error('Error en change materia:', e);
  }
});
document.getElementById('selSubtema').addEventListener('change', async function(){
  verificarAgregarSubtema();
  poblarLibros(this.value);
  actualizarCapitulos(document.getElementById('selLibro').value, this.value);
  if(this.value!=='__agregar__'){ currentProblemaNum=1; document.getElementById('numProblema').value=1; }
  if (document.getElementById('active-view').classList.contains('active')) {
    actualizarHistorialSubtema();
// Ajustar número de problema al cambiar de subtema
    const libro = document.getElementById('selLibro').value;
    const problemasPrevios = await db.sessions
        .where('tipo').equals('problema')
        .and(p => p.subtema_id === this.value && p.libro === libro)
        .toArray();
    const maxNum = problemasPrevios.reduce((max, p) => Math.max(max, p.problema_num || 0), 0);
    document.getElementById('numProblema').value = maxNum + 1;
    currentProblemaNum = maxNum + 1;
    
    document.getElementById('nombreSubtemaHistorial').textContent = this.selectedOptions[0]?.textContent || '';
    if (session.modo === 'B') mostrarColaErrores();
  }
});

function actualizarHorasCalculadas() {
  const acostar = document.getElementById('acostarSueno').value;
  const despertar = document.getElementById('despertarSueno').value;
  const horas = calcularHoras(acostar, despertar);
  document.getElementById('horasCalculadas').textContent = horas ? horas + ' h' : '--';
}
document.getElementById('acostarSueno').addEventListener('change', actualizarHorasCalculadas);
document.getElementById('despertarSueno').addEventListener('change', actualizarHorasCalculadas);

document.getElementById('btnAgregarMateria').addEventListener('click', async ()=>{
  const nombre = document.getElementById('nuevaMateria').value.trim(); if(!nombre) return;
  await guardarLocalYOutbox('materias','materias',{nombre}, 'user_id,nombre');
  await poblarMaterias();
  document.getElementById('selMateria').value=nombre;
  document.getElementById('nuevaMateria').value=''; document.getElementById('agregarMateriaRow').style.display='none';
  document.getElementById('selMateria').dispatchEvent(new Event('change'));
  await poblarSelectoresDominio();
});
document.getElementById('btnAgregarSubtema').addEventListener('click', async ()=>{
  const materia = document.getElementById('selMateria').value;
  const nombre = document.getElementById('nuevoSubtema').value.trim();
  if(!materia||materia==='__agregar__'||!nombre) return;
  const id = await guardarLocalYOutbox('subtemas_extra','subtemas_extra',{materia, nombre, etapa:'Personalizado'});
  await poblarSubtemas(materia);
  document.getElementById('selSubtema').value = 'extra_'+id;
  document.getElementById('nuevoSubtema').value=''; document.getElementById('agregarSubtemaRow').style.display='none';
  currentProblemaNum=1; document.getElementById('numProblema').value=1;
  await poblarSelectoresDominio();
});

document.getElementById('btnGuardarSueno').addEventListener('click', async () => {
  const fecha = document.getElementById('fechaSueno').value;
  const acostar = document.getElementById('acostarSueno').value;
  const despertar = document.getElementById('despertarSueno').value;
  const horas = calcularHoras(acostar, despertar);
  const calidad = parseFloat(document.getElementById('calidadSueno').value);
  if(!fecha || isNaN(calidad)) return;
  await guardarLocalYOutbox('sueno','sueno',{
    fecha, horas, calidad,
    timestamp: new Date().toISOString(),acostar: acostar + ':00',
    despertar: despertar + ':00'
  }, 'user_id,fecha');
  document.getElementById('calidadSueno').value = '';
  document.getElementById('acostarSueno').value = '';
  document.getElementById('despertarSueno').value = '';
  document.getElementById('horasCalculadas').textContent = '--';
  showToast('Sueño registrado ✅');
  actualizarSleepHistorial(); actualizarGraficoSueno();
});

document.getElementById('btnGuardarMetas').addEventListener('click', async () => {
  await guardarLocalYOutbox('metas','metas',{key:'metaDiaria', value:parseFloat(document.getElementById('metaDiaria').value)||3}, 'key,user_id');
  await guardarLocalYOutbox('metas','metas',{key:'metaSemanal', value:parseFloat(document.getElementById('metaSemanal').value)||15}, 'key,user_id');
  actualizarMetas();
});

document.getElementById('btnExport').addEventListener('click', async () => {
  const data = { sessions: await db.sessions.toArray(), conjeturas: await db.conjeturas.toArray(), sueno: await db.sueno.toArray(), materias: await db.materias.toArray(), subtemas_extra: await db.subtemas_extra.toArray(), checklist: await db.checklist.toArray(), metas: await db.metas.toArray() };
  const blob = new Blob([JSON.stringify(data)],{type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'estudio_v28_backup.json'; a.click();
});
document.getElementById('btnImport').addEventListener('click', ()=>document.getElementById('importFile').click());
document.getElementById('importFile').addEventListener('change', async function(){
  const file = this.files[0]; if(!file) return;
  try {
    const data = JSON.parse(await file.text());
    if(data.sessions) { await db.sessions.clear(); await db.sessions.bulkPut(data.sessions); }
    if(data.conjeturas) { await db.conjeturas.clear(); await db.conjeturas.bulkPut(data.conjeturas); }
    if(data.sueno) { await db.sueno.clear(); await db.sueno.bulkPut(data.sueno); }
    if(data.materias) { await db.materias.clear(); await db.materias.bulkPut(data.materias); }
    if(data.subtemas_extra) { await db.subtemas_extra.clear(); await db.subtemas_extra.bulkPut(data.subtemas_extra); }
    if(data.checklist) { await db.checklist.clear(); await db.checklist.bulkPut(data.checklist); }
    if(data.metas) { await db.metas.clear(); await db.metas.bulkPut(data.metas); }
    await syncAll(); actualizarTodo();
    showToast('Datos importados.');
  } catch(e) { showToast('Error al importar.'); }
  this.value='';
});
document.getElementById('btnLoadTemario').addEventListener('click', ()=>document.getElementById('temarioFile').click());
document.getElementById('temarioFile').addEventListener('change', async function(){
  const file = this.files[0]; if(!file) return;
  try {
    const data = JSON.parse(await file.text());
    if(!Array.isArray(data) || !data.every(t => t.materia && t.nombre)) {
      showToast('Formato de temario inválido (se esperaba una lista con materia y nombre).');
      this.value=''; return;
    }
    currentTemario = data;
    await db.temario.put({ key: 'activo', contenido: data, updated_at: new Date().toISOString() });
    await poblarMaterias();
    document.getElementById('selMateria').dispatchEvent(new Event('change'));
    await actualizarChecklist();
    await poblarSelectoresDominio();
    showToast('Temario cargado ✅');
  } catch(e) { showToast('Error al cargar el temario.'); }
  this.value='';
});
document.getElementById('btnSyncNow').addEventListener('click', async () => {
  if (!sessionActual?.user) { showToast('Inicia sesión primero', 2000); return; }
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
  if (errores.length > 0) { alert('Errores:\n' + JSON.stringify(errores, null, 2)); }
  else { alert('Enviados: ' + enviados); }
  await pullChanges();
  actualizarTodo();
});

document.getElementById('tabNav').addEventListener('click', e => {
  if(!e.target.classList.contains('tab-btn')) return;
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  e.target.classList.add('active');
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById(e.target.dataset.panel).classList.add('active');
  if(e.target.dataset.panel==='panelHistorial') actualizarHistorial();
  if(e.target.dataset.panel==='panelProgreso') actualizarProgreso();
  if(e.target.dataset.panel==='panelMetricas') {
    actualizarPanelMetricas();
}
  if(e.target.dataset.panel==='panelSueno') { actualizarSleepHistorial(); actualizarGraficoSueno(); }
  if(e.target.dataset.panel==='panelConjeturas') actualizarConjeturasFull();
  if(e.target.dataset.panel==='panelChecklist') actualizarChecklist();
  if(e.target.dataset.panel==='panelMetas') actualizarMetas();
  if(e.target.dataset.panel==='panelDominio') { poblarSelectoresDominio(); actualizarDominioHistorial(); }
});

// ===================== NUEVAS MÉTRICAS =====================
async function actualizarHorasEstudiadas() {
  const materia = document.getElementById('filtroHorasMateria').value;
  const sessions = await db.sessions.where('tipo').equals('pomodoro').toArray();
  const dias = {};
  sessions.forEach(s => {
    const fecha = s.fecha || new Date(s.timestamp).toISOString().split('T')[0];
    const mat = s.materia || 'sin materia';
    if (materia !== 'todas' && mat !== materia) return;
    if (!dias[fecha]) dias[fecha] = {};
    if (!dias[fecha][mat]) dias[fecha][mat] = 0;
    dias[fecha][mat] += (s.tiempo_pomodoro || 0) / 3600;
  });
  let totalDia = 0, totalGlobal = 0;
  const hoy = new Date().toISOString().split('T')[0];
  let html = '<table><tr><th>Fecha</th><th>Materia</th><th>Horas</th></tr>';
  const fechas = Object.keys(dias).sort().reverse();
  fechas.forEach(fecha => {
    Object.entries(dias[fecha]).forEach(([mat, horas]) => {
      const h = horas.toFixed(1);
      if (fecha === hoy) totalDia += horas;
      totalGlobal += horas;
      html += `<tr><td>${fecha}</td><td>${mat}</td><td>${h}</td></tr>`;
    });
  });
  html += '</table>';
  document.getElementById('tablaHorasDiarias').innerHTML = html;
  document.getElementById('horasTotalDia').textContent = `Hoy: ${totalDia.toFixed(1)} h`;
  document.getElementById('horasTotalGlobal').textContent = `Total: ${totalGlobal.toFixed(1)} h`;
}

async function actualizarProblemasIntentados() {
  const materia = document.getElementById('filtroProblemasMateria').value;
  let problemas = await db.sessions.where('tipo').equals('problema').toArray();
  if (materia !== 'todas') problemas = problemas.filter(p => p.materia === materia);
  const total = problemas.length;
  const bien = problemas.filter(p => p.resultado === 'bien').length;
  const mal = problemas.filter(p => p.resultado === 'mal').length;
  const noResuelto = problemas.filter(p => p.resultado === 'no_resuelto').length;
  document.getElementById('resumenProblemas').textContent =
    `Total: ${total} | ✅ Bien: ${bien} | ❌ Mal: ${mal} | ⚪ No resuelto: ${noResuelto}`;
  const dias = {};
  problemas.forEach(p => {
    const fecha = p.fecha || new Date(p.timestamp).toISOString().split('T')[0];
    if (!dias[fecha]) dias[fecha] = { bien:0, mal:0, no_resuelto:0, total:0 };
    dias[fecha].total++;
    if (p.resultado === 'bien') dias[fecha].bien++;
    else if (p.resultado === 'mal') dias[fecha].mal++;
    else if (p.resultado === 'no_resuelto') dias[fecha].no_resuelto++;
  });
  let html = '<table><tr><th>Fecha</th><th>Total</th><th>Bien</th><th>Mal</th><th>No resuelto</th></tr>';
  Object.keys(dias).sort().reverse().forEach(fecha => {
    const d = dias[fecha];
    html += `<tr><td>${fecha}</td><td>${d.total}</td><td>${d.bien}</td><td>${d.mal}</td><td>${d.no_resuelto}</td></tr>`;
  });
  html += '</table>';
  document.getElementById('tablaProblemasDia').innerHTML = html;
}

async function actualizarAvanceTemas() {
  const container = document.getElementById('avanceTemasContainer');
  const materias = [...new Set(currentTemario.map(t => t.materia))];
  let html = '';
  for (const mat of materias) {
    const temas = currentTemario.filter(t => t.materia === mat);
    const total = temas.length;
    const completados = await db.checklist.toArray();
    const idsCompletados = new Set(completados.map(c => c.subtema_id));
    const avanzados = temas.filter(t => idsCompletados.has(t.id.toString())).length;
    html += `<p><strong>${mat}:</strong> ${avanzados}/${total} temas completados</p>`;
  }
  container.innerHTML = html;
}

document.getElementById('filtroHorasMateria').addEventListener('change', actualizarHorasEstudiadas);
document.getElementById('filtroProblemasMateria').addEventListener('change', actualizarProblemasIntentados);

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .catch(err => console.warn('SW no pudo registrarse', err));
  }
}
registerSW();

async function initApp() {
  await syncAll();
  const storedTemario = await db.temario.get('activo');
  if (storedTemario?.contenido) { currentTemario = storedTemario.contenido; }
  await poblarMaterias();
  document.getElementById('selMateria').dispatchEvent(new Event('change'));
  document.getElementById('fechaSueno').value = new Date().toISOString().split('T')[0];
  updatePomoDisplay(); updatePomoStatusText(); updatePomoButtons();
  setConfigEnabled(true);
  document.getElementById('btnDistraje').disabled = true;
  document.getElementById('btnLecturaStart').disabled = true;
  document.getElementById('btnLecturaStop').disabled = true;
  actualizarTodo();
}

// ===================== NUEVO DASHBOARD DE MÉTRICAS =====================
async function actualizarPanelMetricas() {
  const sesiones = await db.sessions.toArray();
  const conjeturas = await db.conjeturas.toArray();
  const repasos = await db.repasos.toArray();

  // Fecha de registro (primera sesión)
  if (sesiones.length > 0) {
    const primeraSesion = sesiones.reduce((min, s) => 
      new Date(s.timestamp || s.fecha) < new Date(min.timestamp || min.fecha) ? s : min
    );
    const fecha = new Date(primeraSesion.timestamp || primeraSesion.fecha);
    document.getElementById('fechaRegistro').textContent = fecha.toLocaleDateString();
  } else {
    document.getElementById('fechaRegistro').textContent = 'Sin datos';
  }

  // Racha de días estudiando
  const diasEstudiados = new Set(sesiones.map(s => s.fecha || new Date(s.timestamp).toISOString().split('T')[0]));
  let racha = 0;
  let fechaActual = new Date();
  while (true) {
    const fechaStr = fechaActual.toISOString().split('T')[0];
    if (diasEstudiados.has(fechaStr)) {
      racha++;
      fechaActual.setDate(fechaActual.getDate() - 1);
    } else {
      break;
    }
  }
  document.getElementById('rachaDias').textContent = racha;

  // Sesiones estudiadas (total de pomodoros)
  const totalSesiones = sesiones.filter(s => s.tipo === 'pomodoro').length;
  document.getElementById('totalSesiones').textContent = totalSesiones;

  // Problemas tipo A
  const problemasA = sesiones.filter(s => s.tipo === 'problema' && s.modo === 'A');
  document.getElementById('totalProblemasA').textContent = problemasA.length;

  // Tiempo total estudiado (todas las sesiones tipo pomodoro)
  const tiempoTotalSegundos = sesiones
    .filter(s => s.tipo === 'pomodoro')
    .reduce((acc, s) => acc + (s.tiempo_pomodoro || 0), 0);
  document.getElementById('tiempoTotalEstudio').textContent = formatHMS(tiempoTotalSegundos);
// Totales generales de problemas (todos los modos)
const bienGeneral = sesiones.filter(s => s.tipo === 'problema' && s.resultado === 'bien').length;
const malGeneral = sesiones.filter(s => s.tipo === 'problema' && s.resultado === 'mal').length;
const noResueltosGeneral = sesiones.filter(s => s.tipo === 'problema' && s.resultado === 'no_resuelto').length;
document.getElementById('totalBienGeneral').textContent = bienGeneral;
document.getElementById('totalMalGeneral').textContent = malGeneral;
document.getElementById('totalNoResueltosGeneral').textContent = noResueltosGeneral;

// Recall: total de repasos (exclusivo de sesiones B)
document.getElementById('totalRecall').textContent = repasos.length;

// Conjeturas totales (todas las fechas)
const totalConjeturas = conjeturas.length;
document.getElementById('totalConjeturasGeneral').textContent = totalConjeturas;
// Datos de hoy
const hoy = new Date().toISOString().split('T')[0];
const sesionesHoy = sesiones.filter(s => s.tipo === 'pomodoro' && (s.fecha || new Date(s.timestamp).toISOString().split('T')[0]) === hoy);
const horasHoy = sesionesHoy.reduce((acc, s) => acc + (s.tiempo_pomodoro || 0), 0) / 3600;
document.getElementById('horasHoy').textContent = horasHoy.toFixed(1) + ' h';
  
  // Nivel de progreso (opcional: basado en horas totales)
  const nivelPorcentaje = Math.min(100, Math.round(tiempoTotalSegundos / 3600 / 100 * 100)); // 100h = 100%
  document.getElementById('nivelProgreso').style.width = nivelPorcentaje + '%';

  // Generar heatmap
  await generarHeatmap(sesiones);
}

function formatHMS(segundos) {
  const horas = Math.floor(segundos / 3600);
  const minutos = Math.floor((segundos % 3600) / 60);
  const segundosRest = Math.floor(segundos % 60);
  return `${String(horas).padStart(2, '0')}:${String(minutos).padStart(2, '0')}:${String(segundosRest).padStart(2, '0')}`;
}

async function generarHeatmap(sesiones) {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;
  
  const hoy = new Date();
  const inicio = new Date();
  inicio.setMonth(hoy.getMonth() - 11);
  inicio.setDate(1);

  const diasMap = new Map();
  sesiones.filter(s => s.tipo === 'pomodoro').forEach(s => {
    const fecha = s.fecha || new Date(s.timestamp).toISOString().split('T')[0];
    const horas = (s.tiempo_pomodoro || 0) / 3600;
    diasMap.set(fecha, (diasMap.get(fecha) || 0) + horas);
  });

  container.innerHTML = '';
  let fecha = new Date(inicio);
  while (fecha <= hoy) {
    const fechaStr = fecha.toISOString().split('T')[0];
    const horas = diasMap.get(fechaStr) || 0;
    const nivel = horas === 0 ? 0 : (horas <= 1 ? 1 : (horas <= 2 ? 2 : (horas <= 4 ? 3 : 4)));
    const div = document.createElement('div');
    div.className = 'heatmap-day';
    div.dataset.level = nivel;
    div.title = `${fechaStr}: ${horas.toFixed(1)}h`;
    container.appendChild(div);
    fecha.setDate(fecha.getDate() + 1);
  }
}
