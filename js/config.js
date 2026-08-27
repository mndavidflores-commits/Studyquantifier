import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.0/+esm';

export const SUPABASE_URL = 'https://wrtmlucrxzewynnnikzh.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_qJcUe3t_K5Yl0m7lkV3C_A_5bcdtOFs';
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
window.supabase = supabase;

export const db = new Dexie('EstudioDBv26');
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

export const State = {
  IDLE: 'IDLE', FOCUS_RUNNING: 'FOCUS_RUNNING', FOCUS_PAUSED: 'FOCUS_PAUSED',
  BREAK_RUNNING: 'BREAK_RUNNING', BREAK_PAUSED: 'BREAK_PAUSED', SESSION_ENDING: 'SESSION_ENDING'
};

export const state = {
  session: {
    state: State.IDLE,
    tempId: null,
    modo: null,
    remainingSeconds: 90 * 60,
    elapsedTotal: 0,
    distracciones: 0,
    lecturaSeconds: 0,
    lecturaRunning: false,
    lecturaInterval: null,
    pomoInterval: null
  },
  blindTimer: {
    running: false,
    seconds: 0,
    interval: null,
    startTime: null,
    pendingResult: false,
    previousProblemaNum: 1
  },
  currentProblemaNum: 1,
  sessionActual: null,
  errorSeleccionado: null,
  erroresPendientes: [],
  currentTemario: [
    { id: 1, materia: 'Álgebra', etapa: 'A1', nombre: 'Ecuaciones' },
    { id: 2, materia: 'Álgebra', etapa: 'B1', nombre: 'Polinomios' }
  ],
  chartTiempo: null,
  chartRadar: null,
  chartEvolucion: null,
  chartProblemas: null,
  chartFSRS: null,
  materiaGraficoSeleccionada: 'Matemáticas',
  mostrarAvg10: true,
  mostrarPuntosA: true,
  mostrarPuntosB: true,
  diasActivosMeta: [1, 2, 3, 4, 5, 6, 0],
  appInitialized: false
};

export const temarioEmbebido = [...state.currentTemario];