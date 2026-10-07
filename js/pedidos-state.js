// =========================================================
// pedidos-state.js
// Capa de datos de PEDIDOS. Reutiliza peticion() y la sesión
// ya definidas en state.js (se carga después en index.html).
// =========================================================

const ORDEN_PASOS_PEDIDO = [
  'pedido_creado', 'oficio_autorizado', 'adecuacion',
  'factura_recibida',
  'en_contabilidad', 'en_pago', 'pagado'
];

// Monto autorizado vigente: el del oficio de adecuación si lo hay, si no el
// del oficio de autorización; más ampliaciones y menos cancelaciones.
// La reducción líquida NO suma ni resta: reemplaza el autorizado. Los oficios de
// ampliación/cancelación posteriores a ella se aplican sobre su monto; los
// anteriores quedan absorbidos.
function calcularMontoDisponiblePedido(pedido, ignorarReduccion = false) {
  const conReduccion = !!pedido.reduccion && !ignorarReduccion;
  const base = conReduccion ? pedido.reduccion.montoEjercido
    : pedido.oficio ? pedido.oficio.monto : (pedido.autorizacion ? pedido.autorizacion.monto : null);
  if (base === null) return null; // aún no hay monto autorizado, solo el del contrato
  const ajustes = (pedido.oficios || []).filter(of => !!of.posteriorReduccion === conReduccion).reduce((total, of) => {
    return of.tipo === 'cancelacion' ? total - Number(of.monto) : total + Number(of.monto);
  }, 0);
  return base + ajustes;
}

