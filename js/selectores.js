import { db, state } from './config.js';
import { actualizarHistorialSubtema, mostrarColaErrores } from './repasos.js';
import { hoyLocal } from './utils.js';

// ===================== SELECTOR DE MATERIA =====================
export async function poblarMaterias() {
  const sel = document.getElementById('selMateria');
  const matsDB = await db.materias.toArray();
  const matsTem = [...new Set(state.currentTemario.map(t => t.materia))];
  const todas = [...new Set([...matsTem, ...matsDB.map(m => m.nombre)])];
  sel.innerHTML = '<option value="__agregar__">+ Agregar nueva materia...</option>';
  todas.forEach(m => sel.innerHTML += `<option value="${m}">${m}</option>`);
  if (todas.length > 0 && sel.options.length > 1) sel.selectedIndex = 1;
}

// ===================== CONTADOR DE RECALLS PENDIENTES =====================
async function contarRecallsPorSubtema() {
  const hoy = hoyLocal();
  const errores = await db.errores.where('estado').equals('activo').toArray();
  const conteo = {};
  errores.forEach(e => {
    const prox = e.proxima_revision?.split('T')[0];
    if (prox && prox <= hoy) {
      const key = e.subtema_id || 'sin-subtema';
      conteo[key] = (conteo[key] || 0) + 1;
    }
  });
  return conteo;
}

// ===================== SELECTOR DE SUBTEMA (con contador) =====================
export async function poblarSubtemas(mat) {
  const sel = document.getElementById('selSubtema');
  const tem = state.currentTemario.filter(t => t.materia === mat);
  const extras = await db.subtemas_extra.where('materia').equals(mat).toArray();
  const conteoRecalls = await contarRecallsPorSubtema();

  sel.innerHTML = '<option value="__agregar__">+ Agregar nuevo subtema...</option>';
  const grupos = { A0: [], B1: [], B2: [], Personalizado: [] };
  tem.forEach(t => { if (grupos[t.etapa]) grupos[t.etapa].push({ ...t, isExtra: false }); });
  extras.forEach(e => { const etapa = e.etapa || 'Personalizado'; if (grupos[etapa]) grupos[etapa].push({ ...e, id: e.id, isExtra: true }); });

  for (const [etapa, subs] of Object.entries(grupos)) {
    if (!subs.length) continue;
    const optgroup = document.createElement('optgroup');
    optgroup.label = etapa;
    subs.forEach(s => {
      const idStr = s.isExtra ? 'extra_' + s.id : s.id.toString();
      const pendientes = conteoRecalls[idStr] || 0;
      const opt = document.createElement('option');
      opt.value = idStr;
      opt.textContent = pendientes > 0 ? `${s.nombre} (${pendientes})` : s.nombre;
      optgroup.appendChild(opt);
    });
    sel.appendChild(optgroup);
  }
  verificarAgregarSubtema();
}

export function verificarAgregarSubtema() {
  const row = document.getElementById('agregarSubtemaRow');
  if (row) row.style.display = (document.getElementById('selSubtema').value === '__agregar__') ? 'flex' : 'none';
}

// ===================== SELECTORES DE LIBRO Y CAPÍTULO =====================
export function poblarLibros(subtemaId) {
  const selLibro = document.getElementById('selLibro');
  const selCapitulo = document.getElementById('selCapitulo');
  selLibro.innerHTML = '';
  selCapitulo.innerHTML = '';
  if (!subtemaId || subtemaId === '__agregar__') {
    selLibro.innerHTML = '<option value="">—</option>';
    selCapitulo.innerHTML = '<option value="">—</option>';
    poblarSecciones(null, null);
    return;
  }
  const tema = state.currentTemario.find(t => t.id.toString() === subtemaId);
  const libros = (tema && Array.isArray(tema.libros)) ? tema.libros : [];
  if (!libros.length) {
    selLibro.innerHTML = '<option value="">Sin libro</option>';
    selCapitulo.innerHTML = '<option value="">Sin capítulo</option>';
    poblarSecciones(null, null);
    return;
  }
  selLibro.innerHTML = libros.map(l => `<option value="${l.nombre}">${l.nombre}</option>`).join('');
  actualizarCapitulos(libros[0].nombre, subtemaId);
  poblarSecciones(document.getElementById('selMateria').value, libros[0].nombre);
}

