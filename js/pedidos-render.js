// =========================================================
// pedidos-render.js
// Pantalla de CONTRATOS (el flujo de 10 pasos que antes se
// llamaba Pedidos): resumen con indicadores, filtro por etapa,
// buscador y la tarjeta de cada contrato con su recorrido,
// línea de tiempo y el formulario del paso que sigue.
// =========================================================

let pedidosCache = [];
const tarjetasPedidoExpandidas = new Set();
const tarjetasMontosAbiertas = new Set();
const tarjetasHistorialAbierto = new Set();  // "Historial" desplegado
const tarjetasOficiosAbiertos = new Set();   // "Oficios de ampliación / cancelación" desplegados   // "Cantidades del contrato" desplegadas
let filtroEtapa = '';          // '' = todas las etapas
let ultimaTarjetaAbierta = null; // para animar solo la que se acaba de abrir
let animarEntrada = true;      // la entrada escalonada solo al cargar o filtrar

const PASOS_PEDIDO = [
  { clave: 'pedido_creado',     label: 'Contrato',                 corto: 'Contrato',       icono: 'ti-file-plus' },
  { clave: 'oficio_autorizado', label: 'Oficio de autorización',   corto: 'Autorización',   icono: 'ti-file-certificate' },
  { clave: 'adecuacion',        label: 'Oficio de adecuación',     corto: 'Adecuación',     icono: 'ti-adjustments-dollar', opcional: true },
  { clave: 'factura_recibida',  label: 'Contrarrecibos',           corto: 'Contrarrecibos', icono: 'ti-receipt-2' },
  { clave: 'en_contabilidad',   label: 'Contabilidad',             corto: 'Contabilidad',   icono: 'ti-calculator' },
  { clave: 'en_pago',           label: 'Proceso de pago',          corto: 'En pago',        icono: 'ti-cash' },
  { clave: 'pagado',            label: 'Pagado',                   corto: 'Pagado',         icono: 'ti-circle-check' }
];

// Qué hace falta para avanzar desde cada paso
const SIGUIENTE_PASO = {
  pedido_creado: 'Registrar el oficio de autorización',
  oficio_autorizado: 'Oficio de adecuación (opcional)',
  adecuacion: 'Registrar el primer contrarrecibo',
  factura_recibida: 'Seguimiento de cada contrarrecibo',
  en_contabilidad: 'Seguimiento de cada contrarrecibo',
  en_pago: 'Registrar los pagos de los contrarrecibos'
};

function indicePaso(estatus) {
  return ORDEN_PASOS_PEDIDO.indexOf(estatus);
}

// Un paso opcional quedó omitido si ya se pasó por él y no tiene datos
function pasoOmitido(p, clave) {
  if (indicePaso(p.estatus) < indicePaso(clave)) return false;
  if (clave === 'adecuacion') return !p.oficio;
  return false;
}

// Etapa en tres grupos, para el color de la tarjeta y la insignia
function grupoEtapa(estatus) {
  const idx = indicePaso(estatus);
  if (idx <= 1) return 'inicio';
  if (idx <= 6) return 'tramite';
  return 'pagado';
}

function claseBadgePedido(estatus) {
  return { inicio: 'badge-oficio_capturado', tramite: 'badge-en_facturacion', pagado: 'badge-completado' }[grupoEtapa(estatus)];
}

function montoDe(p) {
  return montosDelContrato(p).vigente;
}