// Las cantidades del contrato en cada etapa (todas a la mano).
// Cada contrarrecibo ampara una parte del autorizado; su factura, entrega,
// contabilidad y pago se siguen por separado.
function montosDelContrato(p) {
  const autorizado = calcularMontoDisponiblePedido(p);
  const crs = p.facturas || [];
  const suma = (lista, fn) => Math.round(lista.reduce((t, f) => t + Number(fn(f) || 0), 0) * 100) / 100;
  const contrarecibos = suma(crs, f => f.contrarecibo && f.contrarecibo.monto);
  const conFactura = crs.filter(f => f.factura);
  const facturado = suma(conFactura, f => f.factura.monto);
  const pagado = suma(crs.filter(f => f.estado === 'pagada' && f.factura), f => f.factura.monto);
  const ejercido = p.reduccion ? p.reduccion.montoEjercido : null;
  const autorizadoPrevio = p.reduccion ? calcularMontoDisponiblePedido(p, true) : null;
  const disponible = autorizado;
  return {
    contratado: Number(p.montoEstimado || 0),
    autorizado,
    contrarecibos,
    numContrarecibos: crs.length,
    facturado,
    numFacturas: conFactura.length,
    pagado,
    disponible,
    // lo que aún se puede amparar con contrarrecibos nuevos
    porRegistrar: disponible !== null ? Math.max(0, Math.round((disponible - contrarecibos) * 100) / 100) : null,
    // lo que aún falta facturar del disponible
    porFacturar: disponible !== null ? Math.max(0, Math.round((disponible - facturado) * 100) / 100) : null,
    ejercido,
    autorizadoPrevio,
    reduccion: ejercido !== null && autorizadoPrevio !== null ? autorizadoPrevio - ejercido : null,
    vigente: autorizado !== null ? autorizado : Number(p.montoEstimado || 0)
  };
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
    let avance = null;
    if (ventana) {
      // Mientras descarga (los PDF grandes tardan unos segundos) la pestaña no se queda en blanco:
      // una barra de avance aproximado que se acerca al 95 % y se completa al abrir el archivo
      ventana.document.title = 'Cargando…';
      ventana.document.body.style.margin = '0';
      ventana.document.body.innerHTML = `
        <div style="font:16px Segoe UI,Arial,sans-serif;color:#5a1e2c;display:flex;align-items:center;justify-content:center;height:96vh;flex-direction:column;gap:14px;background:#F7F5F2">
          <b style="font-size:18px">Cargando documento…</b>
          <div style="width:min(360px,80vw);height:10px;border-radius:999px;background:#EAE3D9;overflow:hidden">
            <div id="barra" style="height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#6B0F2B,#BC955C);transition:width .25s ease"></div>
          </div>
          <span id="pct" style="font-weight:700;font-variant-numeric:tabular-nums">0%</span>
          <span style="color:#777;font-size:13px">Los archivos grandes pueden tardar unos segundos.</span>
        </div>`;
    }
    // Avance: lo real cuando se conoce el tamaño; si no, uno aproximado que se acerca al 95 %
    let pct = 0, real = null;
    const pintar = (v) => {
      try {
        ventana.document.getElementById('barra').style.width = v.toFixed(1) + '%';
        ventana.document.getElementById('pct').textContent = Math.floor(v) + '%';
      } catch (e) { clearInterval(avance); }
    };
    if (ventana) {
      avance = setInterval(() => {
        pct = real !== null ? Math.max(pct, real) : pct + (95 - pct) * 0.03;
        pintar(Math.min(pct, 99));
      }, 120);
      setTimeout(() => clearInterval(avance), 180000);
    }
    try {
      // Enlace temporal al archivo en el servidor
      const datos = await peticion(`/pedidos/${id}/enlace/${ruta}`, { method: 'POST' });
      const url = API_BASE_URL + datos.ruta;
      if (!ventana) { window.open(url, '_blank'); return; }
      // La pestaña abre el archivo directo para que Chrome lo muestre en su visor
      // (descargar, imprimir, zoom); mientras responde sigue la barra de carga.
      ventana.location.href = url;
    } catch (err) {
      clearInterval(avance);
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

  // Registra cualquier paso del flujo (ruta = 'oficio-autorizacion', 'contrarecibo', …)
  async registrarPaso(id, ruta, cuerpo) {
    const datos = await peticion(`/pedidos/${id}/${ruta}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
    return datos.pedido;
  },

  // Contrarrecibos: varios por contrato, cada uno con su factura y seguimiento
  async agregarContrarecibo(id, cuerpo) {
    return peticion(`/pedidos/${id}/facturas`, { method: 'POST', body: JSON.stringify(cuerpo) });
  },
  // Avance de un contrarrecibo (factura, entrega, contabilidad, inicio-pago, pagado)
  // o corrección (contrarecibo, oficio-contabilidad)
  async avanzarContrarecibo(id, fid, ruta, cuerpo) {
    const datos = await peticion(`/pedidos/${id}/facturas/${fid}/${ruta}`, { method: 'PUT', body: JSON.stringify(cuerpo) });
    return datos.pedido;
  },
  async editarTodo(id, cuerpo) {
    const datos = await peticion(`/pedidos/${id}/editar-todo`, { method: 'PUT', body: JSON.stringify(cuerpo) });
    return datos.pedido;
  },
  async eliminarContrarecibo(id, fid) {
    const datos = await peticion(`/pedidos/${id}/facturas/${fid}`, { method: 'DELETE' });
    return datos.pedido;
  },

  // Omite un paso opcional (oficio-adecuacion, reduccion)
  async omitirPaso(id, ruta) {
    const datos = await peticion(`/pedidos/${id}/omitir/${ruta}`, { method: 'PUT' });
    return datos.pedido;
  },

  // Documentos de cada paso (ruta = 'documento-autorizacion', 'documento-contrarecibo', …)
  subirDocumento(id, ruta, archivo) { return this.subirContrato(id, archivo, ruta); },
  abrirDocumento(id, ruta) { return this.abrirContrato(id, ruta); },

  async agregarOficio(id, { tipo, folio, monto, fecha }) {
    const datos = await peticion(`/pedidos/${id}/oficios`, { method: 'POST', body: JSON.stringify({ tipo, folio, monto, fecha }) });
    return datos.pedido;
  },

  async eliminarOficio(id, oficioId) {
    const datos = await peticion(`/pedidos/${id}/oficios/${oficioId}`, { method: 'DELETE' });
    return datos.pedido;
  },

  async eliminar(id) {
    await peticion(`/pedidos/${id}`, { method: 'DELETE' });
    return true;
  },

  montoDisponible(pedido) { return calcularMontoDisponiblePedido(pedido); }
};