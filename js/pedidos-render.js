// =========================================================
// pedidos-render.js
// Listado con buscador/filtro + tarjeta de pedido con el
// stepper visual de 7 pasos y su panel de acción según en
// qué paso vaya cada uno.
// =========================================================

let pedidosCache = [];
const tarjetasPedidoExpandidas = new Set();

const PASOS_PEDIDO = [
  { clave: 'pedido_creado', label: 'Pedido creado' },
  { clave: 'entregado', label: 'Entregado' },
  { clave: 'oficio_registrado', label: 'Oficio de adecuación' },
  { clave: 'factura_recibida', label: 'Factura recibida' },
  { clave: 'en_contabilidad', label: 'En contabilidad' },
  { clave: 'en_pago', label: 'En proceso de pago' },
  { clave: 'pagado', label: 'Pagado' }
];

function indicePaso(estatus) {
  return ORDEN_PASOS_PEDIDO.indexOf(estatus);
}

function claseBadgePedido(estatus) {
  const idx = indicePaso(estatus);
  if (idx <= 1) return 'badge-oficio_capturado';
  if (idx <= 5) return 'badge-en_facturacion';
  return 'badge-completado';
}

// ---------- Listado con buscador y filtro ----------

async function renderListadoPedidos() {
  const contenedor = document.getElementById('lista-pedidos');
  contenedor.innerHTML = `<p class="cargando">Cargando pedidos…</p>`;
  document.getElementById('pedidos-vacio').style.display = 'none';

  try {
    pedidosCache = await StorePedidos.listar();
  } catch (err) {
    contenedor.innerHTML = '';
    mostrarAviso(err.message, true);
    if (err.message.includes('sesión')) mostrarPantalla('pantalla-login');
    return;
  }

  aplicarFiltrosPedidos();
}

function aplicarFiltrosPedidos() {
  const texto = document.getElementById('buscador-pedidos').value.trim().toLowerCase();
  const filtroEstatus = document.getElementById('filtro-estatus-pedidos').value;

  let lista = pedidosCache;
  if (texto) {
    lista = lista.filter(p =>
      p.producto.toLowerCase().includes(texto) ||
      (p.proveedor || '').toLowerCase().includes(texto)
    );
  }
  if (filtroEstatus) {
    lista = lista.filter(p => p.estatus === filtroEstatus);
  }

  const contenedor = document.getElementById('lista-pedidos');
  const vacio = document.getElementById('pedidos-vacio');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.style.display = 'block';
    vacio.querySelector('p').textContent = pedidosCache.length === 0
      ? 'Aún no hay pedidos registrados. Usa "Nuevo pedido" para capturar el primero.'
      : 'Ningún pedido coincide con tu búsqueda o filtro.';
    return;
  }
  vacio.style.display = 'none';

  contenedor.innerHTML = lista.map(p => renderTarjetaPedido(p)).join('');
  adjuntarEventosPedidos();
}

document.getElementById('buscador-pedidos').addEventListener('input', aplicarFiltrosPedidos);
document.getElementById('filtro-estatus-pedidos').addEventListener('change', aplicarFiltrosPedidos);

// ---------- Tarjeta de pedido ----------

function renderMiniStepper(estatus) {
  const idx = indicePaso(estatus);
  return `
    <div class="mini-stepper" title="${PASOS_PEDIDO[idx].label}">
      ${PASOS_PEDIDO.map((paso, i) => `<span class="mini-punto ${i <= idx ? 'lleno' : ''}"></span>`).join('')}
    </div>
  `;
}