// Qué representa el monto que se muestra en la tarjeta
function etiquetaMontoDe(p) {
  const m = montosDelContrato(p);
  if (m.autorizado !== null) return 'Autorizado';
  return 'Contratado';
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
    kpi('ti-coin', 'Monto en trámite', enTramite, 'autorizado, ejercido o contratado', true, 'kpi-destacado');

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
      (p.noContrato || '').toLowerCase().includes(texto) ||
      (p.noContrato || '').replace(/\D/g, '').includes(texto.replace(/\D/g, '') || '\u0000') ||
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
  const siguiente = SIGUIENTE_PASO[p.estatus];

  return `
    <article class="tc etapa-${grupoEtapa(p.estatus)} ${abierta ? 'abierta' : ''}" data-id="${p.id}" style="--i:${i}">
      <button type="button" class="tc-cabecera" data-toggle-pedido="${p.id}" aria-expanded="${abierta}" aria-controls="cuerpo-pedido-${p.id}">
        <span class="tc-icono"><i class="ti ${paso.icono}"></i></span>
        <span class="tc-principal">
          <span class="tc-titulo">${p.noContrato ? `<span class="tc-no-contrato">No. ${escaparHtml(p.noContrato)}</span>` : ''}${escaparHtml(p.producto)}</span>
          <span class="tc-meta">
            <span><i class="ti ti-package"></i>${escaparHtml(p.cantidad)} ${escaparHtml(p.unidadMedida || '')}</span>
            <span><i class="ti ti-building-store"></i>${escaparHtml(p.proveedor || 'Sin proveedor')}</span>
          </span>
        </span>
        <span class="tc-lado">
          <span class="tc-monto"><small>${etiquetaMontoDe(p)}</small>${fmtMoneda.format(montoDe(p))}</span>
          <span class="badge ${claseBadgePedido(p.estatus)}">${paso.label}</span>
        </span>
        <span class="tc-flecha"><i class="ti ti-chevron-down"></i></span>
      </button>
      <div class="tc-progreso">
        <div class="tc-barra" role="progressbar" aria-valuemin="1" aria-valuemax="${PASOS_PEDIDO.length}" aria-valuenow="${idx + 1}" aria-label="Avance del contrato">
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

// ---------- Cantidades del contrato (siempre a la mano) ----------

function renderMontosContrato(p) {
  const m = montosDelContrato(p);
  const fila = (etiqueta, valor, nota = '', clase = '') => `
    <div class="${clase}"><span>${etiqueta}${nota ? `<small>${nota}</small>` : ''}</span><b>${valor === null ? '<em>Pendiente</em>' : fmtMoneda.format(valor)}</b></div>`;
  const ajustes = (p.oficios || []).filter(of => !!of.posteriorReduccion === !!p.reduccion).length;
  const notaAut = p.reduccion ? 'según reducción líquida' : p.oficio ? 'según oficio de adecuación' : (p.autorizacion ? 'según oficio de autorización' : '');
  const avisos = [];
  if (m.disponible !== null && m.contrarecibos > m.disponible + 0.005) avisos.push('Los contrarrecibos suman más que el monto disponible.');
  (p.facturas || []).forEach(f => {
    if (f.factura && f.contrarecibo && f.contrarecibo.monto !== null && Math.abs(f.factura.monto - f.contrarecibo.monto) > 0.005)
      avisos.push(`La factura ${escaparHtml(f.factura.noFactura)} (${fmtMoneda.format(f.factura.monto)}) no coincide con su contrarrecibo ${escaparHtml(f.contrarecibo.noContrarecibo)} (${fmtMoneda.format(f.contrarecibo.monto)}).`);
  });
  return `
    <div class="montos-mini montos-contrato">
      ${fila('Contratado', m.contratado, 'monto del contrato')}
      ${m.autorizadoPrevio !== null ? fila('Autorizado antes de la reducción', m.autorizadoPrevio, 'reemplazado por la reducción líquida', 'previo') : ''}
      ${fila('Autorizado vigente', m.autorizado, notaAut + (ajustes ? ` · ${ajustes} ajuste${ajustes > 1 ? 's' : ''}` : ''))}
      ${fila('Contrarrecibos', m.numContrarecibos ? m.contrarecibos : null, m.numContrarecibos ? m.numContrarecibos + ' contrarrecibo' + (m.numContrarecibos > 1 ? 's' : '') : '')}
      ${m.numContrarecibos && m.porRegistrar !== null ? fila('Por registrar', m.porRegistrar, m.porRegistrar > 0.005 ? 'aún se pueden registrar contrarrecibos' : 'monto cubierto', m.porRegistrar > 0.005 ? 'pendiente' : 'completo') : ''}
      ${m.numFacturas ? fila('Facturado', m.facturado, m.numFacturas + ' factura' + (m.numFacturas > 1 ? 's' : '')) : ''}
      ${m.numContrarecibos && m.porFacturar !== null ? fila('Por facturar', m.porFacturar, m.porFacturar > 0.005 ? 'faltan facturas' : 'facturación completa', m.porFacturar > 0.005 ? 'pendiente' : 'completo') : ''}
      ${m.numFacturas ? fila('Pagado', m.pagado) : ''}
      ${fila('Monto vigente', m.vigente, '', 'total')}
    </div>
    ${avisos.map(a => `<p class="aviso-monto"><i class="ti ti-alert-triangle"></i>${a}</p>`).join('')}`;
}

// ---------- Descripción del contrato como lista ----------
// "Contrato … No. 594/2025 · Requisición 1715/2025 · Proveedor RFC …" → un punto por dato,
// con la etiqueta (lo que va antes del primer número o dos puntos) resaltada.
function renderDescripcion(texto) {
  if (!texto) return '';
  const partes = String(texto).split(/\s+·\s+|\n+|\.\s+(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+:)/).map(t => t.trim().replace(/\.$/, '')).filter(Boolean);
  if (partes.length < 2) return `<div class="desc-contrato"><p>${escaparHtml(texto)}</p></div>`;
  const item = t => {
    const m = /^([^\d:]{3,40}?)(?::\s*|\s+)(?=[\dA-Z$])(.*)$/.exec(t);
    return m && m[2] ? `<li><span>${escaparHtml(m[1].trim())}</span><b>${escaparHtml(m[2])}</b></li>` : `<li><b>${escaparHtml(t)}</b></li>`;
  };
  return `<div class="desc-contrato"><div class="subseccion-titulo">Datos del contrato</div><ul>${partes.map(item).join('')}</ul></div>`;
}

// ---------- Recorrido del contrato ----------
// Las etapas de los contrarrecibos (contrarrecibos, factura, entrega, contabilidad,
// comprobante de pago) están ligadas: si falta monto por amparar o algún
// contrarrecibo no ha llegado a una etapa, esa etapa y las siguientes parpadean.
const RECORRIDO = [
  { clave: 'contrato',     label: 'Contrato',               icono: 'ti-file-plus' },
  { clave: 'autorizacion', label: 'Oficio de autorización', icono: 'ti-file-certificate' },
  { clave: 'adecuacion',   label: 'Oficio de adecuación',   icono: 'ti-adjustments-dollar', opcional: true },
  { clave: 'cr',           label: 'Contrarrecibos',         icono: 'ti-receipt-2', etapa: 0, falta: 'faltan contrarrecibos' },
  { clave: 'factura',      label: 'Factura',                icono: 'ti-receipt', etapa: 1, falta: 'faltan facturas' },
  { clave: 'entrega',      label: 'Entrega',                icono: 'ti-truck-delivery', etapa: 2, falta: 'faltan entregas' },
  { clave: 'contab',       label: 'Contabilidad',           icono: 'ti-calculator', etapa: 3, falta: 'faltan oficios' },
  { clave: 'comprobante',  label: 'Comprobante de pago',    icono: 'ti-cash', etapa: 4, falta: 'faltan comprobantes' },
  { clave: 'pagado',       label: 'Pagado',                 icono: 'ti-circle-check' },
  { clave: 'reduccion',    label: 'Reducción líquida',      icono: 'ti-arrow-down-circle', opcional: true }
];

function renderRecorrido(p, idxActual, m) {
  const crs = p.facturas || [];
  const etapaDe = f => ['contrarecibo', 'facturado', 'entregado', 'en_contabilidad', 'en_pago', 'pagada'].indexOf(f.estado);
  const conCR = idxActual >= indicePaso('factura_recibida') && crs.length > 0;
  const faltaMonto = (m.porRegistrar || 0) > 0.005;
  const estados = RECORRIDO.map(paso => {
    if (paso.clave === 'contrato') return 'hecho';
    if (paso.clave === 'autorizacion') return idxActual >= indicePaso('oficio_autorizado') ? 'hecho' : 'siguiente';
    if (paso.clave === 'adecuacion') return pasoOmitido(p, 'adecuacion') ? 'omitido' : p.oficio ? 'hecho' : 'siguiente';
    if (paso.clave === 'reduccion') return p.reduccion ? 'hecho' : 'opcional';
    if (paso.clave === 'pagado') return p.estatus === 'pagado' ? 'hecho' : 'siguiente';
    if (!conCR) return 'siguiente';
    const atrasados = crs.filter(f => etapaDe(f) < paso.etapa).length;
    return faltaMonto || atrasados ? 'faltan' : 'hecho';
  });
  // El primero sin hacer (ni omitido ni con faltantes) es el actual
  const iActual = estados.indexOf('siguiente');
  const final = estados.map((e, i) => e === 'siguiente' ? (i === iActual ? 'actual' : 'pendiente') : e === 'opcional' ? 'pendiente' : e);
  const ultimo = final.reduce((u, e, i) => (e === 'hecho' || e === 'faltan' || e === 'omitido') ? i : u, 0);
  const n = RECORRIDO.length;
  return `
    <div class="subseccion-titulo">Recorrido del contrato</div>
    <ol class="recorrido" style="--n:${n};--avance:${ultimo / (n - 1)}">
      ${RECORRIDO.map((paso, i) => {
        const estado = final[i];
        const icono = estado === 'faltan' ? 'ti-alert-triangle' : estado === 'omitido' ? 'ti-minus' : estado === 'hecho' ? 'ti-check' : paso.icono;
        const nota = estado === 'faltan' ? paso.falta : paso.opcional && estado !== 'hecho' ? (estado === 'omitido' ? 'omitido' : 'opcional') : '';
        return `
          <li class="rec-paso ${estado}" style="--j:${i}" ${estado === 'faltan' ? `title="${textoFaltan(m) || 'Hay contrarrecibos pendientes en esta etapa'}"` : ''}>
            <span class="rec-circulo"><i class="ti ${icono}"></i></span>
            <span class="rec-label">${paso.label}${nota ? `<small>${nota}</small>` : ''}</span>
          </li>`;
      }).join('')}
    </ol>`;
}

// ---------- Cuerpo desplegado ----------

function renderCuerpoPedido(p) {
  const idxActual = indicePaso(p.estatus);
  const mRec = montosDelContrato(p);

  const recorrido = renderRecorrido(p, idxActual, mRec);

  // Línea de tiempo con lo que ya se capturó, en orden
  const m = montosDelContrato(p);
  const eventos = [
    { fecha: p.fechaSolicitud, titulo: 'Contrato', detalle: `Monto contratado ${fmtMoneda.format(p.montoEstimado || 0)}` },
    p.autorizacion && { fecha: p.autorizacion.fecha, titulo: 'Oficio de autorización', detalle: `${escaparHtml(p.autorizacion.noOficio)} · ${fmtMoneda.format(p.autorizacion.monto)}`, destacado: true },
    p.oficio && { fecha: p.oficio.fecha, titulo: 'Oficio de adecuación', detalle: `${escaparHtml(p.oficio.folio)} · ${fmtMoneda.format(p.oficio.monto)}` },
    ...(p.oficios || []).map(of => ({ fecha: of.fecha, titulo: of.tipo === 'ampliacion' ? 'Ampliación' : 'Cancelación', detalle: `${escaparHtml(of.folio)} · ${of.tipo === 'cancelacion' ? '−' : '+'}${fmtMoneda.format(of.monto)}` })),
    ...(p.facturas || []).flatMap(f => {
      const cr = 'CR ' + escaparHtml(f.contrarecibo.noContrarecibo || '');
      return [
        { fecha: f.contrarecibo.fecha, titulo: 'Contrarrecibo ' + escaparHtml(f.contrarecibo.noContrarecibo || ''), detalle: `Cuenta por pagar ${escaparHtml(f.contrarecibo.cuentaPorPagar || '')} · ${fmtMoneda.format(f.contrarecibo.monto || 0)}` },
        f.factura && { fecha: f.factura.fecha, titulo: cr + ' · factura ' + escaparHtml(f.factura.noFactura), detalle: fmtMoneda.format(f.factura.monto), largo: escaparHtml(f.factura.descripcion || '') },
        f.entrega && { fecha: f.entrega.fecha, titulo: cr + ' · entrega', detalle: '' },
        f.oficioContabilidad && { fecha: f.oficioContabilidad.fecha, titulo: cr + ' · a contabilidad', detalle: f.oficioContabilidad.noOficio ? 'Oficio ' + escaparHtml(f.oficioContabilidad.noOficio) : '' },
        f.procesoPago && { fecha: f.procesoPago.fecha, titulo: cr + ' · proceso de pago', detalle: f.procesoPago.monto !== null ? fmtMoneda.format(f.procesoPago.monto) : '' },
        f.pago && { fecha: f.pago.fecha, titulo: cr + ' · pagado', detalle: f.factura ? fmtMoneda.format(f.factura.monto) : '', destacado: true }
      ];
    }).filter(Boolean),
    p.reduccion && { fecha: p.reduccion.fecha, titulo: 'Reducción líquida', detalle: `El autorizado queda en ${fmtMoneda.format(p.reduccion.montoEjercido)}${m.autorizadoPrevio !== null ? ` (antes ${fmtMoneda.format(m.autorizadoPrevio)})` : ''}`, destacado: true },
    p.estatus === 'pagado' && p.fechaPagado && { fecha: p.fechaPagado, titulo: 'Contrato pagado', detalle: 'Proceso concluido', destacado: true }
  ].filter(Boolean).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

  // Historial: las 5 acciones más recientes; "Ver todo" abre la ventana con el detalle completo
  const recientes = eventos.slice(-5).reverse();
  const itemHist = (e, conLargo) => `
    <li class="hist-item ${e.destacado ? 'destacado' : ''}">
      <span class="hist-punto" aria-hidden="true"></span>
      <span class="hist-fecha">${fmtFecha(e.fecha)}</span>
      <div class="hist-texto"><b>${e.titulo}</b>${e.detalle ? `<span>${e.detalle}</span>` : ''}${conLargo && e.largo ? `<small>${e.largo}</small>` : ''}</div>
    </li>`;
  // En la ventana: del más reciente al más antiguo, agrupado por mes
  const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const grupos = [];
  eventos.slice().reverse().forEach(e => {
    const f = String(e.fecha || '');
    const clave = f.slice(0, 7);
    const titulo = /^\d{4}-\d{2}/.test(f) ? MESES[Number(f.slice(5, 7)) - 1] + ' ' + f.slice(0, 4) : 'Sin fecha';
    let g = grupos[grupos.length - 1];
    if (!g || g.clave !== clave) grupos.push(g = { clave, titulo, items: [] });
    g.items.push(e);
  });
  const historial = `
    <section class="historial-mitad">
      ${renderDescripcion(p.descripcion)}
      <div class="hist-encabezado">
        <div class="subseccion-titulo">Historial <span class="historial-cuenta">últimas ${recientes.length} de ${eventos.length}</span></div>
        ${eventos.length > 5 ? `<button type="button" class="btn btn-secundario btn-sm" data-abrir-cr="historial-${p.id}"><i class="ti ti-history"></i> Ver todo</button>` : ''}
      </div>
      <ol class="hist">${recientes.map(e => itemHist(e, false)).join('')}</ol>
      <div class="fi-oficio" id="historial-${p.id}" hidden>
        <div class="fi-oficio-titulo">Historial del contrato</div>
        <p class="hist-sub">${escaparHtml(p.producto)} · ${eventos.length} movimientos</p>
        <div class="hist-completo">
          ${grupos.map(g => `
            <div class="hist-mes">${g.titulo}</div>
            <ol class="hist hist-grande">${g.items.map(e => itemHist(e, true)).join('')}</ol>`).join('')}
        </div>
      </div>
    </section>`;
  const detalle = `<div class="cuerpo-mitades">${historial}<section>${renderPanelAccionPedido(p, idxActual)}</section></div>`;

  // Oficios de ampliación/cancelación: disponibles desde que hay oficio de autorización
  let oficiosHtml = '';
  if (idxActual >= indicePaso('oficio_autorizado')) {
    // Plegado como "Cantidades del contrato": se abre al tocar el encabezado
    const nOf = p.oficios.length;
    const netoOf = p.oficios.reduce((t, of) => t + (of.tipo === 'cancelacion' ? -1 : 1) * Number(of.monto), 0);
    oficiosHtml = `<details class="detalle-montos detalle-oficios" ${tarjetasOficiosAbiertos.has(p.id) ? 'open' : ''} data-oficios-id="${p.id}">
      <summary>
        <span class="dm-titulo"><i class="ti ti-chevron-right"></i> Oficios de ampliación / cancelación</span>
        <span class="dm-resumen">${nOf ? `${nOf} oficio${nOf > 1 ? 's' : ''} · neto <b>${netoOf < 0 ? '−' : '+'}${fmtMoneda.format(Math.abs(netoOf))}</b>` : 'Sin ajustes'}</span>
      </summary>
      <div class="bloque-oficios">`;
    if (p.oficios.length === 0) {
      oficiosHtml += `<p class="texto-suave">Aún no hay ajustes sobre el monto autorizado.</p>`;
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
            <input type="number" name="monto" step="0.01" min="0.01" required>
          </label>
          <label>Fecha
            <input type="date" name="fecha" required>
          </label>
        </div>
        <button type="submit" class="btn btn-secundario btn-sm"><i class="ti ti-plus"></i> Agregar oficio</button>
      </form>
    </div>
    </details>`;
  }

  const accionReduccion = idxActual >= indicePaso('oficio_autorizado') ? renderReduccion(p) : '';
  const acciones = `
    <div class="tc-acciones">
      ${accionReduccion}
      <button type="button" class="btn btn-secundario btn-sm" data-abrir-cr="editar-${p.id}"><i class="ti ti-pencil"></i> Editar información</button>
      ${renderEditarTodo(p)}
      <button type="button" class="btn btn-sm btn-eliminar" data-eliminar-pedido="${p.id}"><i class="ti ti-trash"></i> Eliminar contrato</button>
    </div>`;

  // Documentos: el contrato siempre; los demás cuando su paso ya se registró
  const docs = [
    bloqueDocumento(p, 'Contrato', p.contrato, 'contrato', 'Subir el archivo del contrato'),
    p.autorizacion ? bloqueDocumento(p, 'Oficio de autorización', p.documentoAutorizacion, 'documento-autorizacion', 'Adjuntar el oficio de autorización') : '',
    p.oficio ? bloqueDocumento(p, 'Oficio de adecuación', p.documentoAdecuacion, 'documento-adecuacion', 'Adjuntar el oficio de adecuación') : '',
    p.reduccion ? bloqueDocumento(p, 'Reducción líquida', p.documentoReduccion, 'documento-reduccion', 'Adjuntar el documento de la reducción líquida') : ''
  ].join('');

  // Cantidades del contrato: al final y plegadas; se abren al tocar el encabezado
  const mm = montosDelContrato(p);
  const cantidades = `
    <details class="detalle-montos" ${tarjetasMontosAbiertas.has(p.id) ? 'open' : ''} data-montos-id="${p.id}">
      <summary>
        <span class="dm-titulo"><i class="ti ti-chevron-right"></i> Cantidades del contrato</span>
        <span class="dm-resumen">Vigente <b>${fmtMoneda.format(mm.vigente)}</b>${mm.numContrarecibos ? ` · contrarrecibos ${fmtMoneda.format(mm.contrarecibos)}` : ''}</span>
      </summary>
      ${renderMontosContrato(p)}
    </details>`;

  return recorrido + `<div class="bloque-documentos">${docs}</div>` + detalle + renderFacturas(p, idxActual) + oficiosHtml + cantidades + acciones;
}

