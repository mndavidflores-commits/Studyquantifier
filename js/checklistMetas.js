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