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

const MAX_CONTRATO_MB = 150;

const StorePedidos = {
  // Sube (o reemplaza) el archivo del contrato: PDF, Word o imagen
  async subirContrato(id, archivo, ruta = 'contrato') {
    if (archivo.size > MAX_CONTRATO_MB * 1024 * 1024) throw new Error(`El archivo pesa más de ${MAX_CONTRATO_MB} MB.`);
    // El archivo va tal cual (no en base64) y el servidor lo pasa a Drive por partes
    const datos = await peticion(`/pedidos/${id}/${ruta}`, {
      method: 'PUT',
      headers: { 'Content-Type': archivo.type || 'application/octet-stream', 'X-Nombre-Archivo': encodeURIComponent(archivo.name) },
      body: archivo
    });
    return datos.pedido;
  },

  // Abre el contrato en otra pestaña (se pide con el token de la sesión)
  // Documento opcional de la entrega (mismas reglas que el contrato)
  subirDocumentoEntrega(id, archivo) { return this.subirContrato(id, archivo, 'documento-entrega'); },
  abrirDocumentoEntrega(id) { return this.abrirContrato(id, 'documento-entrega'); },

  async abrirContrato(id, ruta = 'contrato') {
    const ventana = window.open('', '_blank');   // se abre ya, para que el navegador no la bloquee
    if (ventana) {
      // Mientras descarga (los PDF grandes tardan unos segundos) la pestaña no se queda en blanco
      ventana.document.title = 'Cargando…';
      ventana.document.body.innerHTML = '<div style="font:16px Segoe UI,Arial,sans-serif;color:#5a1e2c;display:flex;align-items:center;justify-content:center;height:90vh;flex-direction:column;gap:10px"><b>Cargando documento…</b><span style="color:#777;font-size:13px">Los archivos grandes pueden tardar unos segundos.</span></div>';
    }
    try {
      // Se pide un enlace temporal y la pestaña abre el archivo directo del
      // servidor (Chrome bloquea pasar la pestaña a un blob: creado aquí).
      const datos = await peticion(`/pedidos/${id}/enlace/${ruta}`, { method: 'POST' });
      const url = API_BASE_URL + datos.ruta;
      if (ventana) ventana.location.href = url; else window.open(url, '_blank');
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