const tamanoArchivo = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function bloqueDocumento(p, titulo, archivo, ruta, textoSubir) {
  if (archivo) {
    const icono = /pdf/.test(archivo.mime) ? 'ti-file-type-pdf' : /image/.test(archivo.mime) ? 'ti-photo' : 'ti-file-type-doc';
    return `
      <div class="doc-boton">
        <button type="button" class="doc-ver" data-ver-doc="${ruta}" data-pedido-id="${p.id}" title="Ver ${escaparHtml(archivo.nombre)} (${tamanoArchivo(archivo.tamano)})">
          <i class="ti ${icono}"></i><span>${titulo}</span><i class="ti ti-eye doc-ojo"></i>
        </button>
        <label class="doc-reemplazar" title="Reemplazar ${titulo.toLowerCase()}" aria-label="Reemplazar ${titulo.toLowerCase()}"><i class="ti ti-replace"></i>
          <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-doc="${ruta}" data-pedido-id="${p.id}" hidden>
        </label>
      </div>`;
  }
  return `
    <label class="doc-boton doc-subir" title="${textoSubir} · PDF, Word o imagen, máximo 150 MB">
      <i class="ti ti-file-upload"></i><span>${titulo}</span><small>Subir</small>
      <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-doc="${ruta}" data-pedido-id="${p.id}" hidden>
    </label>`;
}

