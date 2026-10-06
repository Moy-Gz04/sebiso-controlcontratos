// =========================================================
// pedidos-render.js
// Pantalla de CONTRATOS (el flujo de 7 pasos que antes se
// llamaba Pedidos): resumen con indicadores, filtro por etapa,
// buscador y la tarjeta de cada contrato con su recorrido,
// línea de tiempo y el formulario del paso que sigue.
// =========================================================

let pedidosCache = [];
const tarjetasPedidoExpandidas = new Set();
let filtroEtapa = '';          // '' = todas las etapas
let ultimaTarjetaAbierta = null; // para animar solo la que se acaba de abrir
let animarEntrada = true;      // la entrada escalonada solo al cargar o filtrar

const PASOS_PEDIDO = [
  { clave: 'pedido_creado',     label: 'Contrato creado',      corto: 'Creado',       icono: 'ti-file-plus' },
  { clave: 'entregado',         label: 'Entregado',            corto: 'Entregado',    icono: 'ti-truck-delivery' },
  { clave: 'oficio_registrado', label: 'Oficio de adecuación', corto: 'Oficio',       icono: 'ti-file-certificate' },
  { clave: 'factura_recibida',  label: 'Factura recibida',     corto: 'Factura',      icono: 'ti-receipt' },
  { clave: 'en_contabilidad',   label: 'En contabilidad',      corto: 'Contabilidad', icono: 'ti-calculator' },
  { clave: 'en_pago',           label: 'En proceso de pago',   corto: 'En pago',      icono: 'ti-cash' },
  { clave: 'pagado',            label: 'Pagado',               corto: 'Pagado',       icono: 'ti-circle-check' }
];

// Qué hace falta para avanzar desde cada paso
const SIGUIENTE_PASO = {
  pedido_creado: 'Registrar la entrega',
  entregado: 'Registrar el oficio de adecuación',
  oficio_registrado: 'Registrar la factura',
  factura_recibida: 'Turnar a contabilidad',
  en_contabilidad: 'Iniciar el proceso de pago',
  en_pago: 'Registrar el pago'
};

function indicePaso(estatus) {
  return ORDEN_PASOS_PEDIDO.indexOf(estatus);
}

// Etapa en tres grupos, para el color de la tarjeta y la insignia
function grupoEtapa(estatus) {
  const idx = indicePaso(estatus);
  if (idx <= 1) return 'inicio';
  if (idx <= 5) return 'tramite';
  return 'pagado';
}

function claseBadgePedido(estatus) {
  return { inicio: 'badge-oficio_capturado', tramite: 'badge-en_facturacion', pagado: 'badge-completado' }[grupoEtapa(estatus)];
}

function montoDe(p) {
  return p.oficio ? calcularMontoDisponiblePedido(p) : Number(p.montoEstimado || 0);
}

const escaparHtml = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reducirMovimiento = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Carga ----------

async function renderListadoPedidos() {
  const contenedor = document.getElementById('lista-pedidos');
  if (!pedidosCache.length) contenedor.innerHTML = renderEsqueleto();
  document.getElementById('pedidos-vacio').style.display = 'none';

  try {
    pedidosCache = await StorePedidos.listar();
  } catch (err) {
    contenedor.innerHTML = '';
    mostrarAviso(err.message, true);
    if (err.message.includes('sesión')) mostrarPantalla('pantalla-login');
    return;
  }

  renderResumenContratos();
  aplicarFiltrosPedidos();
}

function renderEsqueleto() {
  return Array.from({ length: 3 }, () => `
    <div class="tarjeta-esqueleto" aria-hidden="true">
      <span class="esq esq-titulo"></span><span class="esq esq-linea"></span><span class="esq esq-barra"></span>
    </div>`).join('');
}

// ---------- Resumen (indicadores) ----------

