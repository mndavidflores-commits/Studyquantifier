import { db, state } from './config.js';

let chartSuenoInst = null;

// ===================== GRÁFICO DE PROBLEMAS (SCATTER) =====================
export async function generarGraficoProblemas() {
  const ctx = document.getElementById('chartProblemas')?.getContext('2d');
  if (!ctx) return;

  if (state.chartProblemas) state.chartProblemas.destroy();

  const problemas = await db.sessions.where('tipo').equals('problema').toArray();
  const filtrados = problemas.filter(p => p.materia === state.materiaGraficoSeleccionada);
  filtrados.sort((a, b) => new Date(a.timestamp || a.fecha) - new Date(b.timestamp || b.fecha));

  const puntosA = filtrados.filter(p => p.modo === 'A');
  const puntosB = filtrados.filter(p => p.modo === 'B');

  function colorPorResultado(resultado) {
    if (resultado === 'bien') return '#3dd6c8';
    if (resultado === 'mal') return '#fa5c7c';
    if (resultado === 'no_resuelto') return '#5c7cfa';
    return '#ffffff';
  }

  const dataA = puntosA.map((p, index) => ({
    x: index + 1,
    y: (p.tiempo_s || 0) / 60,
    problema: p
  }));
  const dataB = puntosB.map((p, index) => ({
    x: index + 1,
    y: (p.tiempo_s || 0) / 60,
    problema: p
  }));

  const datasets = [];
  datasets.push({
    label: 'Sesión A',
    data: dataA,
    pointRadius: 3.5,
    pointHoverRadius: 5,
    pointBackgroundColor: dataA.map(d => colorPorResultado(d.problema.resultado)),
    pointBorderColor: '#323437',
    pointBorderWidth: 1,
    showLine: false,
    type: 'scatter'
  });

  if (state.mostrarPuntosB) {
    datasets.push({
      label: 'Sesión B',
      data: dataB,
      pointRadius: 3.5,
      pointHoverRadius: 5,
      pointBackgroundColor: 'transparent',
      pointBorderColor: dataB.map(d => colorPorResultado(d.problema.resultado)),
      pointBorderWidth: 2,
      showLine: false,
      type: 'scatter'
    });
  }

  const todos = [...filtrados];
  const promedios = [];
  if (todos.length > 0) {
    for (let i = 0; i < todos.length; i++) {
      const inicio = Math.max(0, i - 9);
      const subconjunto = todos.slice(inicio, i + 1);
      const sumaMinutos = subconjunto.reduce((acc, p) => acc + (p.tiempo_s || 0) / 60, 0);
      promedios.push({ x: i + 1, y: sumaMinutos / subconjunto.length });
    }
  }

  if (state.mostrarAvg10 && promedios.length > 0) {
    datasets.push({
      label: 'Avg 10',
      data: promedios,
      type: 'line',
      borderColor: '#ca4754',
      backgroundColor: 'transparent',
      borderWidth: 2.5,
      pointRadius: 0,
      tension: 0.35
    });
  }

  state.chartProblemas = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          backgroundColor: '#2c2e31',
          titleColor: '#d1d0c5',
          bodyColor: '#d1d0c5',
          borderColor: '#646669',
          borderWidth: 1,
          callbacks: {
            title: (items) => {
              if (!items.length) return '';
              const p = items[0].raw?.problema;
              return p ? `Problema #${p.problema_num || '?'}` : '';
            },
            label: (context) => {
              const p = context.raw?.problema;
              if (!p) return context.dataset.label === 'Avg 10' ? `Promedio: ${context.parsed.y.toFixed(1)} min` : `Tiempo: ${context.parsed.y.toFixed(1)} min`;
              const lineas = [`Tiempo: ${((p.tiempo_s || 0) / 60).toFixed(1)} min`, `Resultado: ${p.resultado}`];
              if (p.confianza) lineas.push(`Confianza: ${p.confianza}`);
              if (p.codigo_error) lineas.push(`Error: ${p.codigo_error}`);
              return lineas;
            }
          }
        },
        legend: { display: false }
      },
      scales: {
        x: {
          type: 'linear',
          title: { display: true, text: 'N.º de problema (secuencial)', color: '#646669' },
          ticks: {
            color: '#646669',
            stepSize: 1,
            callback: function(value) { return Number.isInteger(value) ? value : ''; }
          },
          grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
        },
        y: {
          title: { display: true, text: 'Minutos', color: '#646669' },
          beginAtZero: true,
          grace: '5%',
          ticks: { color: '#646669' },
          grid: { color: 'rgba(100,102,105,0.2)', borderDash: [2, 2] }
        }
      }
    }
  });
}