// ---------- Editar toda la información (ventana por secciones) ----------
function renderEditarTodo(p) {
  const v = x => escaparHtml(x === null || x === undefined ? '' : x);
  const mon = x => x === null || x === undefined ? '' : Number(x).toFixed(2);
  const t = (n, etq, val, req = true) => `<label>${etq}<input type="text" name="${n}" value="${v(val)}" ${req ? 'required' : ''}></label>`;
  const fe = (n, etq, val) => `<label>${etq}<input type="date" name="${n}" value="${v(val)}" required></label>`;
  const mo = (n, etq, val) => `<label>${etq}<input type="number" name="${n}" step="0.01" min="0.01" value="${mon(val)}" required></label>`;
  const sec = (icono, titulo, sub, cuerpo) => `
    <fieldset class="ed-seccion">
      <legend><i class="ti ${icono}"></i> ${titulo}${sub ? `<small>${sub}</small>` : ''}</legend>
      ${cuerpo}
    </fieldset>`;
  const fila = (...campos) => `<div class="ed-fila">${campos.join('')}</div>`;
  const partes = [];
  partes.push(sec('ti-file-description', 'Datos del contrato', '', `
    ${fila(t('datos.noContrato', 'No. de contrato', p.noContrato, false), t('datos.producto', 'Producto o servicio', p.producto))}
    ${fila(t('datos.proveedor', 'Proveedor', p.proveedor, false), t('datos.areaSolicitante', 'Área solicitante', p.areaSolicitante, false))}
    ${fila(`<label>Cantidad<input type="number" name="datos.cantidad" step="any" min="0" value="${v(p.cantidad)}" required></label>`, t('datos.unidadMedida', 'Unidad', p.unidadMedida, false), mo('datos.montoEstimado', 'Monto contratado', p.montoEstimado), fe('datos.fechaSolicitud', 'Fecha del contrato', p.fechaSolicitud))}
    <label>Descripción<textarea name="datos.descripcion" rows="3">${v(p.descripcion)}</textarea></label>`));
  if (p.autorizacion) partes.push(sec('ti-file-certificate', 'Oficio de autorización', '', fila(
    t('autorizacion.noOficio', 'No. de oficio', p.autorizacion.noOficio), mo('autorizacion.monto', 'Monto autorizado', p.autorizacion.monto), fe('autorizacion.fecha', 'Fecha', p.autorizacion.fecha))));
  if (p.oficio) partes.push(sec('ti-adjustments-dollar', 'Oficio de adecuación', '', fila(
    t('adecuacion.folio', 'Folio', p.oficio.folio), mo('adecuacion.monto', 'Nuevo monto autorizado', p.oficio.monto), fe('adecuacion.fecha', 'Fecha', p.oficio.fecha))));
  (p.oficios || []).forEach(of => partes.push(sec('ti-file-plus', 'Oficio de ' + (of.tipo === 'cancelacion' ? 'cancelación' : 'ampliación'), escaparHtml(of.folio), fila(
    `<label>Tipo<select name="of.${of.id}.tipo"><option value="ampliacion" ${of.tipo === 'ampliacion' ? 'selected' : ''}>Ampliación</option><option value="cancelacion" ${of.tipo === 'cancelacion' ? 'selected' : ''}>Cancelación</option></select></label>`,
    t(`of.${of.id}.folio`, 'Folio', of.folio), mo(`of.${of.id}.monto`, 'Monto', of.monto), fe(`of.${of.id}.fecha`, 'Fecha', of.fecha)))));
  (p.facturas || []).forEach(f => {
    const cr = f.contrarecibo || {}, k = 'cr.' + f.id + '.';
    const sub = (titulo, cuerpo) => `<div class="ed-sub"><div class="ed-sub-titulo">${titulo}</div>${cuerpo}</div>`;
    let cuerpo = sub('Contrarrecibo', fila(t(k + 'contrarecibo.noContrarecibo', 'No. de contrarrecibo', cr.noContrarecibo), fe(k + 'contrarecibo.fecha', 'Fecha', cr.fecha), t(k + 'contrarecibo.cuentaPorPagar', 'Cuenta por pagar', cr.cuentaPorPagar), mo(k + 'contrarecibo.monto', 'Monto', cr.monto)));
    if (f.factura) cuerpo += sub('Factura', fila(t(k + 'factura.noFactura', 'No. de factura', f.factura.noFactura), fe(k + 'factura.fecha', 'Fecha', f.factura.fecha), mo(k + 'factura.monto', 'Monto', f.factura.monto)) + `<label>Descripción<input type="text" name="${k}factura.descripcion" value="${v(f.factura.descripcion)}" required></label>`);
    if (f.entrega) cuerpo += sub('Entrega', fila(fe(k + 'entrega.fecha', 'Fecha de entrega', f.entrega.fecha)));
    if (f.oficioContabilidad) cuerpo += sub('Contabilidad', fila(t(k + 'contabilidad.noOficio', 'No. de oficio', f.oficioContabilidad.noOficio), fe(k + 'contabilidad.fecha', 'Fecha', f.oficioContabilidad.fecha), mo(k + 'contabilidad.monto', 'Monto', f.oficioContabilidad.monto)));
    if (f.procesoPago) cuerpo += sub('Comprobante de pago', fila(fe(k + 'procesoPago.fecha', 'Fecha', f.procesoPago.fecha), mo(k + 'procesoPago.monto', 'Monto', f.procesoPago.monto)));
    if (f.pago) cuerpo += sub('Pagado', fila(fe(k + 'pago.fecha', 'Fecha de pago', f.pago.fecha)));
    partes.push(sec('ti-receipt-2', 'Contrarrecibo ' + escaparHtml(cr.noContrarecibo || ''), fmtMoneda.format(cr.monto || 0), cuerpo));
  });
  if (p.reduccion) partes.push(sec('ti-arrow-down-circle', 'Reducción líquida', '', fila(mo('reduccion.montoEjercido', 'Nuevo autorizado', p.reduccion.montoEjercido), fe('reduccion.fecha', 'Fecha', p.reduccion.fecha))));
  return `
    <div class="fi-oficio" id="editar-${p.id}" hidden>
      <form class="form-editar-todo" data-pedido-id="${p.id}">
        <div class="fi-oficio-titulo">Editar información del contrato</div>
        <p class="hist-sub">Corrige cualquier dato ya registrado. Si algo no cuadra (montos o números repetidos) no se guarda nada y te decimos qué revisar.</p>
        <nav class="ed-indice">${partes.length > 3 ? (p.facturas || []).map(f => `<span>CR ${escaparHtml(f.contrarecibo.noContrarecibo || '')}</span>`).join('') : ''}</nav>
        <div class="ed-cuerpo">${partes.join('')}</div>
        <div class="ppa-botones ed-botones">
          <button type="submit" class="btn btn-primario btn-sm"><i class="ti ti-device-floppy"></i> Guardar cambios</button>
          <button type="button" class="btn btn-texto btn-sm" data-abrir-cr="editar-${p.id}">Cancelar</button>
        </div>
      </form>
    </div>`;
}

