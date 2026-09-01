import { supabase } from './config.js';
import { actualizarUI } from './app.js';
import './timer.js'; // Registra eventos de teclado, táctiles y botones de resultado

// ===================== AUTENTICACIÓN =====================
const { data: { session: s } } = await supabase.auth.getSession();
actualizarUI(s);

supabase.auth.onAuthStateChange((event, s) => actualizarUI(s));
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js');
}