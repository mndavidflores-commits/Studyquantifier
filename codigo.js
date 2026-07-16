import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';

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

  const State = {
    IDLE: 'IDLE', FOCUS_RUNNING: 'FOCUS_RUNNING', FOCUS_PAUSED: 'FOCUS_PAUSED',
    BREAK_RUNNING: 'BREAK_RUNNING', BREAK_PAUSED: 'BREAK_PAUSED', SESSION_ENDING: 'SESSION_ENDING'
  };
  const session = {
    state: State.IDLE, tempId: null, remainingSeconds: 90*60, elapsedTotal: 0,
    distracciones: 0, lecturaSeconds: 0, lecturaRunning: false, lecturaInterval: null, pomoInterval: null
  };
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
  let chartTiempo, chartRadar, chartEvolucion, chartSueno;
  // NUEVO: Variables para los gráficos de análisis por materia
  let chartFaseLinea, chartMejoraBarras, chartRadarMateria;

  function actualizarUI(s) {
    sessionActual = s;
    if (s?.user) {
      document.getElementById('auth-status').textContent = `Conectado como ${s.user.email}`;
      document.getElementById('btn-login').style.display = 'none';
      document.getElementById('btn-logout').style.display = 'inline-block';
      document.getElementById('app-content').style.display = 'block';
      initApp();
    } else {
      document.getElementById('auth-status').textContent = 'No has iniciado sesión.';
      document.getElementById('btn-login').style.display = 'inline-block';
      document.getElementById('btn-logout').style.display = 'none';
      document.getElementById('app-content').style.display = 'none';
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

  async function pushChanges() {
    const ops = await db.outbox.toArray();
    for (const op of ops) {
      const { error } = await supabase.from(op.table).upsert(op.data, { onConflict: op.onConflict || 'id' });
      if (!error) await db.outbox.delete(op.localId);
    }
  }
  async function pullChanges() {
    const tablas = ['study_sessions','conjeturas','sueno','materias','subtemas_extra','checklist','metas'];
    for (const tabla of tablas) {
      const lastSync = await db.sync_metadata.get(`last_pull_${tabla}`);
      const lastPullTime = lastSync?.value || new Date(0).toISOString();
      const { data: nuevos } = await supabase.from(tabla).select('*').gt('updated_at', lastPullTime);
      if (nuevos?.length > 0) {
        const coleccion = tabla === 'study_sessions' ? 'sessions' : tabla;
        await db[coleccion].bulkPut(nuevos);
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
    const registro = { ...datos, id, user_id: sessionActual.user.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await db[coleccionDexie].put(registro);
    await db.outbox.put({ table: tablaSupabase, record_id: id, operation: 'insert', data: registro, onConflict, created_at: new Date().toISOString() });
    await syncAll();
    return id;
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60), d = Math.floor((sec % 1) * 10);
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${d}`;
  }
  function setConfigEnabled(enabled) {
    document.getElementById('selFase').disabled = !enabled;
    document.getElementById('selModo').disabled = !enabled;
    document.getElementById('selMateria').disabled = !enabled;
    document.getElementById('selSubtema').disabled = !enabled;
  }
  function updatePomoDisplay() {
    const m = Math.floor(session.remainingSeconds / 60), s = session.remainingSeconds % 60;
    document.getElementById('pomoCircle').textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
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
  }
  function stopPomoInterval() { if (session.pomoInterval) { clearInterval(session.pomoInterval); session.pomoInterval = null; } }
  function stopLecturaInterval() {
    if (session.lecturaInterval) { clearInterval(session.lecturaInterval); session.lecturaInterval = null; }
    if (session.lecturaRunning) {
      session.lecturaRunning = false;
      const m = Math.floor(session.lecturaSeconds / 60), s = session.lecturaSeconds % 60;
      document.getElementById('lecturaAcumulado').textContent = `${m}:${String(s).padStart(2,'0')}`;
    }
  }
  function detenerTemporizadorCiego() {
    if (blindTimer.running) { blindTimer.running = false; clearInterval(blindTimer.interval); blindTimer.interval = null; }
    blindTimer.pendingResult = false;
    document.getElementById('cardResultado').style.display = 'none';
    document.getElementById('timerControls').style.display = 'flex';
    document.getElementById('btnStartTimer').disabled = false;
    document.getElementById('btnStopTimer').disabled = true;
    document.getElementById('numProblema').disabled = false;
    document.getElementById('timerLabel').textContent = 'En pausa';
    blindTimer.seconds = 0;
    updateBlindDisplay();
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
        setConfigEnabled(false);
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
            const breakMinutes = parseInt(document.getElementById('pomoBreak').value) || 20;
            if (breakMinutes > 0) { session.remainingSeconds = breakMinutes * 60; transition(State.BREAK_RUNNING); }
            else { transition(State.SESSION_ENDING); }
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
  document.getElementById('btnGuardarResumen').addEventListener('click', async () => {
    const frustracion = parseInt(document.getElementById('resumenFrustracion').value) || 0;
    const energia = parseInt(document.getElementById('resumenEnergia').value) || 3;
    const problemas = await db.sessions.where('tipo').equals('problema').and(s => s.sesion_id === session.tempId).toArray();
    const total = problemas.length, tiempoTotal = problemas.reduce((a, p) => a + (p.tiempo_s || 0), 0);
    const conjs = (await db.conjeturas.where('sesion_id').equals(session.tempId).toArray()).length;
    const idSesion = await guardarLocalYOutbox('study_sessions', 'sessions', {
      tipo: 'pomodoro', fecha: new Date().toISOString().split('T')[0], timestamp: Date.now(),
      modo: document.getElementById('selModo').value, fase: document.getElementById('selFase').value,
      materia: document.getElementById('selMateria').value, subtema_id: document.getElementById('selSubtema').value,
      subtema_nombre: document.getElementById('selSubtema').selectedOptions[0]?.textContent || '',
      tiempo_pomodoro: session.elapsedTotal, tiempo_lectura: session.lecturaSeconds, frustracion, energia,
      resumen_ejercicios: total, resumen_correctos: problemas.filter(p=>p.resultado==='bien').length,
      resumen_incorrectos: problemas.filter(p=>p.resultado==='mal').length, resumen_no_resueltos: problemas.filter(p=>p.resultado==='no_resuelto').length,
      resumen_lectura: session.lecturaSeconds, resumen_tiempo_promedio: total ? tiempoTotal/total : 0,
      resumen_conjeturas: conjs, resumen_distracciones: session.distracciones,
      pomodoro_label: 'pomodoro_' + Date.now()
    });
    if (idSesion) {
      await db.sessions.where('sesion_id').equals(session.tempId).modify({ sesion_id: idSesion });
      await db.conjeturas.where('sesion_id').equals(session.tempId).modify({ sesion_id: idSesion });
    }
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
  document.getElementById('btnLecturaStart').addEventListener('click', () => {
    if (session.lecturaRunning || (session.state !== State.FOCUS_RUNNING && session.state !== State.BREAK_RUNNING)) return;
    session.lecturaRunning = true;
    document.getElementById('lecturaAcumulado').textContent = 'Leyendo...';
    const start = Date.now() - session.lecturaSeconds * 1000;
    session.lecturaInterval = setInterval(() => { session.lecturaSeconds = Math.round((Date.now() - start) / 1000); }, 1000);
  });
  document.getElementById('btnLecturaStop').addEventListener('click', () => { if (!session.lecturaRunning) return; stopLecturaInterval(); });

  function updateBlindDisplay() {
    document.getElementById('timerDisplay').textContent = formatTime(blindTimer.seconds);
    document.getElementById('timerDisplay').classList.toggle('blind', blindTimer.running);
  }
  function startBlindTimer() {
    if (blindTimer.running || blindTimer.pendingResult) return;
    if (session.state !== State.FOCUS_RUNNING && session.state !== State.BREAK_RUNNING) return;
    blindTimer.running = true; blindTimer.pendingResult = false;
    document.getElementById('timerLabel').textContent = 'Estudiando...';
    blindTimer.startTime = Date.now() - blindTimer.seconds * 1000;
    document.getElementById('numProblema').disabled = true;
    document.getElementById('btnStartTimer').disabled = true; document.getElementById('btnStopTimer').disabled = false;
    blindTimer.interval = setInterval(() => { blindTimer.seconds = (Date.now() - blindTimer.startTime) / 1000; updateBlindDisplay(); }, 100);
  }
  function stopBlindTimerAndShowResult() {
    if (!blindTimer.running) return;
    blindTimer.running = false; clearInterval(blindTimer.interval);
    document.getElementById('timerLabel').textContent = 'Detenido';
    updateBlindDisplay();
    document.getElementById('numProblema').disabled = false;
    document.getElementById('tiempoMostrado').textContent = `${formatTime(blindTimer.seconds)} (${(blindTimer.seconds/60).toFixed(2)} min)`;
    blindTimer.previousProblemaNum = parseInt(document.getElementById('numProblema').value) || 1;
    document.getElementById('cardResultado').style.display = 'block';
    document.getElementById('timerControls').style.display = 'none';
    blindTimer.pendingResult = true;
  }
  document.getElementById('btnStartTimer').addEventListener('click', startBlindTimer);
  document.getElementById('btnStopTimer').addEventListener('click', stopBlindTimerAndShowResult);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement === document.body && document.getElementById('modalResumen').style.display !== 'flex') {
      if (blindTimer.running) stopBlindTimerAndShowResult(); else startBlindTimer();
    }
  });
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
  document.getElementById('btnSiguienteProblema').addEventListener('click', async () => {
    const modo = document.getElementById('selModo').value, fase = document.getElementById('selFase').value;
    const materia = document.getElementById('selMateria').value, subtema = document.getElementById('selSubtema').value;
    const resultadoBtn = document.querySelector('#toggleResultado .toggle-btn.active');
    if (!resultadoBtn) return;
    const resultado = resultadoBtn.dataset.val;
    const codError = (resultado === 'mal' || resultado === 'no_resuelto') ? document.getElementById('selCodigoError').value : null;
    const confianza = (resultado === 'no_resuelto') ? null : parseInt(document.getElementById('selConfianza').value);
    await guardarLocalYOutbox('study_sessions', 'sessions', {
      tipo: 'problema', fecha: new Date().toISOString().split('T')[0], timestamp: Date.now(),
      modo, fase, materia, subtema_id: subtema, subtema_nombre: document.getElementById('selSubtema').selectedOptions[0]?.textContent || '',
      problema_num: blindTimer.previousProblemaNum, tiempo_s: Math.round(blindTimer.seconds * 10) / 10,
      resultado, codigo_error: codError, dificultad_experimentada: parseInt(document.getElementById('selDifExp').value),
      confianza, intentos: parseInt(document.getElementById('numIntentos').value) || 1,
      nivel_bloom: parseInt(document.getElementById('selBloom').value), sesion_id: session.tempId
    });
    document.getElementById('numProblema').value = blindTimer.previousProblemaNum + 1;
    currentProblemaNum = blindTimer.previousProblemaNum + 1;
    document.getElementById('cardResultado').style.display = 'none';
    document.getElementById('timerControls').style.display = 'flex';
    document.getElementById('btnStartTimer').disabled = false; document.getElementById('btnStopTimer').disabled = true;
    blindTimer.seconds = 0; updateBlindDisplay(); blindTimer.pendingResult = false;
    document.getElementById('numProblema').disabled = false;
    actualizarMetricas(); actualizarTodo();
  });
  document.getElementById('btnDescartarProblema').addEventListener('click', () => {
    document.getElementById('numProblema').value = blindTimer.previousProblemaNum;
    currentProblemaNum = blindTimer.previousProblemaNum;
    document.getElementById('cardResultado').style.display = 'none';
    document.getElementById('timerControls').style.display = 'flex';
    document.getElementById('btnStartTimer').disabled = false; document.getElementById('btnStopTimer').disabled = true;
    blindTimer.seconds = 0; updateBlindDisplay(); blindTimer.pendingResult = false;
    document.getElementById('numProblema').disabled = false;
  });
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
    actualizarConjeturasSesion(); actualizarConjeturasFull();
  });

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
  async function actualizarMetricas() {
    const problemas = await db.sessions.where('tipo').equals('problema').toArray();
    const bien = problemas.filter(s => s.resultado === 'bien').length, mal = problemas.filter(s => s.resultado === 'mal').length;
    const total = problemas.length, tiempoTotal = problemas.reduce((a, s) => a + (s.tiempo_s || 0), 0);
    const conjeturasTotal = await db.conjeturas.count();
    const conjPorMin = tiempoTotal ? (conjeturasTotal / (tiempoTotal / 60)).toFixed(2) : '0';
    document.getElementById('metricasGenerales').innerHTML = `
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
        const { error } = await supabase.from('sueno').delete().eq('id', id);
        if (error) {
          console.error('Error al eliminar en Supabase:', error);
          showToast('Error al eliminar el registro remoto');
        } else {
          showToast('Sueño eliminado ✅');
        }
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
      if(this.checked) await guardarLocalYOutbox('checklist','checklist',{subtema_id:stid, fecha_completado:new Date().toISOString().split('T')[0]}, 'subtema_id,user_id');
      else {
        await db.checklist.where('subtema_id').equals(stid).delete();
        await db.outbox.put({table:'checklist', record_id:stid, operation:'delete', data:{subtema_id:stid, user_id:sessionActual.user.id}, onConflict:'subtema_id,user_id', created_at:new Date().toISOString()});
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
  }

  // ==================== NUEVO: ANÁLISIS POR MATERIA (Niveles 1-4) ====================

  // Filtro de materia
  let materiaFiltro = 'todas';
  document.getElementById('filtroMateriaMetricas').addEventListener('change', async function() {
    materiaFiltro = this.value;
    await actualizarMetricasAvanzadas();
  });

  // Poblar el selector de materia del radar (y del filtro)
  async function poblarSelectoresMateria() {
    // Para el filtro general
    const selFiltro = document.getElementById('filtroMateriaMetricas');
    const mats = await obtenerMateriasUnicas();
    selFiltro.innerHTML = '<option value="todas">Todas</option>';
    mats.forEach(m => { selFiltro.innerHTML += `<option value="${m}">${m}</option>`; });
    // Para el radar
    const selRadar = document.getElementById('selMateriaRadar');
    selRadar.innerHTML = '';
    mats.forEach(m => { selRadar.innerHTML += `<option value="${m}">${m}</option>`; });
    selRadar.addEventListener('change', () => actualizarRadarMateria());
  }

  async function obtenerMateriasUnicas() {
    const problemas = await db.sessions.where('tipo').equals('problema').toArray();
    return [...new Set(problemas.map(p => p.materia).filter(Boolean))].sort();
  }

  // Obtener problemas filtrados por materia (si materiaFiltro != 'todas')
  async function getProblemasFiltrados() {
    let problemas = await db.sessions.where('tipo').equals('problema').toArray();
    if (materiaFiltro !== 'todas') {
      problemas = problemas.filter(p => p.materia === materiaFiltro);
    }
    return problemas;
  }

  // Nivel 1: Evolución de tasa de aciertos por materia y fase
  async function actualizarChartFaseLinea() {
    const ctx = document.getElementById('chartFaseLinea')?.getContext('2d');
    if (!ctx) return;
    if (chartFaseLinea) chartFaseLinea.destroy();

    const problemas = await getProblemasFiltrados();
    if (problemas.length === 0) return;

    // Agrupar por materia y luego por fecha (o sesión). Queremos una línea por materia, con puntos coloreados según fase.
    // Simplificamos: cada línea es una materia. Eje X: orden de sesiones (índice). Y: tasa de aciertos acumulada por sesión o promedio móvil. Pero el texto sugiere evolución temporal con colores por fase, así que mejor un gráfico de dispersión con línea por materia.
    // Vamos a crear un dataset por materia. Cada punto tiene (índice de sesión, tasa de aciertos de esa sesión). Coloreamos cada punto según fase.
    // Agrupar problemas por sesion_id y materia.
    const sesiones = {}; // key: materia|||sesion_id
    problemas.forEach(p => {
      const key = p.materia + '|||' + p.sesion_id;
      if (!sesiones[key]) sesiones[key] = { materia: p.materia, fase: p.fase, fecha: p.fecha, bien: 0, mal: 0 };
      if (p.resultado === 'bien') sesiones[key].bien++;
      else if (p.resultado === 'mal') sesiones[key].mal++;
    });

    // Por cada materia, ordenar sesiones por fecha o timestamp
    const materias = [...new Set(Object.values(sesiones).map(s => s.materia))];
    const datasets = [];
    const coloresFase = { A1: '#5c7cfa', B1: '#3dd6c8', A2: '#ffb347', B2: '#fa5c7c' };

    for (const mat of materias) {
      const sesionesMat = Object.values(sesiones).filter(s => s.materia === mat).sort((a,b) => a.fecha.localeCompare(b.fecha) || a.sesion_id?.localeCompare(b.sesion_id));
      const data = sesionesMat.map((s, idx) => {
        const tasa = s.bien + s.mal > 0 ? Math.round(s.bien / (s.bien + s.mal) * 100) : null;
        return { x: idx + 1, y: tasa, fase: s.fase, fecha: s.fecha };
      });
      datasets.push({
        label: mat,
        data: data,
        backgroundColor: data.map(d => coloresFase[d.fase] || '#ccc'),
        borderColor: 'gray',
        showLine: true,
        lineTension: 0.2,
        pointRadius: 6,
        spanGaps: false
      });
    }

    chartFaseLinea = new Chart(ctx, {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        scales: {
          x: { title: { display: true, text: 'Nº de sesión' } },
          y: { beginAtZero: true, max: 100, title: { display: true, text: 'Tasa aciertos %' } }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const point = ctx.dataset.data[ctx.dataIndex];
                return `${ctx.dataset.label}: ${point.y}% (${point.fecha}) - Fase ${point.fase}`;
              }
            }
          },
          legend: { position: 'bottom' }
        }
      }
    });
  }

  // Nivel 2: Mejora relativa por materia (barras agrupadas)
  async function actualizarChartMejoraBarras() {
    const ctx = document.getElementById('chartMejoraBarras')?.getContext('2d');
    if (!ctx) return;
    if (chartMejoraBarras) chartMejoraBarras.destroy();

    const problemas = await getProblemasFiltrados();
    if (problemas.length === 0) return;

    // Calcular tasa de aciertos para cada materia y fase
    const resumen = {}; // materia: { A1: { bien, mal }, B1: { ... } }
    problemas.forEach(p => {
      if (!resumen[p.materia]) resumen[p.materia] = {};
      if (!resumen[p.materia][p.fase]) resumen[p.materia][p.fase] = { bien: 0, mal: 0 };
      if (p.resultado === 'bien') resumen[p.materia][p.fase].bien++;
      else if (p.resultado === 'mal') resumen[p.materia][p.fase].mal++;
    });

    const materias = Object.keys(resumen);
    // Fases fijas para comparar: A1 -> B1, A2 -> B2
    const fasesBase = ['A1','A2'];
    const fasesComp = ['B1','B2'];
    const datasets = [];
    fasesBase.forEach((base, i) => {
      const comp = fasesComp[i];
      const data = materias.map(mat => {
        const b = resumen[mat][base];
        const c = resumen[mat][comp];
        if (!b || !c) return null;
        const tasaBase = b.bien + b.mal > 0 ? b.bien/(b.bien+b.mal)*100 : 0;
        const tasaComp = c.bien + c.mal > 0 ? c.bien/(c.bien+c.mal)*100 : 0;
        return tasaComp - tasaBase;
      });
      datasets.push({
        label: `${comp} - ${base} (%)`,
        data: data,
        backgroundColor: comp === 'B1' ? 'rgba(61,214,200,0.7)' : 'rgba(250,92,124,0.7)'
      });
    });

    chartMejoraBarras = new Chart(ctx, {
      type: 'bar',
      data: { labels: materias, datasets },
      options: {
        responsive: true,
        scales: { y: { title: { display: true, text: 'Mejora (% puntos)' } } },
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }

  // Nivel 3: Radar por materia (un selector para elegir materia)
  async function actualizarRadarMateria() {
    const ctx = document.getElementById('chartRadarMateria')?.getContext('2d');
    if (!ctx) return;
    if (chartRadarMateria) chartRadarMateria.destroy();

    const materia = document.getElementById('selMateriaRadar').value;
    if (!materia) return;

    const problemas = await db.sessions.where('tipo').equals('problema').and(p => p.materia === materia).toArray();
    if (problemas.length === 0) return;

    const total = problemas.length;
    const bien = problemas.filter(p => p.resultado === 'bien').length;
    const mal = problemas.filter(p => p.resultado === 'mal').length;
    const tiempoTotal = problemas.reduce((a, p) => a + (p.tiempo_s || 0), 0);
    const conjeturas = await db.conjeturas.where('materia').equals(materia).count();

    const velocidad = total ? Math.min(100, Math.round((total/(tiempoTotal/60))*10)) : 0;
    const precision = bien+mal > 0 ? Math.round(bien/(bien+mal)*100) : 0;
    const retencion = problemas.filter(p=>p.modo==='B' && p.resultado==='bien').length / (problemas.filter(p=>p.modo==='B').length||1)*100;
    const consolidacion = total ? problemas.filter(p=>p.modo==='B').length/total*100 : 0;
    const generacionC = total ? problemas.filter(p=>p.modo==='C').length/total*100 : 0;

    chartRadarMateria = new Chart(ctx, {
      type: 'radar',
      data: {
        labels: ['Velocidad','Precisión','Retención','Consolidación','Generación C'],
        datasets: [{
          label: materia,
          data: [velocidad, precision, retencion, consolidacion, generacionC],
          backgroundColor: 'rgba(92,124,250,0.2)'
        }]
      },
      options: {
        scales: { r: { beginAtZero: true, max: 100 } }
      }
    });
  }

  // Nivel 4: Tabla agregada
  async function actualizarTablaAgregada() {
    const container = document.getElementById('tablaMetricasAgregadas');
    const problemas = await getProblemasFiltrados();
    if (problemas.length === 0) {
      container.innerHTML = '<p>Sin datos.</p>';
      return;
    }

    const fases = ['A1','B1','A2','B2'];
    // Estructura: { materia: { A1: { ejercicios, correctos, incorrectos, tiempoTotal, bloomTotal, bloomCount, conjeturas } } }
    const agg = {};
    problemas.forEach(p => {
      if (!agg[p.materia]) agg[p.materia] = {};
      if (!agg[p.materia][p.fase]) agg[p.materia][p.fase] = { ejercicios: 0, correctos: 0, incorrectos: 0, tiempo: 0, bloom: 0, bloomCount: 0 };
      const faseData = agg[p.materia][p.fase];
      faseData.ejercicios++;
      if (p.resultado === 'bien') faseData.correctos++;
      else if (p.resultado === 'mal') faseData.incorrectos++;
      faseData.tiempo += (p.tiempo_s || 0);
      if (p.nivel_bloom) { faseData.bloom += p.nivel_bloom; faseData.bloomCount++; }
    });
    // Agregar conjeturas (simplificado: total de conjeturas por materia, no por fase, ya que conjeturas no tienen fase)
    const conjeturasPorMateria = {};
    const conjs = await db.conjeturas.toArray();
    conjs.forEach(c => {
      if (c.materia) conjeturasPorMateria[c.materia] = (conjeturasPorMateria[c.materia] || 0) + 1;
    });

    const materias = Object.keys(agg).sort();
    let html = '<table><thead><tr><th>Materia</th><th>Fase</th><th>Ejercicios</th><th>Tasa Aciertos</th><th>Tiempo Prom (s)</th><th>Bloom Medio</th><th>Conjeturas</th></tr></thead><tbody>';
    for (const mat of materias) {
      const conjsMat = conjeturasPorMateria[mat] || 0;
      for (const fase of fases) {
        const d = agg[mat][fase];
        if (!d || d.ejercicios === 0) continue;
        const tasa = d.correctos + d.incorrectos > 0 ? Math.round(d.correctos/(d.correctos+d.incorrectos)*100) : 0;
        const tiempoProm = d.ejercicios ? (d.tiempo / d.ejercicios).toFixed(1) : '-';
        const bloomMedio = d.bloomCount ? (d.bloom / d.bloomCount).toFixed(1) : '-';
        html += `<tr>
          <td>${mat}</td><td>${fase}</td><td>${d.ejercicios}</td><td>${tasa}%</td>
          <td>${tiempoProm}</td><td>${bloomMedio}</td><td>${conjsMat}</td>
        </tr>`;
      }
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  }

  async function actualizarMetricasAvanzadas() {
    await actualizarChartFaseLinea();
    await actualizarChartMejoraBarras();
    // El radar se actualiza solo al cambiar su selector, pero lo refrescamos si hay materia seleccionada
    if (document.getElementById('selMateriaRadar').value) {
      await actualizarRadarMateria();
    }
    await actualizarTablaAgregada();
  }

  // Llamada inicial cuando se muestra el panel Métricas
  // Modificar el listener de pestañas para que también actualice estos gráficos
  const originalTabNavHandler = document.getElementById('tabNav').onclick;
  document.getElementById('tabNav').addEventListener('click', async function(e) {
    if (!e.target.classList.contains('tab-btn')) return;
    // El código original ya maneja el cambio de paneles, pero añadimos llamada extra para Métricas
    if (e.target.dataset.panel === 'panelMetricas') {
      // Esperamos un poco a que el panel esté visible y luego poblamos selectores
      await poblarSelectoresMateria();
      await actualizarMetricasAvanzadas();
    }
  });

  // También actualizar al cambiar el filtro general (ya está enlazado)
  // Y al iniciar la app, después del primer sync
  const originalInitApp = initApp;
  initApp = async function() {
    await originalInitApp();
    await poblarSelectoresMateria();
    if (document.getElementById('panelMetricas').classList.contains('active')) {
      await actualizarMetricasAvanzadas();
    }
  };

  // ==================== FIN NUEVO ====================

  document.getElementById('btnGuardarSueno').addEventListener('click', async () => {
    const fecha = document.getElementById('fechaSueno').value;
    const acostar = document.getElementById('acostarSueno').value;
    const despertar = document.getElementById('despertarSueno').value;
    const horas = calcularHoras(acostar, despertar);
    const calidad = parseFloat(document.getElementById('calidadSueno').value);
    if(!fecha || isNaN(calidad)) return;
    await guardarLocalYOutbox('sueno','sueno',{
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
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'estudio_v26_backup.json'; a.click();
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

  document.getElementById('tabNav').addEventListener('click', e => {
    if(!e.target.classList.contains('tab-btn')) return;
    document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
    e.target.classList.add('active');
    document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
    document.getElementById(e.target.dataset.panel).classList.add('active');
    if(e.target.dataset.panel==='panelHistorial') actualizarHistorial();
    if(e.target.dataset.panel==='panelProgreso') actualizarProgreso();
    if(e.target.dataset.panel==='panelMetricas') { actualizarMetricas(); /* La llamada a avanzadas se hace en el listener adicional */ }
    if(e.target.dataset.panel==='panelSueno') { actualizarSleepHistorial(); actualizarGraficoSueno(); }
    if(e.target.dataset.panel==='panelConjeturas') actualizarConjeturasFull();
    if(e.target.dataset.panel==='panelChecklist') actualizarChecklist();
    if(e.target.dataset.panel==='panelMetas') actualizarMetas();
  });

  function showToast(msg, d=2600) { const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove('show'),d); }

  async function poblarMaterias() {
    const sel = document.getElementById('selMateria');
    const matsDB = await db.materias.toArray();
    const matsTem = [...new Set(currentTemario.map(t=>t.materia))];
    const todas = [...new Set([...matsTem, ...matsDB.map(m=>m.nombre)])];
    sel.innerHTML = '<option value="__agregar__">+ Agregar nueva materia...</option>';
    todas.forEach(m=>sel.innerHTML += `<option value="${m}">${m}</option>`);
  }
  async function poblarSubtemas(mat) {
    const sel = document.getElementById('selSubtema');
    const tem = currentTemario.filter(t=>t.materia===mat);
    const extras = await db.subtemas_extra.where('materia').equals(mat).toArray();
    sel.innerHTML = '<option value="__agregar__">+ Agregar nuevo subtema...</option>';
    const grupos = { A1:[], B1:[], A2:[], B2:[], Personalizado:[] };
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
    const sel = document.getElementById('selSubtema');
    document.getElementById('agregarSubtemaRow').style.display = (sel.value==='__agregar__')?'flex':'none';
  }
  document.getElementById('selMateria').addEventListener('change', async function(){
    if(this.value==='__agregar__'){ document.getElementById('agregarMateriaRow').style.display='flex'; return; }
    document.getElementById('agregarMateriaRow').style.display='none';
    currentProblemaNum=1; document.getElementById('numProblema').value=1;
    await poblarSubtemas(this.value);
  });
  document.getElementById('selSubtema').addEventListener('change', function(){
    verificarAgregarSubtema();
    if(this.value!=='__agregar__'){ currentProblemaNum=1; document.getElementById('numProblema').value=1; }
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
  });

  function registerSW() {
    if('serviceWorker' in navigator) {
      const blob = new Blob(["const CACHE='estudio-v26';self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(['/'])));self.skipWaiting();});self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))));self.clients.claim();});self.addEventListener('fetch',e=>{e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});"], {type:'application/javascript'});
      navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(()=>{});
    }
  }
  registerSW();

  async function initApp() {
    await syncAll();
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
