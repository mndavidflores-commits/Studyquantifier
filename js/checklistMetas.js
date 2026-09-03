import { db, state } from './config.js';
import { guardarLocalYOutbox, syncAll } from './sync.js';
import { hoyLocal, fechaLocale } from './utils.js';

// ===================== CHECKLIST JERÁRQUICO =====================
export async function actualizarChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  const completados = await db.checklist_completo.toArray();
  const completadosMap = new Map();
  completados.forEach(c => {
    const key = `${c.tipo}:${c.subtema_id || ''}:${c.libro || ''}:${c.capitulo || ''}`;
    completadosMap.set(key, c);
  });

  let total = 0;
  let completadosCount = 0;

  const fragment = document.createDocumentFragment();
  const materias = [...new Set(state.currentTemario.map(t => t.materia))];

  for (const materia of materias) {
    const tems = state.currentTemario.filter(t => t.materia === materia);
    if (!tems.length) continue;

    const materiaDiv = document.createElement('div');
    materiaDiv.className = 'checklist-materia';
    materiaDiv.innerHTML = `<h4>${materia}</h4>`;
    fragment.appendChild(materiaDiv);

    for (const tema of tems) {
      const subtemaId = tema.id.toString();
      const subtemaName = tema.nombre;

      // Checkbox de subtema
      const keySubtema = `subtema:${subtemaId}::`;
      const isSubtemaDone = completadosMap.has(keySubtema);
      total++;
      if (isSubtemaDone) completadosCount++;

      const labelSubtema = document.createElement('label');
      labelSubtema.className = 'checklist-subtema';
      labelSubtema.innerHTML = `<input type="checkbox" class="checklist-cb-new" data-tipo="subtema" data-materia="${materia}" data-subtema="${subtemaId}" ${isSubtemaDone ? 'checked' : ''}> ${subtemaName}`;
      fragment.appendChild(labelSubtema);

      // Libros y capítulos
      const libros = (tema.libros && Array.isArray(tema.libros)) ? tema.libros : [];
      for (const libro of libros) {
        const libroNombre = libro.nombre || libro;
        const capitulos = (libro.capitulos && Array.isArray(libro.capitulos)) ? libro.capitulos : [];

        const keyLibro = `libro:${subtemaId}:${libroNombre}:`;
        const isLibroDone = completadosMap.has(keyLibro);
        total++;
        if (isLibroDone) completadosCount++;

        const labelLibro = document.createElement('label');
        labelLibro.className = 'checklist-libro';
        labelLibro.innerHTML = `<input type="checkbox" class="checklist-cb-new" data-tipo="libro" data-materia="${materia}" data-subtema="${subtemaId}" data-libro="${libroNombre}" ${isLibroDone ? 'checked' : ''}> 📖 ${libroNombre}`;
        fragment.appendChild(labelLibro);

        for (const capitulo of capitulos) {
          const keyCapitulo = `capitulo:${subtemaId}:${libroNombre}:${capitulo}`;
          const isCapituloDone = completadosMap.has(keyCapitulo);
          total++;
          if (isCapituloDone) completadosCount++;

          const labelCapitulo = document.createElement('label');
          labelCapitulo.className = 'checklist-capitulo';
          labelCapitulo.innerHTML = `<input type="checkbox" class="checklist-cb-new" data-tipo="capitulo" data-materia="${materia}" data-subtema="${subtemaId}" data-libro="${libroNombre}" data-capitulo="${capitulo}" ${isCapituloDone ? 'checked' : ''}> ${capitulo}`;
          fragment.appendChild(labelCapitulo);
        }
      }
    }
  }

  container.innerHTML = '';
  container.appendChild(fragment);

  const pct = total ? Math.round(completadosCount / total * 100) : 0;
  document.getElementById('progressChecklist').style.width = pct + '%';
  document.getElementById('checklistPercent').textContent = pct + '% completado (' + completadosCount + '/' + total + ')';
}

// Delegación de eventos para checkboxes del checklist
document.getElementById('checklistContainer').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('checklist-cb-new')) return;
  const tipo = e.target.dataset.tipo;
  const materia = e.target.dataset.materia;
  const subtemaId = e.target.dataset.subtema;
  const libro = e.target.dataset.libro || null;
  const capitulo = e.target.dataset.capitulo || null;

  const registros = await db.checklist_completo.where('subtema_id').equals(subtemaId).toArray();
  const existente = registros.find(r => {
    return r.tipo === tipo &&
           (r.libro || '') === (libro || '') &&
           (r.capitulo || '') === (capitulo || '');
  });

  if (e.target.checked) {
    if (!existente) {
      await guardarLocalYOutbox('checklist_completo', 'checklist_completo', {
        id: crypto.randomUUID(),
        materia,
        subtema_id: subtemaId,
        libro,
        capitulo,
        tipo,
        completado: true
      }, 'id');
    } else {
      await guardarLocalYOutbox('checklist_completo', 'checklist_completo', { ...existente, completado: true, updated_at: new Date().toISOString() }, 'id');
    }
  } else {
    if (existente) {
      await db.checklist_completo.delete(existente.id);
      await db.outbox.put({
        table: 'checklist_completo',
        record_id: existente.id,
        operation: 'delete',
        data: { id: existente.id, user_id: state.sessionActual.user.id, deleted_at: new Date().toISOString() },
        onConflict: 'id',
        created_at: new Date().toISOString()
      });
      await syncAll();
    }
  }

  actualizarChecklist();
});

// ===================== METAS =====================
export async function actualizarMetas() {
  const hoy = new Date();
  const diaSemana = hoy.getDay();
  const esDiaActivo = state.diasActivosMeta.includes(diaSemana);

  const sessionsHoy = await db.sessions.where('fecha').equals(hoyLocal()).and(s => s.tipo === 'pomodoro').toArray();
  const minHoy = sessionsHoy.reduce((a, s) => a + (s.tiempo_pomodoro || 0), 0) / 3600;
  const metaDiaria = parseFloat(document.getElementById('metaDiaria').value) || 3;

  if (esDiaActivo) {
    document.getElementById('progresoDiario').textContent = `${minHoy.toFixed(1)}h / ${metaDiaria}h`;
    document.getElementById('progressDiario').style.width = Math.min(100, (minHoy / metaDiaria) * 100) + '%';
  } else {
    document.getElementById('progresoDiario').textContent = `${minHoy.toFixed(1)}h (día no activo)`;
    document.getElementById('progressDiario').style.width = '0%';
  }

  const inicioSemana = new Date(hoy);
  inicioSemana.setDate(hoy.getDate() - ((hoy.getDay() + 6) % 7));
  const inicioSemanaStr = fechaLocale(inicioSemana);
  const fechaHoy = hoyLocal();
  const sessionsSem = await db.sessions.where('fecha').between(inicioSemanaStr, fechaHoy, true, true).and(s => s.tipo === 'pomodoro').toArray();
  const minSem = sessionsSem.reduce((a, s) => a + (s.tiempo_pomodoro || 0), 0) / 3600;
  const metaSemanal = parseFloat(document.getElementById('metaSemanal').value) || 15;
  document.getElementById('progresoSemanal').textContent = `${minSem.toFixed(1)}h / ${metaSemanal}h`;
  document.getElementById('progressSemanal').style.width = Math.min(100, (minSem / metaSemanal) * 100) + '%';
}