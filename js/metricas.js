import { db, state } from './config.js';
import { formatTime, formatHMS, hoyLocal, fechaLocale } from './utils.js';
import { generarHeatmap, generarGraficoProblemas, generarGraficoFSRS, generarGraficoBarrasDiarias, generarGraficoHorasSemana } from './graficos.js';

// ===================== MÉTRICAS GENERALES =====================
export async function actualizarMetricas() {
  const problemas = await db.sessions.where('tipo').equals('problema').toArray();
  const bien = problemas.filter(s => s.resultado === 'bien').length;
  const mal = problemas.filter(s => s.resultado === 'mal').length;
  const total = problemas.length;
  const tiempoTotal = problemas.reduce((a, s) => a + (s.tiempo_s || 0), 0);
  const conjeturasTotal = await db.conjeturas.count();
  const conjPorMin = tiempoTotal ? (conjeturasTotal / (tiempoTotal / 60)).toFixed(2) : '0';

  const mg = document.getElementById('metricasGenerales');
  if (mg) {
    mg.innerHTML = `
      <span>Tasa aciertos: ${bien + mal > 0 ? Math.round(bien / (bien + mal) * 100) : 0}%</span>
      <span>Tiempo prom: ${total ? formatTime(tiempoTotal / total) : '-'}</span>
      <span>Conjeturas/min: ${conjPorMin}</span>
      <span>Total: ${total}</span>
    `;
  }

  if (document.getElementById('chartTiempoMateria')) {
    if (state.chartTiempo) state.chartTiempo.destroy();
    const ctxBar = document.getElementById('chartTiempoMateria').getContext('2d');
    const mats = {};
    problemas.forEach(s => {
      if (!mats[s.materia]) mats[s.materia] = { total: 0, count: 0 };
      mats[s.materia].total += (s.tiempo_s || 0);
      mats[s.materia].count++;
    });
    const labels = Object.keys(mats);
    const data = labels.map(m => mats[m].count ? Math.round(mats[m].total / mats[m].count) : 0);
    state.chartTiempo = new Chart(ctxBar, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Tiempo prom (s)', data, backgroundColor: 'rgba(202,71,84,0.6)' }] },
      options: { responsive: true, scales: { y: { beginAtZero: true } } }
    });
  }

  if (document.getElementById('chartRadar')) {
    if (state.chartRadar) state.chartRadar.destroy();
    const ctxRadar = document.getElementById('chartRadar').getContext('2d');
    const velocidad = total ? Math.min(100, Math.round((total / (tiempoTotal / 60)) * 10)) : 0;
    const precision = bien + mal > 0 ? Math.round(bien / (bien + mal) * 100) : 0;
    const retencion = problemas.filter(s => s.modo === 'B' && s.resultado === 'bien').length / (problemas.filter(s => s.modo === 'B').length || 1) * 100;
    const consolidacion = total ? problemas.filter(s => s.modo === 'B').length / total * 100 : 0;
    const generacionC = total ? problemas.filter(s => s.modo === 'C').length / total * 100 : 0;
    state.chartRadar = new Chart(ctxRadar, {
      type: 'radar',
      data: {
        labels: ['Velocidad', 'Precisión', 'Retención', 'Consolidación', 'Generación C'],
        datasets: [{ data: [velocidad, precision, retencion, consolidacion, generacionC], backgroundColor: 'rgba(202,71,84,0.2)', borderColor: '#ca4754' }]
      },
      options: { scales: { r: { beginAtZero: true, max: 100 } } }
    });
  }

  if (document.getElementById('chartEvolucion')) {
    if (state.chartEvolucion) state.chartEvolucion.destroy();
    const ctxLine = document.getElementById('chartEvolucion').getContext('2d');
    const dias = {};
    problemas.forEach(s => {
      const dia = s.fecha || fechaLocale(s.timestamp);
      if (!dias[dia]) dias[dia] = { bien: 0, mal: 0 };
      if (s.resultado === 'bien') dias[dia].bien++;
      else if (s.resultado === 'mal') dias[dia].mal++;
    });
    const sorted = Object.keys(dias).sort();
    const data = sorted.map(d => {
      const b = dias[d].bien, m = dias[d].mal;
      return b + m > 0 ? Math.round(b / (b + m) * 100) : null;
    });
    state.chartEvolucion = new Chart(ctxLine, {
      type: 'line',
      data: { labels: sorted, datasets: [{ label: 'Tasa aciertos %', data, borderColor: '#ca4754' }] },
      options: { responsive: true }
    });
  }
}

