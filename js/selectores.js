import { db, state } from './config.js';
import { actualizarHistorialSubtema, mostrarColaErrores } from './repasos.js';

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

// ===================== SELECTOR DE SUBTEMA =====================
export async function poblarSubtemas(mat) {
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
    if (document.getElementById('active-view').classList.contains('active')) {
    actualizarHistorialSubtema();
  }

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