// ---------- Reducción líquida (opcional, en cualquier momento) ----------
function renderReduccion(p) {
  const m = montosDelContrato(p);
  const valor = v => v === null || v === undefined ? '' : Number(v).toFixed(2);
  const tope = p.reduccion ? m.autorizadoPrevio : m.autorizado;
  const sugerido = p.reduccion ? p.reduccion.montoEjercido : (m.facturado || m.contrarecibos);
  const hoy = new Date().toISOString().slice(0, 10);
  return `
    <button type="button" class="btn btn-secundario btn-sm" data-abrir-cr="reduccion-${p.id}"><i class="ti ti-arrow-down-circle"></i> ${p.reduccion ? 'Corregir reducción líquida' : 'Reducción líquida'}</button>
    <div class="fi-oficio" id="reduccion-${p.id}" hidden>
      <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="reduccion" data-doc="documento-reduccion">
        <div class="fi-oficio-titulo">Reducción líquida</div>
        <p class="ppa-ayuda">Opcional. Normalmente se registra al final, cuando ya está todo pagado. Reemplaza el autorizado (${fmtMoneda.format(tope || 0)}) por lo que realmente se ocupó; no puede ser menor a lo amparado en contrarrecibos (${fmtMoneda.format(m.contrarecibos)}).</p>
        <div class="fila-formulario">
          <label>¿Cuánto se gastó? (nuevo autorizado)
            <input type="number" name="montoEjercido" step="0.01" min="${valor(Math.max(0.01, m.contrarecibos))}" max="${valor(tope)}" value="${valor(sugerido)}" data-autorizado="${valor(tope)}" data-facturado="${valor(m.contrarecibos)}" required>
          </label>
          <label>Fecha
            <input type="date" name="fecha" value="${p.reduccion ? p.reduccion.fecha : hoy}" required>
          </label>
        </div>
        <p class="calculo-reduccion" data-calculo-reduccion>${tope !== null ? `Reducción: ${fmtMoneda.format(tope - sugerido)} · el contrato queda en ${fmtMoneda.format(sugerido)}` : ''}</p>
        ${campoDocumento('Adjuntar el documento de la reducción (opcional)')}
        <div class="ppa-botones">
          <button type="submit" class="btn btn-primario btn-sm">Guardar reducción <i class="ti ti-arrow-right"></i></button>
          <button type="button" class="btn btn-texto btn-sm" data-abrir-cr="reduccion-${p.id}">Cancelar</button>
        </div>
      </form>
    </div>`;
}

// ---------- Panel del paso que sigue ----------

function campoDocumento(texto) {
  return `
    <label class="zona-archivo zona-archivo--opcional">
      <i class="ti ti-file-upload"></i>
      <span class="zona-archivo__texto" data-nombre-archivo data-texto-original="${texto}">${texto}</span>
      <small>PDF, Word o imagen · máximo 150 MB</small>
      <input type="file" name="documento" accept=".pdf,.doc,.docx,image/*">
    </label>`;
}

