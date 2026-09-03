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
      materiaDiv.className = 'checklist-materia';
      materiaDiv.textContent = materia;
      materiaDiv.style.fontWeight = 'bold';
      materiaDiv.style.marginTop = '10px';
      materiaDiv.style.color = '#fff';
      fragment.appendChild(materiaDiv);

      for (const tema of tems) {
        const subtemaId = (tema.id != null ? tema.id.toString() : 'sin-id');
        const subtemaName = tema.nombre || `Subtema ${subtemaId}`;

        const labelSubtema = document.createElement('label');
        labelSubtema.style.display = 'flex';
        labelSubtema.style.alignItems = 'center';
        labelSubtema.style.gap = '6px';
        labelSubtema.style.marginBottom = '4px';

        const inputSubtema = document.createElement('input');
        inputSubtema.type = 'checkbox';
        inputSubtema.className = 'checklist-cb-new';
        inputSubtema.dataset.tipo = 'subtema';
        inputSubtema.dataset.materia = materia;
        inputSubtema.dataset.subtema = subtemaId;
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
          labelLibro.style.gap = '6px';
          labelLibro.style.marginLeft = '20px';
          labelLibro.style.marginBottom = '4px';

          const inputLibro = document.createElement('input');
          inputLibro.type = 'checkbox';
          inputLibro.className = 'checklist-cb-new';
          inputLibro.dataset.tipo = 'libro';
          inputLibro.dataset.materia = materia;
          inputLibro.dataset.subtema = subtemaId;
          inputLibro.dataset.libro = libroNombre;
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
            labelCapitulo.style.gap = '6px';
            labelCapitulo.style.marginLeft = '40px';
            labelCapitulo.style.marginBottom = '4px';

            const inputCapitulo = document.createElement('input');
            inputCapitulo.type = 'checkbox';
            inputCapitulo.className = 'checklist-cb-new';
            inputCapitulo.dataset.tipo = 'capitulo';
            inputCapitulo.dataset.materia = materia;
            inputCapitulo.dataset.subtema = subtemaId;
            inputCapitulo.dataset.libro = libroNombre;
            inputCapitulo.dataset.capitulo = capitulo;
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