function renderResumenContratos() {
  const cont = document.getElementById('resumen-contratos');
  if (!cont) return;
  const total = pedidosCache.length;
  const pagados = pedidosCache.filter(p => p.estatus === 'pagado').length;
  const enProceso = total - pagados;
  const enTramite = pedidosCache.filter(p => p.estatus !== 'pagado').reduce((s, p) => s + montoDe(p), 0);
  const pagadoMonto = pedidosCache.filter(p => p.estatus === 'pagado').reduce((s, p) => s + montoDe(p), 0);

  const kpi = (icono, etiqueta, valor, sub, esMoneda, clase = '') => `
    <div class="kpi ${clase}">
      <span class="kpi-icono"><i class="ti ${icono}"></i></span>
      <div>
        <div class="kpi-etiqueta">${etiqueta}</div>
        <div class="kpi-valor" data-contar="${valor}" data-moneda="${esMoneda ? 1 : 0}">${esMoneda ? fmtMoneda.format(valor) : valor}</div>
        <div class="kpi-sub">${sub}</div>
      </div>
    </div>`;

  cont.innerHTML =
    kpi('ti-files', 'Contratos registrados', total, 'en el sistema', false) +
    kpi('ti-progress', 'En proceso', enProceso, 'aún sin pagar', false, 'kpi-tramite') +
    kpi('ti-circle-check', 'Pagados', pagados, fmtMoneda.format(pagadoMonto) + ' pagado', false, 'kpi-pagado') +
    kpi('ti-coin', 'Monto en trámite', enTramite, 'autorizado o estimado', true, 'kpi-destacado');

  if (!reducirMovimiento()) {
    cont.querySelectorAll('[data-contar]').forEach(el => contarHasta(el, Number(el.dataset.contar), el.dataset.moneda === '1'));
  }
  renderFiltroEtapas();
}

// Los números suben desde 0 al cargar (0.9 s, con frenado al final)
function contarHasta(el, destino, esMoneda) {
  const inicio = performance.now(), dur = 900;
  const paso = (t) => {
    const k = Math.min(1, (t - inicio) / dur), suave = 1 - Math.pow(1 - k, 3);
    const v = destino * suave;
    el.textContent = esMoneda ? fmtMoneda.format(v) : Math.round(v);
    if (k < 1) requestAnimationFrame(paso);
  };
  requestAnimationFrame(paso);
}

// ---------- Filtro por etapa (pastillas con conteo) ----------

function renderFiltroEtapas() {
  const cont = document.getElementById('filtro-etapas');
  if (!cont) return;
  const cuenta = (clave) => pedidosCache.filter(p => p.estatus === clave).length;
  const pastilla = (clave, texto, n) => `
    <button type="button" class="etapa-pill ${filtroEtapa === clave ? 'activa' : ''}" data-etapa="${clave}" aria-pressed="${filtroEtapa === clave}">
      ${texto}<span class="etapa-num">${n}</span>
    </button>`;
  cont.innerHTML = pastilla('', 'Todas', pedidosCache.length) +
    PASOS_PEDIDO.map(p => pastilla(p.clave, p.corto, cuenta(p.clave))).join('');
  cont.querySelectorAll('[data-etapa]').forEach(b => b.addEventListener('click', () => {
    filtroEtapa = b.dataset.etapa;
    animarEntrada = true;
    renderFiltroEtapas();
    aplicarFiltrosPedidos();
  }));
}

// ---------- Listado ----------

function aplicarFiltrosPedidos() {
  const texto = document.getElementById('buscador-pedidos').value.trim().toLowerCase();

  let lista = pedidosCache;
  if (texto) {
    lista = lista.filter(p =>
      p.producto.toLowerCase().includes(texto) ||
      (p.proveedor || '').toLowerCase().includes(texto) ||
      (p.areaSolicitante || '').toLowerCase().includes(texto)
    );
  }
  if (filtroEtapa) lista = lista.filter(p => p.estatus === filtroEtapa);

  const contenedor = document.getElementById('lista-pedidos');
  const vacio = document.getElementById('pedidos-vacio');

  if (lista.length === 0) {
    contenedor.innerHTML = '';
    vacio.style.display = 'block';
    vacio.querySelector('p').textContent = pedidosCache.length === 0
      ? 'Aún no hay contratos registrados. Usa "Nuevo contrato" para capturar el primero.'
      : 'Ningún contrato coincide con tu búsqueda o con la etapa elegida.';
    return;
  }
  vacio.style.display = 'none';

  contenedor.innerHTML = lista.map((p, i) => renderTarjetaPedido(p, i)).join('');
  contenedor.classList.toggle('animar-entrada', animarEntrada && !reducirMovimiento());
  animarEntrada = false;
  ultimaTarjetaAbierta = null;
  adjuntarEventosPedidos();
}

