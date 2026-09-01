import { db } from './config.js';

// ===================== CONJETURAS FULL =====================
export async function actualizarConjeturasFull() {
  const wrap = document.getElementById('listaConjeturasFull');
  if (!wrap) return;

  const conjs = await db.conjeturas.orderBy('timestamp').reverse().limit(100).toArray();
  if (!conjs.length) {
    wrap.innerHTML = 'Sin conjeturas.';
    return;
  }

  let html = '<table><tr><th>Conjetura</th><th>Materia</th><th>Ejercicio</th><th>Subtema</th><th>Fecha</th></tr>';
  conjs.forEach(c => {
    const d = new Date(c.timestamp);
    html += `<tr><td>${c.texto}</td><td>${c.materia || ''}</td><td>${c.problema_num || ''}</td><td>${c.subtema_id || ''}</td><td>${d.toLocaleString()}</td></tr>`;
  });
  html += '</table>';
  wrap.innerHTML = html;
}