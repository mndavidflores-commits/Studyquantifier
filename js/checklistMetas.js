import { db, state } from './config.js';
import { guardarLocalYOutbox, syncAll } from './sync.js';
import { hoyLocal, fechaLocale } from './utils.js';

// ===================== CHECKLIST JERÁRQUICO =====================
export async function actualizarChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;

  try {
    const completados = await db.checklist_completo.toArray();
    const completadosMap = new Map();
    completados.forEach(c => {
      const key = `${c.tipo}:${c.subtema_id || ''}:${c.libro || ''}:${c.capitulo || ''}`;
      completadosMap.set(key, c);
    });

    function formatearCapitulo(capitulo) {
      const texto = String(capitulo);
      if (/^\d+$/.test(texto)) return `Capítulo ${texto}`;
      if (/^\d+:\s*(.+)/.test(texto) || /^\d+\s+(.+)/.test(texto)) return `Capítulo ${texto}`;
      return texto;
    }

    let total = 0;
    let completadosCount = 0;
    const fragment = document.createDocumentFragment();
    const materias = [...new Set(state.currentTemario.map(t => t.materia))];

    for (const materia of materias) {
      const tems = state.currentTemario.filter(t => t.materia === materia);
      if (!tems.length) continue;

      const materiaDiv = document.createElement('div');
      materiaDiv.textContent = materia;
      materiaDiv.style.fontWeight = 'bold';
      materiaDiv.style.fontSize = '1.3rem';
      materiaDiv.style.marginTop = '10px';
      materiaDiv.style.paddingBottom = '4px';
      materiaDiv.style.borderBottom = '1px solid var(--border)';
      materiaDiv.style.color = '#fff';
      fragment.appendChild(materiaDiv);

      for (const tema of tems) {
        const subtemaId = (tema.id != null ? tema.id.toString() : 'sin-id');
        const subtemaName = tema.nombre || `Subtema ${subtemaId}`;

        const labelSubtema = document.createElement('label');
        labelSubtema.style.display = 'flex';
        labelSubtema.style.alignItems = 'center';
        labelSubtema.style.gap = '8px';
        labelSubtema.style.padding = '8px 0';
        labelSubtema.style.borderBottom = '1px solid var(--border)';
        labelSubtema.style.fontSize = '1.2rem';
        labelSubtema.style.fontFamily = 'var(--mono)';
        labelSubtema.style.color = 'var(--text)';

        const inputSubtema = document.createElement('input');
        inputSubtema.type = 'checkbox';
        inputSubtema.className = 'checklist-cb-new';
        inputSubtema.dataset.tipo = 'subtema';
        inputSubtema.dataset.materia = materia;
        inputSubtema.dataset.subtema = subtemaId;
        inputSubtema.style.width = '20px';
        inputSubtema.style.height = '20px';
        inputSubtema.style.accentColor = 'var(--accent)';
        const keySubtema = `subtema:${subtemaId}::`;
        if (completadosMap.has(keySubtema)) {
          inputSubtema.checked = true;
          completadosCount++;
        }
        total++;
        labelSubtema.appendChild(inputSubtema);
        labelSubtema.appendChild(document.createTextNode(subtemaName));
        fragment.appendChild(labelSubtema);

        const libros = Array.isArray(tema.libros) ? tema.libros : [];
        for (const libro of libros) {
          const libroNombre = typeof libro === 'string' ? libro : (libro.nombre || 'Libro sin nombre');
          const capitulos = (libro && Array.isArray(libro.capitulos)) ? libro.capitulos : [];

          const labelLibro = document.createElement('label');
          labelLibro.style.display = 'flex';
          labelLibro.style.alignItems = 'center';
          labelLibro.style.gap = '8px';
          labelLibro.style.padding = '8px 0';
          labelLibro.style.paddingLeft = '20px';
          labelLibro.style.borderBottom = '1px solid var(--border)';
          labelLibro.style.fontSize = '1.2rem';
          labelLibro.style.fontFamily = 'var(--mono)';
          labelLibro.style.color = 'var(--text)';

          const inputLibro = document.createElement('input');
          inputLibro.type = 'checkbox';
          inputLibro.className = 'checklist-cb-new';
          inputLibro.dataset.tipo = 'libro';
          inputLibro.dataset.materia = materia;
          inputLibro.dataset.subtema = subtemaId;
          inputLibro.dataset.libro = libroNombre;
          inputLibro.style.width = '20px';
          inputLibro.style.height = '20px';
          inputLibro.style.accentColor = 'var(--accent)';
          const keyLibro = `libro:${subtemaId}:${libroNombre}:`;
          if (completadosMap.has(keyLibro)) {
            inputLibro.checked = true;
            completadosCount++;
          }
          total++;
          labelLibro.appendChild(inputLibro);
          labelLibro.appendChild(document.createTextNode('📖 ' + libroNombre));
          fragment.appendChild(labelLibro);

          for (const capitulo of capitulos) {
            const capituloFormateado = formatearCapitulo(capitulo);
            const labelCapitulo = document.createElement('label');
            labelCapitulo.style.display = 'flex';
            labelCapitulo.style.alignItems = 'center';
            labelCapitulo.style.gap = '8px';
            labelCapitulo.style.padding = '8px 0';
            labelCapitulo.style.paddingLeft = '40px';
            labelCapitulo.style.borderBottom = '1px solid var(--border)';
            labelCapitulo.style.fontSize = '1.2rem';
            labelCapitulo.style.fontFamily = 'var(--mono)';
            labelCapitulo.style.color = 'var(--text)';

            const inputCapitulo = document.createElement('input');
            inputCapitulo.type = 'checkbox';
            inputCapitulo.className = 'checklist-cb-new';
            inputCapitulo.dataset.tipo = 'capitulo';
            inputCapitulo.dataset.materia = materia;
            inputCapitulo.dataset.subtema = subtemaId;
            inputCapitulo.dataset.libro = libroNombre;
            inputCapitulo.dataset.capitulo = capitulo;
            inputCapitulo.style.width = '20px';
            inputCapitulo.style.height = '20px';
            inputCapitulo.style.accentColor = 'var(--accent)';
            const keyCapitulo = `capitulo:${subtemaId}:${libroNombre}:${capitulo}`;
            if (completadosMap.has(keyCapitulo)) {
              inputCapitulo.checked = true;
              completadosCount++;
            }
            total++;
            labelCapitulo.appendChild(inputCapitulo);
            labelCapitulo.appendChild(document.createTextNode(capituloFormateado));
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
  } catch (error) {
    console.error('Error en actualizarChecklist:', error);
    container.innerHTML = '<p style="color:var(--text2);">Error al cargar el checklist.</p>';
  }
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