import { db, state } from './config.js';
import { hoyLocal, fechaLocale, formatHMS, formatTime } from './utils.js';

let chartComparativaInst = null;

// ===================== CARGAR MATERIAS EN SELECTOR =====================
export async function cargarMateriasComparativa() {
  const sel = document.getElementById('comparativaMateria');
  if (!sel) return;

  const matsTem = [...new Set(state.currentTemario.map(t => t.materia))];
  const matsDB = await db.materias.toArray();
  const todas = [...new Set([...matsTem, ...matsDB.map(m => m.nombre)])];

  const actual = sel.value || 'Todas';
  sel.innerHTML = '<option value="Todas">Todas</option>';
  todas.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    sel.appendChild(opt);
  });
  sel.value = actual;
}

// ===================== OBTENER RESUMEN DE UN DÍA =====================
async function calcularResumenDia(fecha, materiaFiltro = 'Todas') {
  const sesionesPomodoro = await db.sessions.where('tipo').equals('pomodoro').toArray();
  const problemas = await db.sessions.where('tipo').equals('problema').toArray();
  const conjeturas = await db.conjeturas.toArray();

  const sesionesDia = sesionesPomodoro.filter(s => (s.fecha || fechaLocale(s.timestamp)) === fecha);
  const problemasDia = problemas.filter(p => (p.fecha || fechaLocale(p.timestamp)) === fecha);
  const conjeturasDia = conjeturas.filter(c => c.fecha === fecha);

  const filtrarMateria = (item) => {
    if (materiaFiltro === 'Todas') return true;
    return item.materia === materiaFiltro;
  };

  const sesionesFiltradas = sesionesDia.filter(filtrarMateria);
  const problemasFiltrados = problemasDia.filter(filtrarMateria);
  const conjeturasFiltradas = conjeturasDia.filter(filtrarMateria);

  const tiempoTotal = sesionesFiltradas.reduce((a, s) => a + (s.tiempo_pomodoro || 0), 0);
  const totalProblemas = problemasFiltrados.length;
  const bien = problemasFiltrados.filter(p => p.resultado === 'bien').length;
  const mal = problemasFiltrados.filter(p => p.resultado === 'mal').length;
  const noResueltos = problemasFiltrados.filter(p => p.resultado === 'no_resuelto').length;
  const distracciones = sesionesFiltradas.reduce((a, s) => a + (s.resumen_distracciones || 0), 0);

  const porMateria = {};

  sesionesFiltradas.forEach(s => {
    const m = s.materia || 'Sin materia';
    if (!porMateria[m]) porMateria[m] = { horas: 0, ejercicios: 0, sesiones: 0 };
    porMateria[m].horas += (s.tiempo_pomodoro || 0) / 3600;
    porMateria[m].sesiones += 1;
  });

  problemasFiltrados.forEach(p => {
    const m = p.materia || 'Sin materia';
    if (!porMateria[m]) porMateria[m] = { horas: 0, ejercicios: 0, sesiones: 0 };
    porMateria[m].ejercicios += 1;
  });

  return {
    fecha,
    sesiones: sesionesFiltradas.length,
    tiempoTotal,
    totalProblemas,
    bien,
    mal,
    noResueltos,
    conjeturas: conjeturasFiltradas.length,
    distracciones,
    porMateria
  };
}

function formatearResumen(resumen) {
  const tiempo = formatHMS(resumen.tiempoTotal || 0);
  let html = `
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;">
      <div><strong>Problemas:</strong> ${resumen.totalProblemas}</div>
      <div><strong>Bien:</strong> ${resumen.bien}</div>
      <div><strong>Mal:</strong> ${resumen.mal}</div>
      <div><strong>No resueltos:</strong> ${resumen.noResueltos}</div>
      <div><strong>Sesiones:</strong> ${resumen.sesiones}</div>
      <div><strong>Tiempo:</strong> ${tiempo}</div>
      <div><strong>Conjeturas:</strong> ${resumen.conjeturas}</div>
      <div><strong>Distracciones:</strong> ${resumen.distracciones}</div>
    </div>
  `;

  const materias = Object.entries(resumen.porMateria);
  if (materias.length > 0) {
    html += `
      <table style="margin-top:10px; width:100%;">
        <tr><th>Materia</th><th>Horas</th><th>Ejercicios</th><th>Sesiones</th></tr>
        ${materias.map(([m, d]) => `
          <tr>
            <td>${m}</td>
            <td>${d.horas.toFixed(2)} h</td>
            <td>${d.ejercicios}</td>
            <td>${d.sesiones}</td>
          </tr>
        `).join('')}
      </table>
    `;
  }

  return html;
}

// ===================== SECCIÓN HOY =====================
async function renderHoy() {
  const cont = document.getElementById('comparativaHoy');
  if (!cont) return;
  const resumen = await calcularResumenDia(hoyLocal(), document.getElementById('comparativaMateria').value);
  cont.innerHTML = formatearResumen(resumen);
}

// ===================== SECCIÓN DÍA SELECCIONADO =====================
async function renderDiaSeleccionado() {
  const cont = document.getElementById('comparativaDia');
  if (!cont) return;
  const fecha = document.getElementById('comparativaFecha').value;
  if (!fecha) {
    cont.innerHTML = '<p style="color:var(--text2);">Selecciona una fecha.</p>';
    return;
  }
  const resumen = await calcularResumenDia(fecha, document.getElementById('comparativaMateria').value);
  cont.innerHTML = formatearResumen(resumen);
  await generarGraficoComparativa(fecha, document.getElementById('comparativaMateria').value);
}

