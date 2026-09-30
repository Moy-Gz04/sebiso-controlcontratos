// =========================================================
// modals.js
// Todo lo relacionado a los modales: abrir/cerrar, la
// confirmación genérica, y los formularios que viven dentro
// de un modal (nuevo oficio, datos generales, registrar oficio).
// =========================================================

function abrirModal(id) { document.getElementById(id).classList.add('activo'); }
function cerrarModal(id) { document.getElementById(id).classList.remove('activo'); }

// ---------- Confirmación genérica (reemplaza confirm() nativo) ----------

let accionPendiente = null;

function pedirConfirmacion({ titulo, mensaje, textoConfirmar = 'Confirmar', peligro = false, accion }) {
  document.getElementById('confirmar-titulo').textContent = titulo;
  document.getElementById('confirmar-mensaje').textContent = mensaje;
  const btnAceptar = document.getElementById('btn-confirmar-aceptar');
  btnAceptar.textContent = textoConfirmar;
  btnAceptar.classList.toggle('btn-peligro', peligro);
  btnAceptar.classList.toggle('btn-primario', !peligro);
  accionPendiente = accion;
  abrirModal('modal-confirmar-accion');
}

document.getElementById('btn-confirmar-aceptar').addEventListener('click', () => {
  const accion = accionPendiente;
  accionPendiente = null;
  cerrarModal('modal-confirmar-accion');
  if (accion) accion();
});

document.getElementById('btn-confirmar-cancelar').addEventListener('click', () => {
  accionPendiente = null;
  cerrarModal('modal-confirmar-accion');
});
