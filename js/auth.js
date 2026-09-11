import { state, db } from './config.js';
import { syncAll } from './sync.js';
import { hoyLocal } from './utils.js';
import { actualizarPanelesActivos } from './panels.js';
import {
  updatePomoDisplay, updatePomoStatusText, updatePomoButtons,
  setConfigEnabled, actualizarBotonModoPomodoro
} from './ui.js';
import { poblarMaterias } from './selectores.js';

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
  await migrarSeccionesAntiguas();
  await migrarChecklistAntiguo();
  await migrarErroresConLibroSeccion();
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
  actualizarBotonModoPomodoro();
  setConfigEnabled(true);
  document.getElementById('btnDistraje').disabled = true;
  document.getElementById('btnLecturaStart').disabled = true;
  document.getElementById('btnLecturaStop').disabled = true;
  actualizarPanelesActivos();
}

// ===================== MARCAR DÍAS ACTIVOS =====================
function marcarDiasActivos() {
  document.querySelectorAll('#diasActivosMeta button[data-dia]').forEach(btn => {
    const dia = parseInt(btn.dataset.dia);
    if (state.diasActivosMeta.includes(dia)) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

// ===================== MIGRACIÓN DE SECCIÓN ANTIGUA =====================
async function migrarSeccionesAntiguas() {
  try {
    const problemasSinSeccion = await db.sessions
      .where('tipo').equals('problema')
      .and(p => !p.seccion)
      .toArray();

    if (problemasSinSeccion.length === 0) return;

    for (const p of problemasSinSeccion) {
      const actualizado = { ...p, seccion: 'Problemas resueltos', updated_at: new Date().toISOString() };
      await db.sessions.put(actualizado);
      await db.outbox.put({
        table: 'study_sessions',
        record_id: p.id,
        operation: 'insert',
        data: actualizado,
        onConflict: 'id',
        created_at: new Date().toISOString()
      });
    }
    console.log(`Migrados ${problemasSinSeccion.length} problemas antiguos a "Problemas resueltos" (con outbox).`);
  } catch (e) {
    console.warn('No se pudo migrar secciones antiguas:', e);
  }
}

// ===================== MIGRACIÓN DEL CHECKLIST ANTIGUO =====================
async function migrarChecklistAntiguo() {
  try {
    const viejos = await db.checklist.toArray();
    if (viejos.length === 0) return;

    const nuevos = viejos
      .filter(v => v.subtema_id)
      .map(v => ({
        id: crypto.randomUUID(),
        user_id: state.sessionActual?.user?.id,
        materia: null,
        subtema_id: v.subtema_id,
        libro: null,
        capitulo: null,
        tipo: 'subtema',
        completado: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null
      }));

    if (nuevos.length > 0) {
      await db.checklist_completo.bulkPut(nuevos);
      for (const n of nuevos) {
        await db.outbox.put({
          table: 'checklist_completo',
          record_id: n.id,
          operation: 'insert',
          data: n,
          onConflict: 'id',
          created_at: new Date().toISOString()
        });
      }
      console.log(`Migrados ${nuevos.length} elementos de checklist a checklist_completo (con outbox).`);
    }
  } catch (e) {
    console.warn('No se pudo migrar checklist antiguo:', e);
  }
}

// ===================== MIGRACIÓN DE ERRORES SIN LIBRO/SECCIÓN =====================
async function migrarErroresConLibroSeccion() {
  try {
    const erroresSinDatos = await db.errores
      .filter(e => !e.libro || !e.seccion)
      .toArray();

    if (erroresSinDatos.length === 0) return;

    let migrados = 0;
    let sinOrigen = 0;

    for (const err of erroresSinDatos) {
      if (!err.sesion_id_origen) {
        sinOrigen++;
        continue;
      }
      const problemaOriginal = await db.sessions.get(err.sesion_id_origen);
      if (!problemaOriginal) {
        sinOrigen++;
        continue;
      }

      const cambios = {};
      if (!err.libro && problemaOriginal.libro) cambios.libro = problemaOriginal.libro;
      if (!err.seccion && problemaOriginal.seccion) cambios.seccion = problemaOriginal.seccion;
      if (!err.capitulo && problemaOriginal.capitulo) cambios.capitulo = problemaOriginal.capitulo;

      if (Object.keys(cambios).length > 0) {
        const actualizado = { ...err, ...cambios, updated_at: new Date().toISOString() };
        await db.errores.put(actualizado);
        await db.outbox.put({
          table: 'errores',
          record_id: err.id,
          operation: 'insert',
          data: actualizado,
          onConflict: 'id',
          created_at: new Date().toISOString()
        });
        migrados++;
      } else {
        sinOrigen++;
      }
    }

    if (migrados > 0) {
      console.log(`Migrados ${migrados} errores con libro/sección (con outbox). Sin origen: ${sinOrigen}`);
    }
  } catch (e) {
    console.warn('No se pudo migrar errores con libro/sección:', e);
  }
}