export async function actualizarPanelMetricas() {
  const sesiones = await db.sessions.toArray();
  const conjeturas = await db.conjeturas.toArray();
  const repasos = await db.repasos.toArray();

  if (sesiones.length > 0) {
    const primeraSesion = sesiones.reduce((min, s) =>
      new Date(s.timestamp || s.fecha) < new Date(min.timestamp || min.fecha) ? s : min
    );
    const fecha = new Date(primeraSesion.timestamp || primeraSesion.fecha);
    document.getElementById('fechaRegistro').textContent = fecha.toLocaleDateString();
  } else {
    document.getElementById('fechaRegistro').textContent = 'Sin datos';
  }

  const diasEstudiados = new Set(sesiones.map(s => s.fecha || fechaLocale(s.timestamp)));
  let racha = 0;
  let fechaActual = new Date();
  while (true) {
    const fechaStr = fechaLocale(fechaActual);
    if (diasEstudiados.has(fechaStr)) {
      racha++;
      fechaActual.setDate(fechaActual.getDate() - 1);
    } else {
      break;
    }
  }
  document.getElementById('rachaDias').textContent = racha;

  const totalSesiones = sesiones.filter(s => s.tipo === 'pomodoro').length;
  document.getElementById('totalSesiones').textContent = totalSesiones;

  const problemasA = sesiones.filter(s => s.tipo === 'problema' && s.modo === 'A');
  document.getElementById('totalProblemasA').textContent = problemasA.length;

  const tiempoTotalSegundos = sesiones
    .filter(s => s.tipo === 'pomodoro')
    .reduce((acc, s) => acc + (s.tiempo_pomodoro || 0), 0);
  document.getElementById('tiempoTotalEstudio').textContent = formatHMS(tiempoTotalSegundos);

  const bienGeneral = sesiones.filter(s => s.tipo === 'problema' && s.resultado === 'bien').length;
  const malGeneral = sesiones.filter(s => s.tipo === 'problema' && s.resultado === 'mal').length;
  const noResueltosGeneral = sesiones.filter(s => s.tipo === 'problema' && s.resultado === 'no_resuelto').length;
  document.getElementById('totalBienGeneral').textContent = bienGeneral;
  document.getElementById('totalMalGeneral').textContent = malGeneral;
  document.getElementById('totalNoResueltosGeneral').textContent = noResueltosGeneral;

  document.getElementById('totalRecall').textContent = repasos.length;

  document.getElementById('totalConjeturasGeneral').textContent = conjeturas.length;

  const hoy = hoyLocal();
  const sesionesHoy = sesiones.filter(s => s.tipo === 'pomodoro' && (s.fecha || fechaLocale(s.timestamp)) === hoy);
  const horasHoy = sesionesHoy.reduce((acc, s) => acc + (s.tiempo_pomodoro || 0), 0) / 3600;
  document.getElementById('horasHoy').textContent = horasHoy.toFixed(1) + ' h';

  const nivelPorcentaje = Math.min(100, Math.round(tiempoTotalSegundos / 3600 / 100 * 100));
  document.getElementById('nivelProgreso').style.width = nivelPorcentaje + '%';

  await generarHeatmap(sesiones);

  if (document.getElementById('chartProblemas')) await generarGraficoProblemas();
  if (document.getElementById('chartFSRS')) await generarGraficoFSRS();
  if (document.getElementById('chartBarrasDiarias')) await generarGraficoBarrasDiarias();
  if (document.getElementById('chartHorasSemana')) await generarGraficoHorasSemana();
}