function renderTarjetaPedido(p) {
  const abierta = tarjetasPedidoExpandidas.has(p.id);
  const montoMostrar = p.oficio ? calcularMontoDisponiblePedido(p) : p.montoEstimado;
  const etiquetaMonto = p.oficio ? 'Disponible' : 'Estimado';

  return `
    <div class="tarjeta-contrato" data-id="${p.id}">
      <div class="tarjeta-contrato-header" data-toggle-pedido="${p.id}">
        <span class="tc-chevron ${abierta ? 'abierto' : ''}">›</span>
        <div class="tc-info">
          <span class="tc-folio">${p.producto}</span>
          <span class="tc-detalle">${p.cantidad} ${p.unidadMedida || ''} · ${p.proveedor || 'Sin proveedor'}${p.areaSolicitante ? ' · ' + p.areaSolicitante : ''}</span>
        </div>
        ${renderMiniStepper(p.estatus)}
        <span class="tc-monto">${etiquetaMonto}: ${fmtMoneda.format(montoMostrar)}</span>
        <span class="badge ${claseBadgePedido(p.estatus)}">${PASOS_PEDIDO[indicePaso(p.estatus)].label}</span>
      </div>
      <div class="tarjeta-contrato-acciones">
        <button class="btn btn-secundario btn-sm" data-editar-pedido="${p.id}">Editar datos del pedido</button>
        <button class="btn btn-texto btn-sm" data-eliminar-pedido="${p.id}">Eliminar</button>
      </div>
      <div class="tarjeta-contrato-body" id="cuerpo-pedido-${p.id}" style="display:${abierta ? 'block' : 'none'}">
        ${abierta ? renderCuerpoPedido(p) : ''}
      </div>
    </div>
  `;
}

// ---------- Cuerpo expandido: stepper completo + detalle + acción ----------

function renderCuerpoPedido(p) {
  const idxActual = indicePaso(p.estatus);

  const stepperHtml = `
    <div class="subseccion-titulo">Seguimiento del proceso</div>
    <div class="pedido-stepper">
      ${PASOS_PEDIDO.map((paso, i) => {
        let estadoClase = 'pendiente';
        if (i < idxActual) estadoClase = 'completado';
        else if (i === idxActual) estadoClase = 'actual';
        return `
          <div class="paso-stepper ${estadoClase}">
            <div class="paso-circulo">${i < idxActual ? '✓' : i + 1}</div>
            <div class="paso-label">${paso.label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const detalleHtml = `
    <div class="subseccion-titulo" style="margin-top:26px;">Detalle capturado</div>
    <div class="resumen-grid" style="margin-bottom:26px;">
      <div class="resumen-item">
        <div class="resumen-label">Fecha de solicitud</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtFecha(p.fechaSolicitud)}</div>
      </div>
      <div class="resumen-item">
        <div class="resumen-label">Monto estimado</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtMoneda.format(p.montoEstimado)}</div>
      </div>
      ${p.fechaEntrega ? `
      <div class="resumen-item">
        <div class="resumen-label">Fecha de entrega</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtFecha(p.fechaEntrega)}</div>
      </div>` : ''}
      ${p.oficio ? `
      <div class="resumen-item destacado">
        <div class="resumen-label">Oficio de adecuación</div>
        <div class="resumen-valor" style="font-size:15px;">${p.oficio.folio} · ${fmtMoneda.format(p.oficio.monto)}</div>
      </div>
      <div class="resumen-item">
        <div class="resumen-label">Monto disponible (con ajustes)</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtMoneda.format(calcularMontoDisponiblePedido(p))}</div>
      </div>` : ''}
      ${p.factura ? `
      <div class="resumen-item">
        <div class="resumen-label">Factura</div>
        <div class="resumen-valor" style="font-size:15px;">${p.factura.noFactura} · ${fmtMoneda.format(p.factura.monto)}</div>
      </div>` : ''}
      ${p.fechaContabilidad ? `
      <div class="resumen-item">
        <div class="resumen-label">Pasó a contabilidad</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtFecha(p.fechaContabilidad)}</div>
      </div>` : ''}
      ${p.fechaInicioPago ? `
      <div class="resumen-item">
        <div class="resumen-label">Inicio de proceso de pago</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtFecha(p.fechaInicioPago)}</div>
      </div>` : ''}
      ${p.fechaPagado ? `
      <div class="resumen-item destacado">
        <div class="resumen-label">Pagado</div>
        <div class="resumen-valor" style="font-size:15px;">${fmtFecha(p.fechaPagado)}</div>
      </div>` : ''}
    </div>
  `;

  // Oficios de ampliación/cancelación: disponibles desde "oficio_registrado" en adelante
  let oficiosHtml = '';
  if (idxActual >= indicePaso('oficio_registrado')) {
    oficiosHtml = `<div class="subseccion-titulo">Oficios de ampliación / cancelación</div>`;
    if (p.oficios.length === 0) {
      oficiosHtml += `<div class="bloqueo" style="margin-bottom:26px;">Aún no se han registrado ajustes sobre el oficio de adecuación.</div>`;
    } else {
      oficiosHtml += `
        <table class="tabla-oficios-registrados" style="margin-bottom:18px;">
          <thead><tr><th>Tipo</th><th>Folio</th><th>Monto</th><th>Fecha</th><th></th></tr></thead>
          <tbody>
            ${p.oficios.map(of => `
              <tr>
                <td>${of.tipo === 'ampliacion' ? 'Ampliación' : 'Cancelación'}</td>
                <td>${of.folio}</td>
                <td class="${of.tipo === 'cancelacion' ? 'texto-negativo' : ''}">${of.tipo === 'cancelacion' ? '−' : '+'}${fmtMoneda.format(of.monto)}</td>
                <td>${fmtFecha(of.fecha)}</td>
                <td><button class="btn-icono" data-eliminar-oficio-pedido="${of.id}" data-pedido-id="${p.id}" title="Eliminar">✕</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
    oficiosHtml += `
      <form class="form-oficio-pedido" data-pedido-id="${p.id}" style="margin-bottom:26px;">
        <div class="fila-formulario">
          <label>Tipo
            <select name="tipo" required>
              <option value="ampliacion">Ampliación</option>
              <option value="cancelacion">Cancelación</option>
            </select>
          </label>
          <label>Folio
            <input type="text" name="folio" placeholder="Ej. SH/0812/2026" required>
          </label>
        </div>
        <div class="fila-formulario">
          <label>Monto
            <input type="number" name="monto" step="0.01" min="0" required>
          </label>
          <label>Fecha
            <input type="date" name="fecha" required>
          </label>
        </div>
        <button type="submit" class="btn btn-secundario btn-sm">+ Agregar oficio</button>
      </form>
    `;
  }

  const accionHtml = renderPanelAccionPedido(p, idxActual);

  return stepperHtml + detalleHtml + oficiosHtml + accionHtml;
}

