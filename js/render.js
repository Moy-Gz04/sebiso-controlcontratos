// =========================================================
// render.js
// Todo lo que genera HTML y controla qué pantalla se ve
// para el módulo de CONTRATOS.
// =========================================================

const fmtMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fmtFecha = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const ETIQUETA_TIPO_OFICIO = {
  inicial: 'Oficio inicial',
  ampliacion: 'Ampliación',
  cancelacion: 'Cancelación'
};

const ETIQUETA_ESTATUS = {
  oficio_capturado: 'Oficio capturado',
  en_facturacion: 'En facturación',
  completado: 'Completado'
};

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
  document.getElementById(id).classList.add('activa');
}

let avisoTimeout;
function mostrarAviso(texto, esError = false) {
  const aviso = document.getElementById('aviso-flotante');
  aviso.textContent = texto;
  aviso.classList.toggle('error', esError);
  aviso.classList.add('visible');
  clearTimeout(avisoTimeout);
  avisoTimeout = setTimeout(() => aviso.classList.remove('visible'), esError ? 4000 : 2200);
}