function renderPanelAccionPedido(p, idxActual) {
  const hoy = new Date().toISOString().slice(0, 10);
  const m = montosDelContrato(p);
  const valor = v => v === null || v === undefined ? '' : Number(v).toFixed(2);

  if (p.estatus === 'pagado') {
    return `<div class="panel-completo"><i class="ti ti-rosette-discount-check"></i><div><b>Contrato concluido</b><span>Se pagó el ${fmtFecha(p.fechaPagado)}.</span></div></div>`;
  }

  // ruta = endpoint del paso; doc = ruta del documento que se puede adjuntar; opcional = muestra "Omitir"
  const panel = ({ titulo, ayuda, ruta, campos, boton, doc, opcional }) => `
    <div class="panel-paso-actual">
      <div class="ppa-encabezado">
        <span class="ppa-num">${idxActual + 2}</span>
        <div><div class="ppa-titulo">${titulo}${opcional ? ' <span class="chip-opcional">Opcional</span>' : ''}</div><div class="ppa-ayuda">${ayuda}</div></div>
      </div>
      <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="${ruta}" ${doc ? `data-doc="${doc}"` : ''}>
        ${campos}
        <div class="ppa-botones">
          <button type="submit" class="btn btn-primario btn-sm">${boton} <i class="ti ti-arrow-right"></i></button>
          ${opcional ? `<button type="button" class="btn btn-texto btn-sm" data-omitir-paso="${ruta}" data-pedido-id="${p.id}"><i class="ti ti-player-skip-forward"></i> Omitir este paso</button>` : ''}
        </div>
      </form>
    </div>
  `;

  switch (p.estatus) {
    case 'pedido_creado':
      return panel({
        titulo: 'Trámite del oficio de autorización', ruta: 'oficio-autorizacion', doc: 'documento-autorizacion', boton: 'Registrar oficio',
        ayuda: `El oficio que autoriza el monto. El contrato es por ${fmtMoneda.format(m.contratado)}.`,
        campos: `
          <div class="fila-formulario">
            <label>No. de oficio
              <input type="text" name="noOficio" placeholder="Ej. SH/0716/2026" required>
            </label>
            <label>Monto autorizado
              <input type="number" name="monto" step="0.01" min="0.01" value="${valor(m.contratado || '')}" required>
            </label>
          </div>
          ${campoDocumento('Adjuntar el oficio de autorización')}`
      });

    case 'oficio_autorizado':
      return panel({
        titulo: 'Oficio de adecuación', ruta: 'oficio-adecuacion', doc: 'documento-adecuacion', boton: 'Registrar oficio', opcional: true,
        ayuda: `Si el monto autorizado cambia. Hoy está en ${fmtMoneda.format(m.autorizado)}; el oficio de adecuación lo reemplaza.`,
        campos: `
          <div class="fila-formulario">
            <label>Folio del oficio
              <input type="text" name="folio" placeholder="Ej. SH/0716/2026" required>
            </label>
            <label>Nuevo monto autorizado
              <input type="number" name="monto" step="0.01" min="0.01" value="${valor(m.autorizado)}" required>
            </label>
          </div>
          <label>Fecha del oficio
            <input type="date" name="fecha" value="${hoy}" required>
          </label>
          ${campoDocumento('Adjuntar el oficio de adecuación')}`
      });

    case 'adecuacion':
      return panel({
        titulo: 'Primer contrarrecibo', ruta: 'contrarecibo-nuevo', doc: 'documento-contrarecibo', boton: 'Registrar contrarrecibo',
        ayuda: `Puedes registrar varios contrarrecibos hasta cubrir ${fmtMoneda.format(m.disponible)}. Cada uno lleva después su factura, entrega, contabilidad y pago.`,
        campos: camposContrarecibo(valor(m.porRegistrar), hoy) + campoDocumento('Adjuntar el contrarrecibo')
      });

    case 'factura_recibida':
    case 'en_contabilidad':    case 'en_contabilidad':
    case 'en_pago': {
      const fs = p.facturas || [];
      const cuenta = e => fs.filter(f => f.estado === e).length;
      return `
        <div class="panel-paso-actual panel-seguimiento">
          <div class="ppa-encabezado">
            <span class="ppa-num"><i class="ti ti-list-check"></i></span>
            <div><div class="ppa-titulo">Seguimiento por contrarrecibo</div>
            <div class="ppa-ayuda">Cada contrarrecibo avanza solo: factura → entrega → contabilidad → proceso de pago → pagado. El contrato se concluye cuando todos estén pagados y el monto esté cubierto.</div></div>
          </div>
          <div class="seguimiento-cuentas">
            <span><b>${cuenta('contrarecibo') + cuenta('facturado') + cuenta('entregado')}</b> por turnar</span>
            <span><b>${cuenta('en_contabilidad')}</b> en contabilidad</span>
            <span><b>${cuenta('en_pago')}</b> en pago</span>
            <span class="ok"><b>${cuenta('pagada')}</b> pagados</span>
          </div>
          ${textoFaltan(m) ? `<p class="aviso-monto"><i class="ti ti-receipt-2"></i>${textoFaltan(m)}.</p>` : ''}
          <a class="btn btn-secundario btn-sm ir-facturas" href="#facturas-${p.id}"><i class="ti ti-arrow-down"></i> Ir a los contrarrecibos</a>
        </div>`;
    }

    default:
      return '';
  }
}


// ---------- Contrarrecibos del contrato (varios) y su seguimiento ----------

// "Faltan $X en contrarrecibos · $Y por facturar" (vacío si todo está cubierto)
function textoFaltan(m) {
  const partes = [];
  if ((m.porRegistrar || 0) > 0.005) partes.push(fmtMoneda.format(m.porRegistrar) + ' en contrarrecibos');
  if ((m.porFacturar || 0) > 0.005) partes.push(fmtMoneda.format(m.porFacturar) + ' por facturar');
  return partes.length ? 'Faltan ' + partes.join(' · ') : '';
}

function camposContrarecibo(monto, fecha, cr = {}) {
  return `
    <div class="fila-formulario">
      <label>No. de contrarrecibo
        <input type="text" name="noContrarecibo" value="${escaparHtml(cr.noContrarecibo || '')}" required>
      </label>
      <label>Fecha de contrarrecibo
        <input type="date" name="fecha" value="${cr.fecha || fecha}" required>
      </label>
    </div>
    <div class="fila-formulario">
      <label>Cuenta por pagar
        <input type="text" name="cuentaPorPagar" value="${escaparHtml(cr.cuentaPorPagar || '')}" required>
      </label>
      <label>Monto
        <input type="number" name="monto" step="0.01" min="0.01" value="${monto}" required>
      </label>
    </div>`;
}

// Etapas de cada contrarrecibo, en orden
const ETAPAS_CR = [
  { clave: 'contrarecibo',    texto: 'Contrarrecibo', icono: 'ti-receipt-2' },
  { clave: 'facturado',       texto: 'Factura',       icono: 'ti-receipt' },
  { clave: 'entregado',       texto: 'Entrega',       icono: 'ti-truck-delivery' },
  { clave: 'en_contabilidad', texto: 'Contabilidad',  icono: 'ti-calculator' },
  { clave: 'en_pago',         texto: 'Proceso de pago', icono: 'ti-cash' },
  { clave: 'pagada',          texto: 'Pagado',        icono: 'ti-circle-check' }
];
const CLASE_CR = { contrarecibo: 'f-registrada', facturado: 'f-registrada', entregado: 'f-registrada', en_contabilidad: 'f-contab', en_pago: 'f-pago', pagada: 'f-pagada' };

