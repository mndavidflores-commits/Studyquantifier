import { db, state } from './config.js';
import { formatTime, formatHMS, hoyLocal, fechaLocale } from './utils.js';
import { generarHeatmap, generarGraficoProblemas, generarGraficoFSRS } from './graficos.js';

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
}