// ===================== GRÁFICO COMPARATIVA =====================
async function generarGraficoComparativa(fechaSeleccionada, materiaFiltro = 'Todas') {
  const ctx = document.getElementById('comparativaChartDia')?.getContext('2d');
  if (!ctx) return;

  const fechas = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(fechaSeleccionada + 'T00:00:00');
    d.setDate(d.getDate() - i);
    fechas.push(fechaLocale(d));
  }

  const horas = [];
  const ejercicios = [];
  for (const f of fechas) {
    const resumen = await calcularResumenDia(f, materiaFiltro);
    horas.push(Number((resumen.tiempoTotal / 3600).toFixed(2)));
    ejercicios.push(resumen.totalProblemas);
  }

  const labels = fechas.map(f => f.slice(5)); // MM-DD

  if (chartComparativaInst) {
    chartComparativaInst.data.labels = labels;
    chartComparativaInst.data.datasets[0].data = horas;
    chartComparativaInst.data.datasets[1].data = ejercicios;
    chartComparativaInst.update();
  } else {
    chartComparativaInst = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Horas',
            data: horas,
            backgroundColor: '#ca4754',
            hoverBackgroundColor: '#e06c78',
            borderColor: '#ca4754',
            borderWidth: 1,
            borderRadius: 2
          },
          {
            label: 'Ejercicios',
            data: ejercicios,
            backgroundColor: '#3dd6c8',
            hoverBackgroundColor: '#5fe0d4',
            borderColor: '#3dd6c8',
            borderWidth: 1,
            borderRadius: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          tooltip: {
            backgroundColor: '#2c2e31',
            titleColor: '#d1d0c5',
            bodyColor: '#d1d0c5',
            borderColor: '#646669',
            borderWidth: 1
          },
          legend: {
            display: true,
            labels: { color: '#d1d0c5' }
          }
        },
        scales: {
          x: {
            ticks: { color: '#646669' },
            grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
          },
          y: {
            ticks: { color: '#646669' },
            grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
          }
        }
      }
    });
  }
}

// ===================== SECCIÓN SEMANA =====================
async function renderSemana() {
  const cont = document.getElementById('comparativaSemanaResumen');
  if (!cont) return;

  const semanaInput = document.getElementById('comparativaSemana').value;
  let inicio, fin;

  if (semanaInput) {
    const [anio, semana] = semanaInput.split('-W');
    const primerDia = new Date(anio, 0, 1);
    const diasHastaLunes = (primerDia.getDay() + 6) % 7;
    primerDia.setDate(primerDia.getDate() - diasHastaLunes + (semana - 1) * 7);
    inicio = new Date(primerDia);
    fin = new Date(primerDia);
    fin.setDate(fin.getDate() + 6);
  } else {
    inicio = new Date();
    inicio.setDate(inicio.getDate() - ((inicio.getDay() + 6) % 7));
    fin = new Date(inicio);
    fin.setDate(fin.getDate() + 6);
  }

  const fechaInicio = fechaLocale(inicio);
  const fechaFin = fechaLocale(fin);

  const sesionesPomodoro = await db.sessions.where('tipo').equals('pomodoro').toArray();
  const problemas = await db.sessions.where('tipo').equals('problema').toArray();

  const materiaFiltro = document.getElementById('comparativaMateria').value;

  const filtrar = (s) => {
    const f = s.fecha || fechaLocale(s.timestamp);
    return f >= fechaInicio && f <= fechaFin && (materiaFiltro === 'Todas' || s.materia === materiaFiltro);
  };

  const sesionesSemana = sesionesPomodoro.filter(filtrar);
  const problemasSemana = problemas.filter(filtrar);

  const porMateria = {};

  sesionesSemana.forEach(s => {
    const m = s.materia || 'Sin materia';
    if (!porMateria[m]) porMateria[m] = { horas: 0, ejercicios: 0 };
    porMateria[m].horas += (s.tiempo_pomodoro || 0) / 3600;
  });

  problemasSemana.forEach(p => {
    const m = p.materia || 'Sin materia';
    if (!porMateria[m]) porMateria[m] = { horas: 0, ejercicios: 0 };
    porMateria[m].ejercicios += 1;
  });

  const totalHoras = Object.values(porMateria).reduce((a, d) => a + d.horas, 0);
  const totalEjercicios = Object.values(porMateria).reduce((a, d) => a + d.ejercicios, 0);

  let html = `<p>Semana del ${fechaInicio} al ${fechaFin}</p>`;
  html += `<table style="width:100%;">
    <tr><th>Materia</th><th>Horas</th><th>Ejercicios</th></tr>
    ${Object.entries(porMateria).map(([m, d]) => `
      <tr><td>${m}</td><td>${d.horas.toFixed(2)} h</td><td>${d.ejercicios}</td></tr>
    `).join('')}
    <tr style="font-weight:bold;"><td>Total</td><td>${totalHoras.toFixed(2)} h</td><td>${totalEjercicios}</td></tr>
  </table>`;

  cont.innerHTML = html;
}

// ===================== ACTUALIZAR PANEL COMPARATIVA =====================
export async function actualizarComparativa() {
  await cargarMateriasComparativa();
  await renderHoy();
  await renderDiaSeleccionado();
  await renderSemana();
}