document.getElementById('buscador-pedidos').addEventListener('input', () => { animarEntrada = true; aplicarFiltrosPedidos(); });

// ---------- Tarjeta ----------

function renderTarjetaPedido(p, i) {
  const abierta = tarjetasPedidoExpandidas.has(p.id);
  const idx = indicePaso(p.estatus);
  const paso = PASOS_PEDIDO[idx];
  const avance = Math.round(idx / (PASOS_PEDIDO.length - 1) * 100);
  const etiquetaMonto = p.oficio ? 'Autorizado' : 'Estimado';
  const siguiente = SIGUIENTE_PASO[p.estatus];

  return `
    <article class="tc etapa-${grupoEtapa(p.estatus)} ${abierta ? 'abierta' : ''}" data-id="${p.id}" style="--i:${i}">
      <button type="button" class="tc-cabecera" data-toggle-pedido="${p.id}" aria-expanded="${abierta}" aria-controls="cuerpo-pedido-${p.id}">
        <span class="tc-icono"><i class="ti ${paso.icono}"></i></span>
        <span class="tc-principal">
          <span class="tc-titulo">${escaparHtml(p.producto)}</span>
          <span class="tc-meta">
            <span><i class="ti ti-package"></i>${escaparHtml(p.cantidad)} ${escaparHtml(p.unidadMedida || '')}</span>
            <span><i class="ti ti-building-store"></i>${escaparHtml(p.proveedor || 'Sin proveedor')}</span>
            ${p.areaSolicitante ? `<span><i class="ti ti-users"></i>${escaparHtml(p.areaSolicitante)}</span>` : ''}
            ${p.contrato ? `<span class="tc-adjunto"><i class="ti ti-paperclip"></i>Contrato adjunto</span>` : `<span class="tc-sin-adjunto"><i class="ti ti-alert-circle"></i>Sin archivo de contrato</span>`}
          </span>
        </span>
        <span class="tc-lado">
          <span class="tc-monto"><small>${etiquetaMonto}</small>${fmtMoneda.format(montoDe(p))}</span>
          <span class="badge ${claseBadgePedido(p.estatus)}">${paso.label}</span>
        </span>
        <span class="tc-flecha"><i class="ti ti-chevron-down"></i></span>
      </button>
      <div class="tc-progreso">
        <div class="tc-barra" role="progressbar" aria-valuemin="1" aria-valuemax="7" aria-valuenow="${idx + 1}" aria-label="Avance del contrato">
          <span style="--avance:${avance}%"></span>
        </div>
        <span class="tc-paso-texto">Paso ${idx + 1} de ${PASOS_PEDIDO.length}${siguiente ? ` · <b>Sigue:</b> ${siguiente}` : ' · <b>Proceso completo</b>'}</span>
      </div>
      <div class="tc-cuerpo ${abierta && ultimaTarjetaAbierta === p.id ? 'recien-abierta' : ''}" id="cuerpo-pedido-${p.id}" ${abierta ? '' : 'hidden'}>
        ${abierta ? renderCuerpoPedido(p) : ''}
      </div>
    </article>
  `;
}

// ---------- Cuerpo desplegado ----------

