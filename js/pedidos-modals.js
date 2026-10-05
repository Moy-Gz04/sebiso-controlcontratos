// =========================================================
// pedidos-modals.js
// Modal de captura de un pedido nuevo y modal de edición de
// sus datos generales (producto, cantidad, proveedor, etc.).
// Ambos formularios usan los mismos "name" de campo, así que
// comparten la misma función de lectura.
// =========================================================

function leerDatosPedidoDeFormulario(form) {
  return {
    producto: form.producto.value.trim(),
    cantidad: Number(form.cantidad.value),
    unidadMedida: form.unidadMedida.value.trim(),
    proveedor: form.proveedor.value.trim(),
    areaSolicitante: form.areaSolicitante.value.trim(),
    descripcion: form.descripcion.value.trim(),
    montoEstimado: Number(form.montoEstimado.value || 0),
    fechaSolicitud: form.fechaSolicitud.value
  };
}

// ---------- Nuevo pedido ----------

document.getElementById('btn-nuevo-pedido').addEventListener('click', () => {
  const form = document.getElementById('form-nuevo-pedido');
  form.reset();
  form.fechaSolicitud.value = new Date().toISOString().slice(0, 10);
  form.querySelector('[data-nombre-archivo]').textContent = 'Toca para elegir el contrato';
  abrirModal('modal-nuevo-pedido');
});

document.getElementById('btn-cerrar-modal-pedido').addEventListener('click', () => cerrarModal('modal-nuevo-pedido'));

document.getElementById('form-nuevo-pedido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const archivo = form.archivoContrato.files[0];
  if (archivo && archivo.size > MAX_CONTRATO_MB * 1024 * 1024) {
    mostrarAviso(`El archivo pesa más de ${MAX_CONTRATO_MB} MB.`, true);
    return;
  }
  const boton = form.querySelector('button[type="submit"]');
  boton.disabled = true;
  boton.textContent = 'Guardando…';
  try {
    const pedido = await StorePedidos.crear(leerDatosPedidoDeFormulario(form));
    let aviso = 'Contrato registrado con su archivo.';
    if (archivo) {
      try { await StorePedidos.subirContrato(pedido.id, archivo); }
      catch (err) { aviso = 'Contrato registrado, pero el archivo no se subió: ' + err.message + ' Súbelo desde el detalle.'; }
    }
    cerrarModal('modal-nuevo-pedido');
    tarjetasPedidoExpandidas.add(pedido.id);
    await renderListadoPedidos();
    mostrarAviso(aviso, aviso.includes('no se subió'));
  } catch (err) {
    mostrarAviso(err.message, true);
  } finally {
    boton.disabled = false;
    boton.textContent = 'Registrar contrato';
  }
});

// ---------- Editar datos del pedido ----------

document.getElementById('btn-cerrar-modal-editar-pedido').addEventListener('click', () => cerrarModal('modal-editar-pedido'));

document.getElementById('form-editar-pedido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = Number(form.dataset.pedidoId);
  try {
    await StorePedidos.actualizarDatos(id, leerDatosPedidoDeFormulario(form));
    cerrarModal('modal-editar-pedido');
    await renderListadoPedidos();
    mostrarAviso('Datos del contrato actualizados.');
  } catch (err) { mostrarAviso(err.message, true); }
});
// Muestra el nombre del archivo elegido en la zona de carga
document.getElementById('nuevo-contrato-archivo').addEventListener('change', (e) => {
  const archivo = e.target.files[0];
  e.target.closest('.zona-archivo').querySelector('[data-nombre-archivo]').textContent =
    archivo ? archivo.name : 'Toca para elegir el contrato';
});