export function actualizarCapitulos(libroSeleccionado, subtemaId) {
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

// ===================== SELECTOR DE SECCIÓN =====================
export async function poblarSecciones(materia, libro) {
  const sel = document.getElementById('selSeccion');
  const rowAgregar = document.getElementById('agregarSeccionRow');
  if (!sel) return;

  sel.innerHTML = '';
  if (!materia || !libro) {
    sel.innerHTML = '<option value="">—</option>';
    if (rowAgregar) rowAgregar.style.display = 'none';
    return;
  }

  const seccionesBase = ['Problemas resueltos', 'Problemas propuestos'];
  seccionesBase.forEach(nombre => {
    const opt = document.createElement('option');
    opt.value = nombre;
    opt.textContent = nombre;
    sel.appendChild(opt);
  });

  const personalizadas = await db.secciones_libro
    .where('materia').equals(materia)
    .and(s => s.libro === libro)
    .toArray();

  personalizadas.forEach(sec => {
    const opt = document.createElement('option');
    opt.value = sec.nombre;
    opt.textContent = sec.nombre;
    sel.appendChild(opt);
  });

  const optAgregar = document.createElement('option');
  optAgregar.value = '__agregar__';
  optAgregar.textContent = '+ Agregar nueva sección...';
  sel.appendChild(optAgregar);

  sel.value = seccionesBase[0];
  if (rowAgregar) rowAgregar.style.display = 'none';

  if (document.getElementById('active-view').classList.contains('active')) {
    actualizarHistorialSubtema();
  }
}

export function verificarAgregarSeccion() {
  const sel = document.getElementById('selSeccion');
  const row = document.getElementById('agregarSeccionRow');
  if (sel && row) {
    row.style.display = (sel.value === '__agregar__') ? 'flex' : 'none';
  }
}

// ===================== GRUPOS DE RECALL (MODO B) =====================
export async function poblarGruposRecall(materia) {
  const sel = document.getElementById('selGrupoRecall');
  if (!sel) return;

  sel.innerHTML = '<option value="">Selecciona un grupo de recall...</option>';
  if (!materia || materia === '__agregar__') {
    return;
  }

  const hoy = hoyLocal();
  const errores = await db.errores.where('estado').equals('activo').toArray();
  const pendientes = errores.filter(e => {
    if (e.materia !== materia) return false;
    const prox = e.proxima_revision?.split('T')[0];
    return prox && prox <= hoy;
  });

  const grupos = new Map();

  for (const e of pendientes) {
    const libro = e.libro || 'Sin libro';
    const seccion = e.seccion || 'Sin sección';
    const subtemaId = e.subtema_id || 'sin-subtema';
    const key = `${materia}|${libro}|${subtemaId}|${seccion}`;
    if (!grupos.has(key)) {
      grupos.set(key, {
        materia,
        libro,
        subtema_id: subtemaId,
        seccion,
        subtema_nombre: e.subtema_nombre || subtemaId,
        count: 0
      });
    }
    grupos.get(key).count++;
  }

  const ordenados = [...grupos.values()].sort((a, b) => {
    if (a.subtema_nombre !== b.subtema_nombre) return a.subtema_nombre.localeCompare(b.subtema_nombre);
    return a.seccion.localeCompare(b.seccion);
  });

  for (const g of ordenados) {
    const opt = document.createElement('option');
    opt.value = `${g.materia}|${g.libro}|${g.subtema_id}|${g.seccion}`;
    opt.textContent = `${g.materia} - ${g.libro} - ${g.subtema_nombre} - ${g.seccion} - ${g.count}`;
    sel.appendChild(opt);
  }

  if (ordenados.length === 0) {
    sel.innerHTML = '<option value="">Sin recalls pendientes en esta materia</option>';
  }
}

// ===================== APLICAR GRUPO DE RECALL =====================
export async function aplicarGrupoRecall(clave) {
  if (!clave) {
    state.grupoRecallActual = null;
    return;
  }
  const [materia, libro, subtema_id, seccion] = clave.split('|');
  const subtemaObj = state.currentTemario.find(t => t.id.toString() === subtema_id);
  const subtemaNombre = subtemaObj?.nombre || subtema_id;

  state.grupoRecallActual = {
    materia,
    libro,
    subtema_id,
    seccion,
    subtema_nombre: subtemaNombre
  };

  // Sincronizar selectores ocultos por si otros módulos los consultan
  const selLibro = document.getElementById('selLibro');
  const selSeccion = document.getElementById('selSeccion');
  const selSubtema = document.getElementById('selSubtema');
  const selMateria = document.getElementById('selMateria');

  if (selMateria && selMateria.value !== materia) selMateria.value = materia;
  if (selSubtema) {
    // Buscar opción que coincida
    for (const opt of selSubtema.options) {
      if (opt.value === subtema_id) { selSubtema.value = subtema_id; break; }
    }
  }
  if (selLibro) {
    for (const opt of selLibro.options) {
      if (opt.value === libro) { selLibro.value = libro; break; }
    }
  }
  if (selSeccion) {
    for (const opt of selSeccion.options) {
      if (opt.value === seccion) { selSeccion.value = seccion; break; }
    }
  }

  await mostrarColaErrores();
}