// ---------- Panel de acción según el paso actual ----------

function renderPanelAccionPedido(p, idxActual) {
  const hoy = new Date().toISOString().slice(0, 10);

  if (p.estatus === 'pagado') {
    return `<p class="ayuda-boton" style="margin-top:8px;">✓ Este pedido completó todo el proceso.</p>`;
  }

  const panel = (titulo, camposHtml) => `
    <div class="panel-paso-actual">
      <div class="subseccion-titulo">${titulo}</div>
      ${camposHtml}
    </div>
  `;

  switch (p.estatus) {
    case 'pedido_creado':
      return panel('Registrar entrega', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="entrega">
          <label style="margin-bottom:14px;">Fecha de entrega
            <input type="date" name="fechaEntrega" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar entrega</button>
        </form>
      `);

    case 'entregado':
      return panel('Registrar oficio de adecuación', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="oficio-adecuacion">
          <div class="fila-formulario">
            <label>Folio del oficio
              <input type="text" name="folio" placeholder="Ej. SH/0716/2026" required>
            </label>
            <label>Monto autorizado
              <input type="number" name="monto" step="0.01" min="0" required>
            </label>
          </div>
          <label style="margin-bottom:14px;">Fecha del oficio
            <input type="date" name="fecha" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar oficio</button>
        </form>
      `);

    case 'oficio_registrado':
      return panel('Registrar factura recibida', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="factura">
          <div class="fila-formulario">
            <label>No. de factura
              <input type="text" name="noFactura" required>
            </label>
            <label>Monto
              <input type="number" name="monto" step="0.01" min="0" required>
            </label>
          </div>
          <label style="margin-bottom:14px;">Fecha de factura
            <input type="date" name="fecha" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar factura</button>
        </form>
      `);

    case 'factura_recibida':
      return panel('Registrar paso a contabilidad', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="contabilidad">
          <label style="margin-bottom:14px;">Fecha en que pasó a contabilidad
            <input type="date" name="fechaContabilidad" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar</button>
        </form>
      `);

    case 'en_contabilidad':
      return panel('Marcar en proceso de pago', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="inicio-pago">
          <label style="margin-bottom:14px;">Fecha de inicio del proceso de pago
            <input type="date" name="fechaInicioPago" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Marcar en proceso de pago</button>
        </form>
      `);

    case 'en_pago':
      return panel('Registrar pago (cierra el proceso)', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="pagado">
          <label style="margin-bottom:14px;">Fecha de pago
            <input type="date" name="fechaPagado" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar pago y completar</button>
        </form>
      `);

    default:
      return '';
  }
}