function renderFacturas(p, idxActual) {
  if (idxActual < indicePaso('factura_recibida')) return '';
  const m = montosDelContrato(p);
  const hoy = new Date().toISOString().slice(0, 10);
  const valor = v => v === null || v === undefined ? '' : Number(v).toFixed(2);
  const docFila = (archivo, ruta, texto) => archivo
    ? `<button type="button" class="chip-doc" data-ver-doc="${ruta}" data-pedido-id="${p.id}" title="${escaparHtml(archivo.nombre)}"><i class="ti ti-file-type-pdf"></i>${texto}</button>`
    : `<label class="chip-doc chip-doc--subir" title="Adjuntar ${texto.toLowerCase()}"><i class="ti ti-paperclip"></i>${texto}<input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-doc="${ruta}" data-pedido-id="${p.id}" hidden></label>`;
  const zonaDoc = texto => `
    <label class="zona-archivo zona-archivo--opcional fi-oficio-doc">
      <i class="ti ti-file-upload"></i>
      <span class="zona-archivo__texto" data-nombre-archivo data-texto-original="${texto}">${texto}</span>
      <input type="file" name="documento" accept=".pdf,.doc,.docx,image/*">
    </label>`;
  // Formulario plegado de un avance: ruta = endpoint, doc = prefijo del documento
  const formCR = (f, idPanel, ruta, doc, titulo, campos, boton) => `
    <div class="fi-oficio" id="${idPanel}" hidden>
      <form class="form-avance-cr" data-pedido-id="${p.id}" data-fid="${f.id}" data-ruta="${ruta}" ${doc ? `data-doc="${doc}"` : ''}>
        <div class="fi-oficio-titulo">${titulo}</div>
        ${campos}
        <div class="ppa-botones">
          <button type="submit" class="btn btn-primario btn-sm">${boton} <i class="ti ti-arrow-right"></i></button>
          <button type="button" class="btn btn-texto btn-sm" data-abrir-cr="${idPanel}">Cancelar</button>
        </div>
      </form>
    </div>`;

  const filas = (p.facturas || []).map(f => {
    const cr = f.contrarecibo || {};
    const fa = f.factura, oc = f.oficioContabilidad, pp = f.procesoPago;
    const etiqueta = 'contrarrecibo ' + escaparHtml(cr.noContrarecibo || '');
    const idxE = ETAPAS_CR.findIndex(e => e.clave === f.estado);
    const montoRef = valor(fa ? fa.monto : cr.monto);
    const faltaOficio = oc && !oc.noOficio;

    // El siguiente avance de este contrarrecibo
    const sig = {
      contrarecibo: { ruta: 'factura', doc: 'documento-factura', boton: 'Registrar factura', titulo: 'Factura del ' + etiqueta, campos: `
        <div class="fila-formulario fila-4">
          <label>No. de factura<input type="text" name="noFactura" required></label>
          <label>Fecha de factura<input type="date" name="fecha" value="${hoy}" required></label>
          <label>Monto<input type="number" name="monto" step="0.01" min="0.01" value="${valor(cr.monto)}" required></label>
          <label>Descripción<input type="text" name="descripcion" value="${escaparHtml(p.producto)}" required></label>
        </div>${zonaDoc('Adjuntar la factura')}` },
      facturado: { ruta: 'entrega', doc: 'documento-entrega', boton: 'Registrar entrega', titulo: 'Entrega del ' + etiqueta, campos: `
        <div class="fila-formulario">
          <label>Fecha de entrega<input type="date" name="fecha" value="${hoy}" required></label>
          ${zonaDoc('Adjuntar documento de entrega')}
        </div>` },
      entregado: { ruta: 'contabilidad', doc: 'documento-contab', boton: 'Turnar a contabilidad', titulo: 'Oficio para contabilidad · ' + etiqueta, campos: `
        <div class="fila-formulario fila-4">
          <label>No. de oficio<input type="text" name="noOficio" placeholder="Ej. SEBISO/CA/0123/2026" required></label>
          <label>Fecha del oficio<input type="date" name="fecha" value="${hoy}" required></label>
          <label>Monto<input type="number" name="monto" step="0.01" min="0.01" value="${montoRef}" required></label>
          ${zonaDoc('Adjuntar el oficio')}
        </div>` },
      en_contabilidad: { ruta: 'inicio-pago', doc: 'documento-procpago', boton: 'Iniciar proceso de pago', titulo: 'Proceso de pago · ' + etiqueta, campos: `
        <div class="fila-formulario fila-4">
          <label>Fecha<input type="date" name="fecha" value="${hoy}" required></label>
          <label>Monto<input type="number" name="monto" step="0.01" min="0.01" value="${montoRef}" required></label>
          ${zonaDoc('Adjuntar el comprobante de pago')}
        </div>` },
      en_pago: { ruta: 'pagado', doc: '', boton: 'Marcar pagado', titulo: 'Pago del ' + etiqueta, campos: `
        <div class="fila-formulario">
          <label>Fecha de pago<input type="date" name="fecha" value="${hoy}" required></label>
        </div>` }
    }[f.estado];
    const idSig = 'cr-sig-' + f.id, idEdit = 'cr-edit-' + f.id, idOf = 'cr-oficio-' + f.id;
    const accion = sig
      ? `<button type="button" class="btn btn-primario btn-sm" data-abrir-cr="${idSig}">${sig.boton}</button>`
      : `<span class="f-listo"><i class="ti ti-circle-check"></i> Pagado el ${fmtFecha(f.pago && f.pago.fecha)}</span>`;

    const pasos = ETAPAS_CR.map((e, i) => `<span class="cr-etapa ${i <= idxE ? 'hecha' : i === idxE + 1 ? 'sigue' : ''}" title="${e.texto}"><i class="ti ${i <= idxE ? 'ti-check' : e.icono}"></i>${e.texto}</span>`).join('');

    // Ventana con toda la información del contrarrecibo, etapa por etapa, y lo que falta
    const dato = (etq, val) => `<div class="det-dato${etq === 'Descripción' ? ' det-ancho' : ''}"><dt>${etq}</dt><dd>${val || '<em>—</em>'}</dd></div>`;
    const docDet = (archivo, ruta, texto) => archivo
      ? `<button type="button" class="btn btn-secundario btn-xs" data-ver-doc="${ruta}" data-pedido-id="${p.id}"><i class="ti ti-file-type-pdf"></i> Ver ${texto}</button>`
      : `<span class="det-sin-doc"><i class="ti ti-file-off"></i> Sin documento</span>`;
    const etapasDet = [
      { titulo: 'Contrarrecibo', icono: 'ti-receipt-2', hecho: true, datos: [dato('No.', escaparHtml(cr.noContrarecibo)), dato('Fecha', fmtFecha(cr.fecha)), dato('Cuenta por pagar', escaparHtml(cr.cuentaPorPagar)), dato('Monto', fmtMoneda.format(cr.monto || 0))], doc: docDet(cr.documento, 'documento-contrarecibo-' + f.id, 'contrarrecibo') },
      { titulo: 'Factura', icono: 'ti-receipt', hecho: !!fa, datos: fa ? [dato('No.', escaparHtml(fa.noFactura)), dato('Fecha', fmtFecha(fa.fecha)), dato('Monto', fmtMoneda.format(fa.monto)), dato('Descripción', escaparHtml(fa.descripcion))] : [], doc: fa ? docDet(fa.documento, 'documento-factura-' + f.id, 'factura') : '' },
      { titulo: 'Entrega', icono: 'ti-truck-delivery', hecho: !!f.entrega, datos: f.entrega ? [dato('Fecha', fmtFecha(f.entrega.fecha))] : [], doc: f.entrega ? docDet(f.entrega.documento, 'documento-entrega-' + f.id, 'entrega') : '' },
      { titulo: 'Contabilidad', icono: 'ti-calculator', hecho: !!oc, datos: oc ? [dato('No. de oficio', escaparHtml(oc.noOficio)), dato('Fecha', fmtFecha(oc.fecha)), dato('Monto', oc.monto !== null ? fmtMoneda.format(oc.monto) : '')] : [], doc: oc ? docDet(oc.documento, 'documento-contab-' + f.id, 'oficio') : '' },
      { titulo: 'Comprobante de pago', icono: 'ti-cash', hecho: !!pp, datos: pp ? [dato('Fecha', fmtFecha(pp.fecha)), dato('Monto', pp.monto !== null ? fmtMoneda.format(pp.monto) : '')] : [], doc: pp ? docDet(pp.documento, 'documento-procpago-' + f.id, 'comprobante') : '' },
      { titulo: 'Pagado', icono: 'ti-circle-check', hecho: !!f.pago, datos: f.pago ? [dato('Fecha de pago', fmtFecha(f.pago.fecha))] : [], doc: '' }
    ];
    const faltan = etapasDet.filter(e => !e.hecho).map(e => e.titulo);
    const sinDocs = etapasDet.filter(e => e.hecho && e.doc && e.doc.includes('det-sin-doc')).map(e => e.titulo);
    const iSig = etapasDet.findIndex(e => !e.hecho);
    const detalle = `
      <div class="fi-oficio" id="cr-det-${f.id}" hidden>
        <div class="fi-oficio-titulo">Contrarrecibo ${escaparHtml(cr.noContrarecibo || '')}</div>
        <p class="hist-sub">${p.noContrato ? 'Contrato ' + escaparHtml(p.noContrato) + ' · ' : ''}${escaparHtml(p.producto)}</p>
        <div class="det-resumen">
          <div><small>Monto</small><b>${fmtMoneda.format(cr.monto || 0)}</b></div>
          <div><small>Estado</small><b>${f.estado === 'pagada' ? 'Pagado' : (ETAPAS_CR[idxE] ? ETAPAS_CR[idxE].texto : '')}</b></div>
          <div><small>Avance</small><b>${etapasDet.length - faltan.length} de ${etapasDet.length} etapas</b></div>
        </div>
        ${faltan.length || sinDocs.length ? `<div class="det-faltan"><i class="ti ti-alert-triangle"></i><div>${faltan.length ? `<b>Falta:</b> ${faltan.join(' · ')}` : ''}${faltan.length && sinDocs.length ? '<br>' : ''}${sinDocs.length ? `<b>Sin documento:</b> ${sinDocs.join(' · ')}` : ''}</div></div>` : `<div class="det-completo"><i class="ti ti-circle-check"></i> Contrarrecibo completo, con todos sus documentos.</div>`}
        <ol class="det-etapas">
          ${etapasDet.map((e, k) => `
            <li class="det-etapa ${e.hecho ? 'hecha' : k === iSig ? 'sigue' : 'pendiente'}">
              <span class="det-icono"><i class="ti ${e.hecho ? 'ti-check' : e.icono}"></i></span>
              <div class="det-cuerpo">
                <div class="det-cab"><b>${e.titulo}</b><span class="det-chip">${e.hecho ? 'Registrado' : k === iSig ? 'Sigue' : 'Pendiente'}</span>${e.doc}</div>
                ${e.datos.length ? `<dl class="det-datos">${e.datos.join('')}</dl>` : `<p class="det-vacio">${k === iSig ? 'Es el siguiente paso de este contrarrecibo.' : 'Aún no se registra.'}</p>`}
              </div>
            </li>`).join('')}
        </ol>
      </div>`;

    return `
      <li class="factura-item ${CLASE_CR[f.estado]}">
        <div class="fi-principal">
          <span class="fi-no-fila"><span class="fi-no">CR ${escaparHtml(cr.noContrarecibo || '')}</span><button type="button" class="btn btn-secundario btn-xs" data-abrir-cr="cr-det-${f.id}"><i class="ti ti-list-details"></i> Ver información detallada</button></span>
          <span class="fi-desc">${fa ? escaparHtml(fa.descripcion || '') : 'Sin factura aún'}</span>
          ${faltaOficio ? `<button type="button" class="fi-falta-oficio" data-abrir-cr="${idOf}"><i class="ti ti-alert-triangle"></i> Falta el oficio de contabilidad · completar</button>` : ''}
        </div>
        <span class="fi-monto">${fmtMoneda.format(cr.monto || 0)}</span>
        <span class="fi-estado">${ETAPAS_CR[idxE] ? (f.estado === 'pagada' ? 'Pagado' : ETAPAS_CR[idxE].texto) : ''}</span>
        <div class="fi-docs">
          ${docFila(cr.documento, 'documento-contrarecibo-' + f.id, 'Contrarrecibo')}
          ${fa ? docFila(fa.documento, 'documento-factura-' + f.id, 'Factura') : ''}
          ${f.entrega ? docFila(f.entrega.documento, 'documento-entrega-' + f.id, 'Entrega') : ''}
          ${oc ? docFila(oc.documento, 'documento-contab-' + f.id, 'Oficio contab.') : ''}
          ${pp ? docFila(pp.documento, 'documento-procpago-' + f.id, 'Comprobante de pago') : ''}
          ${f.pago && f.pago.documento ? docFila(f.pago.documento, 'documento-pago-' + f.id, 'Pago') : ''}
        </div>
        <div class="fi-accion">
          ${accion}
          ${f.estado !== 'pagada' ? `<button type="button" class="btn btn-texto btn-sm" data-abrir-cr="${idEdit}"><i class="ti ti-pencil"></i> Editar contrarrecibo</button>` : ''}
        </div>
        ${f.estado !== 'pagada' ? `<button type="button" class="btn-icono" data-eliminar-factura="${f.id}" data-pedido-id="${p.id}" title="Eliminar contrarrecibo" aria-label="Eliminar ${etiqueta}"><i class="ti ti-trash"></i></button>` : ''}
        ${detalle}
        ${sig ? formCR(f, idSig, sig.ruta, sig.doc, sig.titulo, sig.campos, sig.boton) : ''}
        ${f.estado !== 'pagada' ? formCR(f, idEdit, 'contrarecibo', '', 'Editar ' + etiqueta, camposContrarecibo(valor(cr.monto), hoy, cr), 'Guardar cambios') : ''}
        ${faltaOficio ? formCR(f, idOf, 'oficio-contabilidad', 'documento-contab', 'Oficio para contabilidad · ' + etiqueta, `
          <div class="fila-formulario fila-4">
            <label>No. de oficio<input type="text" name="noOficio" required></label>
            <label>Fecha del oficio<input type="date" name="fecha" value="${oc.fecha || hoy}" required></label>
            <label>Monto<input type="number" name="monto" step="0.01" min="0.01" value="${montoRef}" required></label>
            ${zonaDoc('Adjuntar el oficio')}
          </div>`, 'Guardar oficio') : ''}
      </li>`;
  }).join('');

  const puedeAgregar = m.porRegistrar === null || m.porRegistrar > 0.005;
  const formNueva = puedeAgregar && (p.facturas || []).length ? `
    <button type="button" class="nueva-factura nueva-cr-btn" data-abrir-cr="cr-nuevo-${p.id}"><i class="ti ti-plus"></i> Registrar otro contrarrecibo <span>· por registrar ${m.porRegistrar !== null ? fmtMoneda.format(m.porRegistrar) : ''}</span></button>
    <div class="fi-oficio" id="cr-nuevo-${p.id}" hidden>
      <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="contrarecibo-nuevo" data-doc="documento-contrarecibo">
        <div class="fi-oficio-titulo">Nuevo contrarrecibo</div>
        ${camposContrarecibo(valor(m.porRegistrar), hoy)}
        ${campoDocumento('Adjuntar el contrarrecibo')}
        <div class="ppa-botones">
          <button type="submit" class="btn btn-primario btn-sm">Registrar contrarrecibo <i class="ti ti-arrow-right"></i></button>
          <button type="button" class="btn btn-texto btn-sm" data-abrir-cr="cr-nuevo-${p.id}">Cancelar</button>
        </div>
      </form>
    </div>` : (!puedeAgregar ? `<p class="facturas-completo"><i class="ti ti-circle-check"></i> Monto cubierto: ${fmtMoneda.format(m.contrarecibos)} de ${fmtMoneda.format(m.disponible)} en contrarrecibos.</p>` : '');

  return `
    <div class="bloque-facturas" id="facturas-${p.id}">
      <div class="subseccion-titulo">Contrarrecibos ${textoFaltan(m) && (p.facturas || []).length ? `<span class="alerta-faltan" role="status" title="${textoFaltan(m)}"><i class="ti ti-alert-triangle"></i>Falta ${fmtMoneda.format(Math.max(m.porRegistrar || 0, m.porFacturar || 0))}</span>` : ''}<span class="facturas-resumen">${m.disponible !== null ? `${Math.round(m.contrarecibos / (m.disponible || 1) * 100)}% cubierto` : m.numContrarecibos}</span></div>
      ${filas ? `<ul class="lista-facturas">${filas}</ul>` : '<p class="texto-suave">Aún no hay contrarrecibos.</p>'}
      ${formNueva}
    </div>`;
}
