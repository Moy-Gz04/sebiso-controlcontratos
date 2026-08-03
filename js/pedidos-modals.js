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
  abrirModal('modal-nuevo-pedido');
});

document.getElementById('btn-cerrar-modal-pedido').addEventListener('click', () => cerrarModal('modal-nuevo-pedido'));

document.getElementById('form-nuevo-pedido').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  try {
    const pedido = await StorePedidos.crear(leerDatosPedidoDeFormulario(form));
    cerrarModal('modal-nuevo-pedido');
    tarjetasPedidoExpandidas.add(pedido.id);
    await renderListadoPedidos();
    mostrarAviso('Pedido registrado.');
  } catch (err) {
    mostrarAviso(err.message, true);
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
    mostrarAviso('Datos del pedido actualizados.');
  } catch (err) { mostrarAviso(err.message, true); }
});