function renderCuerpoPedido(p) {
  const idxActual = indicePaso(p.estatus);

  const recorrido = `
    <div class="subseccion-titulo">Recorrido del contrato</div>
    <ol class="recorrido" style="--avance:${idxActual / (PASOS_PEDIDO.length - 1)}">
      ${PASOS_PEDIDO.map((paso, i) => {
        const estado = i < idxActual ? 'hecho' : i === idxActual ? 'actual' : 'pendiente';
        return `
          <li class="rec-paso ${estado}" style="--j:${i}">
            <span class="rec-circulo">${i < idxActual || (i === idxActual && p.estatus === 'pagado') ? '<i class="ti ti-check"></i>' : `<i class="ti ${paso.icono}"></i>`}</span>
            <span class="rec-label">${paso.label}</span>
          </li>`;
      }).join('')}
    </ol>
  `;

  // Línea de tiempo con lo que ya se capturó, en orden
  const eventos = [
    { fecha: p.fechaSolicitud, titulo: 'Solicitud', detalle: `Monto estimado ${fmtMoneda.format(p.montoEstimado || 0)}` },
    p.fechaEntrega && { fecha: p.fechaEntrega, titulo: 'Entrega', detalle: 'El proveedor entregó el bien o servicio' },
    p.oficio && { fecha: p.oficio.fecha, titulo: 'Oficio de adecuación', detalle: `${escaparHtml(p.oficio.folio)} · ${fmtMoneda.format(p.oficio.monto)}`, destacado: true },
    ...(p.oficios || []).map(of => ({ fecha: of.fecha, titulo: of.tipo === 'ampliacion' ? 'Ampliación' : 'Cancelación', detalle: `${escaparHtml(of.folio)} · ${of.tipo === 'cancelacion' ? '−' : '+'}${fmtMoneda.format(of.monto)}` })),
    p.factura && { fecha: p.factura.fecha, titulo: 'Factura recibida', detalle: `No. ${escaparHtml(p.factura.noFactura)} · ${fmtMoneda.format(p.factura.monto)}` },
    p.fechaContabilidad && { fecha: p.fechaContabilidad, titulo: 'Turnado a contabilidad', detalle: '' },
    p.fechaInicioPago && { fecha: p.fechaInicioPago, titulo: 'Inicio del proceso de pago', detalle: '' },
    p.fechaPagado && { fecha: p.fechaPagado, titulo: 'Pagado', detalle: 'Proceso concluido', destacado: true }
  ].filter(Boolean);

  const detalle = `
    <div class="cuerpo-columnas">
      <section>
        <div class="subseccion-titulo">Historial</div>
        <ul class="linea-tiempo">
          ${eventos.map(e => `
            <li class="${e.destacado ? 'destacado' : ''}">
              <span class="lt-fecha">${fmtFecha(e.fecha)}</span>
              <span class="lt-titulo">${e.titulo}</span>
              ${e.detalle ? `<span class="lt-detalle">${e.detalle}</span>` : ''}
            </li>`).join('')}
        </ul>
        ${p.descripcion ? `<div class="nota-descripcion"><i class="ti ti-notes"></i>${escaparHtml(p.descripcion)}</div>` : ''}
      </section>
      <section>
        ${renderPanelAccionPedido(p, idxActual)}
        ${p.oficio ? `
        <div class="montos-mini">
          <div><span>Oficio de adecuación</span><b>${fmtMoneda.format(p.oficio.monto)}</b></div>
          <div class="total"><span>Disponible con ajustes</span><b>${fmtMoneda.format(calcularMontoDisponiblePedido(p))}</b></div>
        </div>` : ''}
      </section>
    </div>
  `;

  // Oficios de ampliación/cancelación: disponibles desde "oficio_registrado" en adelante
  let oficiosHtml = '';
  if (idxActual >= indicePaso('oficio_registrado')) {
    oficiosHtml = `<div class="bloque-oficios"><div class="subseccion-titulo">Oficios de ampliación / cancelación</div>`;
    if (p.oficios.length === 0) {
      oficiosHtml += `<p class="texto-suave">Aún no hay ajustes sobre el oficio de adecuación.</p>`;
    } else {
      oficiosHtml += `
        <div class="tabla-scroll">
        <table class="tabla-oficios-registrados">
          <thead><tr><th>Tipo</th><th>Folio</th><th>Monto</th><th>Fecha</th><th></th></tr></thead>
          <tbody>
            ${p.oficios.map(of => `
              <tr>
                <td>${of.tipo === 'ampliacion' ? 'Ampliación' : 'Cancelación'}</td>
                <td>${escaparHtml(of.folio)}</td>
                <td class="${of.tipo === 'cancelacion' ? 'texto-negativo' : 'texto-positivo'}">${of.tipo === 'cancelacion' ? '−' : '+'}${fmtMoneda.format(of.monto)}</td>
                <td>${fmtFecha(of.fecha)}</td>
                <td><button type="button" class="btn-icono" data-eliminar-oficio-pedido="${of.id}" data-pedido-id="${p.id}" title="Eliminar oficio" aria-label="Eliminar oficio ${escaparHtml(of.folio)}"><i class="ti ti-trash"></i></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      `;
    }
    oficiosHtml += `
      <form class="form-oficio-pedido" data-pedido-id="${p.id}">
        <div class="fila-formulario fila-4">
          <label>Tipo
            <select name="tipo" required>
              <option value="ampliacion">Ampliación</option>
              <option value="cancelacion">Cancelación</option>
            </select>
          </label>
          <label>Folio
            <input type="text" name="folio" placeholder="Ej. SH/0812/2026" required>
          </label>
          <label>Monto
            <input type="number" name="monto" step="0.01" min="0" required>
          </label>
          <label>Fecha
            <input type="date" name="fecha" required>
          </label>
        </div>
        <button type="submit" class="btn btn-secundario btn-sm"><i class="ti ti-plus"></i> Agregar oficio</button>
      </form>
    </div>`;
  }

  const acciones = `
    <div class="tc-acciones">
      <button type="button" class="btn btn-secundario btn-sm" data-editar-pedido="${p.id}"><i class="ti ti-pencil"></i> Editar datos</button>
      <button type="button" class="btn btn-texto btn-sm" data-eliminar-pedido="${p.id}"><i class="ti ti-trash"></i> Eliminar contrato</button>
    </div>`;

  const tamano = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
  const archivo = `
    <div class="bloque-archivo">
      <div class="subseccion-titulo">Contrato</div>
      ${p.contrato ? `
        <div class="archivo-fila">
          <span class="archivo-icono"><i class="ti ${/pdf/.test(p.contrato.mime) ? 'ti-file-type-pdf' : /image/.test(p.contrato.mime) ? 'ti-photo' : 'ti-file-type-doc'}"></i></span>
          <span class="archivo-info"><b>${escaparHtml(p.contrato.nombre)}</b><small>${tamano(p.contrato.tamano)}</small></span>
          <button type="button" class="btn btn-secundario btn-sm" data-ver-contrato="${p.id}"><i class="ti ti-eye"></i> Ver contrato</button>
          <label class="btn btn-texto btn-sm btn-reemplazar"><i class="ti ti-replace"></i> Reemplazar
            <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-contrato="${p.id}" hidden>
          </label>
        </div>` : `
        <label class="zona-archivo zona-archivo--detalle">
          <i class="ti ti-file-upload"></i>
          <span class="zona-archivo__texto">Subir el archivo del contrato</span>
          <small>PDF, Word o imagen · máximo 150 MB</small>
          <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-contrato="${p.id}">
        </label>`}
    </div>`;

  const docEntrega = !p.fechaEntrega ? '' : `
    <div class="bloque-archivo">
      <div class="subseccion-titulo">Documento de entrega</div>
      ${p.documentoEntrega ? `
        <div class="archivo-fila">
          <span class="archivo-icono"><i class="ti ${/pdf/.test(p.documentoEntrega.mime) ? 'ti-file-type-pdf' : /image/.test(p.documentoEntrega.mime) ? 'ti-photo' : 'ti-file-type-doc'}"></i></span>
          <span class="archivo-info"><b>${escaparHtml(p.documentoEntrega.nombre)}</b><small>${tamano(p.documentoEntrega.tamano)}</small></span>
          <button type="button" class="btn btn-secundario btn-sm" data-ver-entrega="${p.id}"><i class="ti ti-eye"></i> Ver documento</button>
          <label class="btn btn-texto btn-sm btn-reemplazar"><i class="ti ti-replace"></i> Reemplazar
            <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-entrega="${p.id}" hidden>
          </label>
        </div>` : `
        <label class="zona-archivo zona-archivo--detalle">
          <i class="ti ti-file-upload"></i>
          <span class="zona-archivo__texto">Adjuntar documento de entrega (opcional)</span>
          <small>PDF, Word o imagen · máximo 150 MB</small>
          <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-entrega="${p.id}">
        </label>`}
    </div>`;

  return recorrido + archivo + docEntrega + detalle + oficiosHtml + acciones;
}

// ---------- Panel del paso que sigue ----------

function renderPanelAccionPedido(p, idxActual) {
  const hoy = new Date().toISOString().slice(0, 10);

  if (p.estatus === 'pagado') {
    return `<div class="panel-completo"><i class="ti ti-rosette-discount-check"></i><div><b>Contrato concluido</b><span>Se pagó el ${fmtFecha(p.fechaPagado)}.</span></div></div>`;
  }

  const panel = (titulo, ayuda, camposHtml) => `
    <div class="panel-paso-actual">
      <div class="ppa-encabezado">
        <span class="ppa-num">${idxActual + 2}</span>
        <div><div class="ppa-titulo">${titulo}</div><div class="ppa-ayuda">${ayuda}</div></div>
      </div>
      ${camposHtml}
    </div>
  `;

  switch (p.estatus) {
    case 'pedido_creado':
      return panel('Registrar entrega', 'Cuando el proveedor entregue el bien o servicio.', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="entrega">
          <label>Fecha de entrega
            <input type="date" name="fechaEntrega" value="${hoy}" required>
          </label>
          <label class="zona-archivo zona-archivo--opcional">
            <i class="ti ti-file-upload"></i>
            <span class="zona-archivo__texto" data-nombre-archivo>Adjuntar documento de entrega (opcional)</span>
            <small>Acta, remisión, evidencia… PDF, Word o imagen · máximo 150 MB</small>
            <input type="file" name="documentoEntrega" accept=".pdf,.doc,.docx,image/*">
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar entrega <i class="ti ti-arrow-right"></i></button>
        </form>
      `);

    case 'entregado':
      return panel('Registrar oficio de adecuación', 'El oficio que autoriza el monto real.', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="oficio-adecuacion">
          <div class="fila-formulario">
            <label>Folio del oficio
              <input type="text" name="folio" placeholder="Ej. SH/0716/2026" required>
            </label>
            <label>Monto autorizado
              <input type="number" name="monto" step="0.01" min="0" required>
            </label>
          </div>
          <label>Fecha del oficio
            <input type="date" name="fecha" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar oficio <i class="ti ti-arrow-right"></i></button>
        </form>
      `);

    case 'oficio_registrado':
      return panel('Registrar factura recibida', 'La factura que envió el proveedor.', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="factura">
          <div class="fila-formulario">
            <label>No. de factura
              <input type="text" name="noFactura" required>
            </label>
            <label>Monto
              <input type="number" name="monto" step="0.01" min="0" required>
            </label>
          </div>
          <label>Fecha de factura
            <input type="date" name="fecha" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar factura <i class="ti ti-arrow-right"></i></button>
        </form>
      `);

    case 'factura_recibida':
      return panel('Turnar a contabilidad', 'Fecha en que la factura pasó a contabilidad.', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="contabilidad">
          <label>Fecha en que pasó a contabilidad
            <input type="date" name="fechaContabilidad" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar <i class="ti ti-arrow-right"></i></button>
        </form>
      `);

    case 'en_contabilidad':
      return panel('Iniciar proceso de pago', 'Fecha en que contabilidad inició el pago.', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="inicio-pago">
          <label>Fecha de inicio del proceso de pago
            <input type="date" name="fechaInicioPago" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Marcar en proceso de pago <i class="ti ti-arrow-right"></i></button>
        </form>
      `);

    case 'en_pago':
      return panel('Registrar pago', 'Con esto se cierra el contrato.', `
        <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="pagado">
          <label>Fecha de pago
            <input type="date" name="fechaPagado" value="${hoy}" required>
          </label>
          <button type="submit" class="btn btn-primario btn-sm">Registrar pago y concluir <i class="ti ti-check"></i></button>
        </form>
      `);

    default:
      return '';
  }
}
