// =========================================================
// pedidos-state.js
// Capa de datos de PEDIDOS. Reutiliza peticion() y la sesión
// ya definidas en state.js (se carga después en index.html).
// =========================================================

const ORDEN_PASOS_PEDIDO = [
  'pedido_creado', 'entregado', 'oficio_registrado',
  'factura_recibida', 'en_contabilidad', 'en_pago', 'pagado'
];

function calcularMontoDisponiblePedido(pedido) {
  if (!pedido.oficio) return null; // aún no hay monto formal, solo el estimado
  const ajustes = pedido.oficios.reduce((total, of) => {
    return of.tipo === 'cancelacion' ? total - Number(of.monto) : total + Number(of.monto);
  }, 0);
  return pedido.oficio.monto + ajustes;
}

const MAX_CONTRATO_MB = 15;

function archivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result).split(',')[1]);
    lector.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    lector.readAsDataURL(archivo);
  });
}

const StorePedidos = {
  // Sube (o reemplaza) el archivo del contrato: PDF, Word o imagen
  async subirContrato(id, archivo) {
    if (archivo.size > MAX_CONTRATO_MB * 1024 * 1024) throw new Error(`El archivo pesa más de ${MAX_CONTRATO_MB} MB.`);
    const base64 = await archivoABase64(archivo);
    const datos = await peticion(`/pedidos/${id}/contrato`, {
      method: 'PUT',
      body: JSON.stringify({ nombre: archivo.name, mime: archivo.type || 'application/octet-stream', base64 })
    });
    return datos.pedido;
  },

  // Abre el contrato en otra pestaña (se pide con el token de la sesión)
  async abrirContrato(id) {
    const ventana = window.open('', '_blank');   // se abre ya, para que el navegador no la bloquee
    try {
      const resp = await fetch(`${API_BASE_URL}/pedidos/${id}/contrato`, { headers: { Authorization: `Bearer ${tokenSesion}` } });
      if (!resp.ok) throw new Error('No se pudo abrir el contrato.');
      const url = URL.createObjectURL(await resp.blob());
      if (ventana) ventana.location = url; else window.open(url, '_blank');
    } catch (err) {
      if (ventana) ventana.close();
      throw err;
    }
  },

  async listar() {
    const datos = await peticion('/pedidos');
    return datos.pedidos;
  },

  async crear(datosPedido) {
    const datos = await peticion('/pedidos', { method: 'POST', body: JSON.stringify(datosPedido) });
    return datos.pedido;
  },

  async actualizarDatos(id, datosPedido) {
    const datos = await peticion(`/pedidos/${id}/datos`, { method: 'PUT', body: JSON.stringify(datosPedido) });
    return datos.pedido;
  },

  async registrarEntrega(id, fechaEntrega) {
    const datos = await peticion(`/pedidos/${id}/entrega`, { method: 'PUT', body: JSON.stringify({ fechaEntrega }) });
    return datos.pedido;
  },

  async registrarOficioAdecuacion(id, { folio, monto, fecha }) {
    const datos = await peticion(`/pedidos/${id}/oficio-adecuacion`, { method: 'PUT', body: JSON.stringify({ folio, monto, fecha }) });
    return datos.pedido;
  },

  async agregarOficio(id, { tipo, folio, monto, fecha }) {
    const datos = await peticion(`/pedidos/${id}/oficios`, { method: 'POST', body: JSON.stringify({ tipo, folio, monto, fecha }) });
    return datos.pedido;
  },

  async eliminarOficio(id, oficioId) {
    const datos = await peticion(`/pedidos/${id}/oficios/${oficioId}`, { method: 'DELETE' });
    return datos.pedido;
  },

  async registrarFactura(id, { noFactura, monto, fecha }) {
    const datos = await peticion(`/pedidos/${id}/factura`, { method: 'PUT', body: JSON.stringify({ noFactura, monto, fecha }) });
    return datos.pedido;
  },

  async registrarContabilidad(id, fechaContabilidad) {
    const datos = await peticion(`/pedidos/${id}/contabilidad`, { method: 'PUT', body: JSON.stringify({ fechaContabilidad }) });
    return datos.pedido;
  },

  async registrarInicioPago(id, fechaInicioPago) {
    const datos = await peticion(`/pedidos/${id}/inicio-pago`, { method: 'PUT', body: JSON.stringify({ fechaInicioPago }) });
    return datos.pedido;
  },

  async registrarPagado(id, fechaPagado) {
    const datos = await peticion(`/pedidos/${id}/pagado`, { method: 'PUT', body: JSON.stringify({ fechaPagado }) });
    return datos.pedido;
  },

  async eliminar(id) {
    await peticion(`/pedidos/${id}`, { method: 'DELETE' });
    return true;
  },

  montoDisponible(pedido) { return calcularMontoDisponiblePedido(pedido); }
};