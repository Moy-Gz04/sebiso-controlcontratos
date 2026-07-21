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

// ---------- Campos condicionales de "datos generales" ----------

function actualizarVisibilidadCampos(form) {
  const modo = form.modoFacturacion.value;
  const tieneAnticipo = form.tieneAnticipo.value === 'si';

  const campoPeriodos = form.querySelector('.campo-num-periodos');
  const campoAnticipo = form.querySelector('.campo-monto-anticipo');
  campoPeriodos.style.display = (modo === 'unico' || modo === '') ? 'none' : 'flex';
  campoAnticipo.style.display = tieneAnticipo ? 'flex' : 'none';

  const labelPeriodos = { mensual: 'mensualidades', bimestral: 'bimestres', trimestral: 'trimestres' };
  const label = form.querySelector('.label-num-periodos');
  if (label) label.textContent = `Número de ${labelPeriodos[modo] || 'periodos'}`;
}

const formEditarGenerales = document.getElementById('form-editar-generales');
formEditarGenerales.modoFacturacion.addEventListener('change', () => actualizarVisibilidadCampos(formEditarGenerales));
formEditarGenerales.tieneAnticipo.addEventListener('change', () => actualizarVisibilidadCampos(formEditarGenerales));

function leerDatosGeneralesDeFormulario(form) {
  const modoFacturacion = form.modoFacturacion.value;
  return {
    noContrato: form.noContrato.value.trim(),
    noRequisicion: form.noRequisicion.value.trim(),
    fecha: form.fecha.value,
    proveedor: form.proveedor.value.trim(),
    descripcion: form.descripcion.value.trim(),
    modoFacturacion,
    numPeriodos: modoFacturacion === 'unico' ? 1 : Number(form.numPeriodos.value),
    tieneAnticipo: form.tieneAnticipo.value === 'si',
    montoAnticipo: form.tieneAnticipo.value === 'si' ? Number(form.montoAnticipo.value) : 0
  };
}

// ---------- Modal: nuevo contrato (oficio inicial) ----------

document.getElementById('btn-nuevo-contrato').addEventListener('click', () => {
  document.getElementById('form-nuevo-oficio').reset();
  abrirModal('modal-nuevo-oficio');
});

document.getElementById('btn-cerrar-modal-oficio').addEventListener('click', () => cerrarModal('modal-nuevo-oficio'));

document.getElementById('form-nuevo-oficio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const folioOficio = document.getElementById('nuevo-oficio-folio').value.trim();
  const montoOficio = document.getElementById('nuevo-oficio-monto').value;
  const fechaOficio = document.getElementById('nuevo-oficio-fecha').value;

  try {
    const contrato = await Store.crearContratoInicial({ folioOficio, montoOficio, fechaOficio });
    cerrarModal('modal-nuevo-oficio');
    tarjetasExpandidas.add(contrato.id);
    await renderListadoContratos();
    mostrarAviso('Oficio registrado. Completa los datos generales cuando los tengas.');
  } catch (err) {
    mostrarAviso(err.message, true);
  }
});

// ---------- Modal: editar / registrar datos generales ----------

document.getElementById('btn-cerrar-modal-editar-generales').addEventListener('click', () => cerrarModal('modal-editar-generales'));

document.getElementById('form-editar-generales').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = Number(form.dataset.contratoId);
  try {
    await Store.guardarDatosGenerales(id, leerDatosGeneralesDeFormulario(form));
    cerrarModal('modal-editar-generales');
    tarjetasExpandidas.add(id);
    await renderListadoContratos();
    mostrarAviso('Datos generales actualizados.');
  } catch (err) { mostrarAviso(err.message, true); }
});

// ---------- Modal: registrar oficio (ampliación / cancelación) ----------

document.getElementById('btn-cerrar-modal-registrar-oficio').addEventListener('click', () => cerrarModal('modal-registrar-oficio'));

document.getElementById('form-modal-oficio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = Number(form.dataset.contratoId);
  try {
    await Store.agregarOficio(id, {
      tipo: form.tipo.value,
      folio: form.folio.value.trim(),
      monto: form.monto.value,
      fecha: form.fecha.value
    });
    cerrarModal('modal-registrar-oficio');
    tarjetasExpandidas.add(id);
    await renderListadoContratos();
    mostrarAviso('Oficio agregado.');
  } catch (err) { mostrarAviso(err.message, true); }
});