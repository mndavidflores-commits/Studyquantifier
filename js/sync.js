import { showToast } from './utils.js';
import { db, supabase, sessionActual } from './config.js';

function pkFieldFor(coleccion) {
  if (coleccion === 'checklist') return 'subtema_id';
  if (coleccion === 'metas') return 'key';
  return 'id';
}

export async function pushChanges() {
  const ops = await db.outbox.toArray();
  if (ops.length === 0) {
    showToast('Nada pendiente por sincronizar', 2000);
    return;
  }
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
    if (!error) {
      await db.outbox.delete(op.localId);
      enviados++;
    } else {
      console.error('Error al sincronizar registro:', error);
      fallidos++;
    }
  }
  showToast(`Sincronizado: ${enviados} registros. ${fallidos ? 'Fallidos: ' + fallidos : ''}`, 3000);
}

export async function pullChanges() {
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

export async function syncAll() {
  if (!sessionActual?.user) return;
  await pushChanges();
  await pullChanges();
}

export async function guardarLocalYOutbox(tablaSupabase, coleccionDexie, datos, onConflict = 'id') {
  if (!sessionActual?.user) return null;
  const id = datos.id || crypto.randomUUID();
  const existente = datos.id ? await db[coleccionDexie].get(id) : null;
  const registro = {
    ...datos,
    id,
    user_id: sessionActual.user.id,
    created_at: existente?.created_at || datos.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null
  };
  await db[coleccionDexie].put(registro);
  await db.outbox.put({
    table: tablaSupabase,
    record_id: id,
    operation: 'insert',
    data: registro,
    onConflict,
    created_at: new Date().toISOString()
  });
  syncAll(); // sin await para no bloquear la UI
  return id;
}

export async function corregirSesionId(tempId, idSesionReal) {
  const problemas = await db.sessions.where('sesion_id').equals(tempId).toArray();
  await db.sessions.where('sesion_id').equals(tempId).modify({ sesion_id: idSesionReal });
  for (const p of problemas) {
    await db.outbox.put({
      table: 'study_sessions',
      record_id: p.id,
      operation: 'insert',
      data: { ...p, sesion_id: idSesionReal, user_id: sessionActual.user.id, updated_at: new Date().toISOString() },
      onConflict: 'id',
      created_at: new Date().toISOString()
    });
  }
  const conjs = await db.conjeturas.where('sesion_id').equals(tempId).toArray();
  await db.conjeturas.where('sesion_id').equals(tempId).modify({ sesion_id: idSesionReal });
  for (const c of conjs) {
    await db.outbox.put({
      table: 'conjeturas',
      record_id: c.id,
      operation: 'insert',
      data: { ...c, sesion_id: idSesionReal, user_id: sessionActual.user.id, updated_at: new Date().toISOString() },
      onConflict: 'id',
      created_at: new Date().toISOString()
    });
  }
  syncAll();
}