// ===================== GRÁFICO FSRS (EVOLUCIÓN DE MEMORIA) =====================
export async function generarGraficoFSRS() {
  const ctx = document.getElementById('chartFSRS')?.getContext('2d');
  if (!ctx) return;

  if (state.chartFSRS) state.chartFSRS.destroy();

  const repasos = await db.repasos.orderBy('fecha').toArray();
  if (repasos.length === 0) return;

  const porDia = {};
  repasos.forEach(r => {
    const dia = r.fecha?.split('T')[0] || new Date(r.fecha).toISOString().split('T')[0];
    if (!porDia[dia]) porDia[dia] = { estabilidadTotal: 0, dificultadTotal: 0, count: 0 };
    porDia[dia].estabilidadTotal += (r.estabilidad || 0);
    porDia[dia].dificultadTotal += (r.dificultad || 0);
    porDia[dia].count++;
  });

  const dias = Object.keys(porDia).sort();
  const estabilidadPromedio = dias.map(d => porDia[d].estabilidadTotal / porDia[d].count);
  const dificultadPromedio = dias.map(d => porDia[d].dificultadTotal / porDia[d].count);

  state.chartFSRS = new Chart(ctx, {
    type: 'line',
    data: {
      labels: dias,
      datasets: [
        {
          label: 'Estabilidad promedio',
          data: estabilidadPromedio,
          borderColor: '#ca4754',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3
        },
        {
          label: 'Dificultad promedio',
          data: dificultadPromedio,
          borderColor: '#646669',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 3,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
          labels: {
            color: '#d1d0c5',
            font: { family: 'Roboto Mono' }
          }
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

// ===================== HEATMAP =====================
export async function generarHeatmap(sesiones) {
  const container = document.getElementById('heatmapContainer');
  if (!container) return;

  const hoy = new Date();
  const inicio = new Date();
  inicio.setMonth(hoy.getMonth() - 11);
  inicio.setDate(1);

  const diasMap = new Map();
  sesiones.filter(s => s.tipo === 'pomodoro').forEach(s => {
    const fecha = s.fecha || new Date(s.timestamp).toISOString().split('T')[0];
    const horas = (s.tiempo_pomodoro || 0) / 3600;
    diasMap.set(fecha, (diasMap.get(fecha) || 0) + horas);
  });

  container.innerHTML = '';
  let fecha = new Date(inicio);
  while (fecha <= hoy) {
    const fechaStr = fecha.toISOString().split('T')[0];
    const horas = diasMap.get(fechaStr) || 0;
    const nivel = horas === 0 ? 0 : (horas <= 1 ? 1 : (horas <= 2 ? 2 : (horas <= 4 ? 3 : 4)));
    const div = document.createElement('div');
    div.className = 'heatmap-day';
    div.dataset.level = nivel;
    div.title = `${fechaStr}: ${horas.toFixed(1)}h`;
    container.appendChild(div);
    fecha.setDate(fecha.getDate() + 1);
  }
}

// ===================== GRÁFICO DE SUEÑO =====================
export async function actualizarGraficoSueno() {
  const ctx = document.getElementById('chartSueno')?.getContext('2d');
  if (!ctx) return;
  if (chartSuenoInst) chartSuenoInst.destroy();

  const registros = await db.sueno.orderBy('fecha').toArray();
  if (registros.length === 0) return;

  const labels = registros.map(r => r.fecha);
  const calidadData = registros.map(r => r.calidad);
  const acostarMin = registros.map(r => {
    if (!r.acostar) return null;
    const [h, m] = r.acostar.split(':').map(Number);
    return h * 60 + m;
  });
  const despertarMin = registros.map(r => {
    if (!r.despertar) return null;
    const [h, m] = r.despertar.split(':').map(Number);
    return h * 60 + m;
  });

  chartSuenoInst = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Calidad (0-10)', data: calidadData, borderColor: '#ca4754', backgroundColor: 'transparent', yAxisID: 'y', tension: 0.3, pointRadius: 4 },
        { label: 'Hora acostarse', data: acostarMin, borderColor: '#646669', backgroundColor: 'transparent', yAxisID: 'y1', tension: 0.3, pointRadius: 4 },
        { label: 'Hora despertar', data: despertarMin, borderColor: '#3dd6c8', backgroundColor: 'transparent', yAxisID: 'y1', tension: 0.3, pointRadius: 4 }
      ]
    },
    options: {
      responsive: true,
      scales: {
        y: { type: 'linear', display: true, position: 'left', min: 0, max: 10, title: { display: true, text: 'Calidad (0-10)', color: '#646669' } },
        y1: {
          type: 'linear', display: true, position: 'right', min: 0, max: 1440, title: { display: true, text: 'Minutos desde medianoche', color: '#646669' },
          ticks: {
            stepSize: 60,
            callback: function(value) {
              const totalMin = value;
              const h24 = Math.floor(totalMin / 60);
              const m = totalMin % 60;
              const ampm = h24 >= 12 ? 'PM' : 'AM';
              let h12 = h24 % 12;
              if (h12 === 0) h12 = 12;
              return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
            }
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) label += ': ';
              if (context.dataset.yAxisID === 'y1') {
                const mins = context.parsed.y;
                const h24 = Math.floor(mins / 60);
                const m = mins % 60;
                const ampm = h24 >= 12 ? 'PM' : 'AM';
                let h12 = h24 % 12;
                if (h12 === 0) h12 = 12;
                label += `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
              } else {
                label += context.parsed.y;
              }
              return label;
            }
          }
        }
      }
    }
  });
}

// ===================== EVENTOS DEL GRÁFICO =====================
document.addEventListener('click', (e) => {
  // Filtro de materia
  const filtroBtn = e.target.closest('.chart-filter-btn');
  if (filtroBtn) {
    document.querySelectorAll('.chart-filter-btn').forEach(b => b.classList.remove('active'));
    filtroBtn.classList.add('active');
    state.materiaGraficoSeleccionada = filtroBtn.dataset.materia;
    generarGraficoProblemas();
    return;
  }

  // Toggle Avg10
  const toggleAvg10 = e.target.closest('#toggleAvg10');
  if (toggleAvg10) {
    state.mostrarAvg10 = !state.mostrarAvg10;
    toggleAvg10.classList.toggle('active', state.mostrarAvg10);
    generarGraficoProblemas();
    return;
  }

  // Toggle Mostrar B
  const toggleMostrarB = e.target.closest('#toggleMostrarB');
  if (toggleMostrarB) {
    state.mostrarPuntosB = !state.mostrarPuntosB;
    toggleMostrarB.classList.toggle('active', state.mostrarPuntosB);
    generarGraficoProblemas();
    return;
  }
});
