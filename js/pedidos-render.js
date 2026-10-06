// =========================================================
// pedidos-render.js
// Pantalla de CONTRATOS (el flujo de 10 pasos que antes se
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
  { clave: 'pedido_creado',     label: 'Contrato',                 corto: 'Contrato',      icono: 'ti-file-plus' },
  { clave: 'oficio_autorizado', label: 'Oficio de autorización',   corto: 'Autorización',  icono: 'ti-file-certificate' },
  { clave: 'contrarecibo',      label: 'Contrarrecibo',            corto: 'Contrarrecibo', icono: 'ti-receipt-2' },
  { clave: 'adecuacion',        label: 'Oficio de adecuación',     corto: 'Adecuación',    icono: 'ti-adjustments-dollar', opcional: true },
  { clave: 'factura_recibida',  label: 'Facturas',                 corto: 'Facturas',      icono: 'ti-receipt' },
  { clave: 'reduccion',         label: 'Reducción',                corto: 'Reducción',     icono: 'ti-arrow-down-circle', opcional: true },
  { clave: 'entregado',         label: 'Entrega',                  corto: 'Entrega',       icono: 'ti-truck-delivery', opcional: true },
  { clave: 'en_contabilidad',   label: 'Contabilidad',             corto: 'Contabilidad',  icono: 'ti-calculator' },
  { clave: 'en_pago',           label: 'Proceso de pago',          corto: 'En pago',       icono: 'ti-cash' },
  { clave: 'pagado',            label: 'Pagado',                   corto: 'Pagado',        icono: 'ti-circle-check' }
];

// Qué hace falta para avanzar desde cada paso
const SIGUIENTE_PASO = {
  pedido_creado: 'Registrar el oficio de autorización',
  oficio_autorizado: 'Registrar el contrarrecibo',
  contrarecibo: 'Oficio de adecuación (opcional)',
  adecuacion: 'Registrar la primera factura',
  factura_recibida: 'Reducción (opcional)',
  reduccion: 'Entrega (opcional)',
  entregado: 'Seguimiento de facturas en contabilidad',
  en_contabilidad: 'Seguimiento de pagos de facturas',
  en_pago: 'Registrar los pagos de las facturas'
};

function indicePaso(estatus) {
  return ORDEN_PASOS_PEDIDO.indexOf(estatus);
}

// Un paso opcional quedó omitido si ya se pasó por él y no tiene datos
function pasoOmitido(p, clave) {
  if (indicePaso(p.estatus) < indicePaso(clave)) return false;
  if (clave === 'adecuacion') return !p.oficio;
  if (clave === 'reduccion') return !p.reduccion;
  if (clave === 'entregado') return !p.fechaEntrega;
  return false;
}

// Etapa en tres grupos, para el color de la tarjeta y la insignia
function grupoEtapa(estatus) {
  const idx = indicePaso(estatus);
  if (idx <= 1) return 'inicio';
  if (idx <= 8) return 'tramite';
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
  if (m.ejercido !== null) return 'Ejercido';
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
          <span class="tc-titulo">${escaparHtml(p.producto)}</span>
          <span class="tc-meta">
            <span><i class="ti ti-package"></i>${escaparHtml(p.cantidad)} ${escaparHtml(p.unidadMedida || '')}</span>
            <span><i class="ti ti-building-store"></i>${escaparHtml(p.proveedor || 'Sin proveedor')}</span>
            ${p.areaSolicitante ? `<span><i class="ti ti-users"></i>${escaparHtml(p.areaSolicitante)}</span>` : ''}
            ${p.contrato ? `<span class="tc-adjunto"><i class="ti ti-paperclip"></i>Contrato adjunto</span>` : `<span class="tc-sin-adjunto"><i class="ti ti-alert-circle"></i>Sin archivo de contrato</span>`}
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
  const ajustes = (p.oficios || []).length;
  const notaAut = p.oficio ? 'según oficio de adecuación' : (p.autorizacion ? 'según oficio de autorización' : '');
  const avisos = [];
  if (m.disponible !== null && m.facturado > m.disponible + 0.005) avisos.push('Lo facturado es mayor al monto disponible.');
  if (m.contrarecibo !== null && m.autorizado !== null && Math.abs(m.contrarecibo - m.autorizado) > 0.005) avisos.push(`El contrarrecibo difiere del autorizado por ${fmtMoneda.format(Math.abs(m.contrarecibo - m.autorizado))}.`);
  return `
    <div class="montos-mini montos-contrato">
      ${fila('Contratado', m.contratado, 'monto del contrato')}
      ${fila('Autorizado vigente', m.autorizado, notaAut + (ajustes ? ` · ${ajustes} ajuste${ajustes > 1 ? 's' : ''}` : ''))}
      ${fila('Contrarrecibo', m.contrarecibo)}
      ${fila('Facturado', m.numFacturas ? m.facturado : null, m.numFacturas ? m.numFacturas + ' factura' + (m.numFacturas > 1 ? 's' : '') : '')}
      ${m.numFacturas ? fila('Pagado', m.pagado) : ''}
      ${m.porFacturar !== null && m.numFacturas ? fila('Por facturar', m.porFacturar, m.porFacturar > 0.005 ? 'aún se pueden registrar facturas' : 'facturación completa', m.porFacturar > 0.005 ? 'pendiente' : 'completo') : ''}
      ${m.ejercido !== null ? fila('Reducción', -m.reduccion, 'sobrante que se libera', 'reduccion') : ''}
      ${fila(m.ejercido !== null ? 'Ejercido (final)' : 'Monto vigente', m.vigente, m.ejercido !== null ? 'lo que realmente se gastó' : '', 'total')}
    </div>
    ${avisos.map(a => `<p class="aviso-monto"><i class="ti ti-alert-triangle"></i>${a}</p>`).join('')}`;
}

// ---------- Cuerpo desplegado ----------

function renderCuerpoPedido(p) {
  const idxActual = indicePaso(p.estatus);

  const recorrido = `
    <div class="subseccion-titulo">Recorrido del contrato</div>
    <ol class="recorrido" style="--avance:${idxActual / (PASOS_PEDIDO.length - 1)}">
      ${PASOS_PEDIDO.map((paso, i) => {
        const omitido = pasoOmitido(p, paso.clave);
        // "estatus" es el último paso ya registrado: lo de antes está hecho y el siguiente es el actual
        const estado = omitido ? 'omitido' : i <= idxActual ? 'hecho' : i === idxActual + 1 ? 'actual' : 'pendiente';
        const icono = omitido ? 'ti-minus' : i <= idxActual ? 'ti-check' : paso.icono;
        return `
          <li class="rec-paso ${estado}" style="--j:${i}">
            <span class="rec-circulo"><i class="ti ${icono}"></i></span>
            <span class="rec-label">${paso.label}${paso.opcional ? `<small>${omitido ? 'omitido' : 'opcional'}</small>` : ''}</span>
          </li>`;
      }).join('')}
    </ol>
  `;

  // Línea de tiempo con lo que ya se capturó, en orden
  const m = montosDelContrato(p);
  const eventos = [
    { fecha: p.fechaSolicitud, titulo: 'Contrato', detalle: `Monto contratado ${fmtMoneda.format(p.montoEstimado || 0)}` },
    p.autorizacion && { fecha: p.autorizacion.fecha, titulo: 'Oficio de autorización', detalle: `${escaparHtml(p.autorizacion.noOficio)} · ${fmtMoneda.format(p.autorizacion.monto)}`, destacado: true },
    p.contrarecibo && { fecha: p.contrarecibo.fecha, titulo: 'Contrarrecibo', detalle: `No. ${escaparHtml(p.contrarecibo.noContrarecibo)} · Cuenta por pagar ${escaparHtml(p.contrarecibo.cuentaPorPagar)} · ${fmtMoneda.format(p.contrarecibo.monto)}` },
    p.oficio && { fecha: p.oficio.fecha, titulo: 'Oficio de adecuación', detalle: `${escaparHtml(p.oficio.folio)} · ${fmtMoneda.format(p.oficio.monto)}` },
    ...(p.oficios || []).map(of => ({ fecha: of.fecha, titulo: of.tipo === 'ampliacion' ? 'Ampliación' : 'Cancelación', detalle: `${escaparHtml(of.folio)} · ${of.tipo === 'cancelacion' ? '−' : '+'}${fmtMoneda.format(of.monto)}` })),
    ...(p.facturas || []).flatMap(f => [
      { fecha: f.fecha, titulo: 'Factura ' + escaparHtml(f.noFactura), detalle: `${fmtMoneda.format(f.monto)} · ${escaparHtml(f.descripcion || '')}` },
      f.fechaContabilidad && { fecha: f.fechaContabilidad, titulo: 'Factura ' + escaparHtml(f.noFactura) + ' a contabilidad', detalle: '' },
      f.fechaInicioPago && { fecha: f.fechaInicioPago, titulo: 'Factura ' + escaparHtml(f.noFactura) + ' en pago', detalle: '' },
      f.fechaPagado && { fecha: f.fechaPagado, titulo: 'Factura ' + escaparHtml(f.noFactura) + ' pagada', detalle: fmtMoneda.format(f.monto), destacado: true }
    ]).filter(Boolean),
    p.reduccion && { fecha: p.reduccion.fecha, titulo: 'Reducción', detalle: `Se ejerció ${fmtMoneda.format(p.reduccion.montoEjercido)}${m.reduccion !== null ? ` · se liberan ${fmtMoneda.format(m.reduccion)}` : ''}`, destacado: true },
    p.fechaEntrega && indicePaso(p.estatus) >= indicePaso('entregado') && { fecha: p.fechaEntrega, titulo: 'Entrega', detalle: 'El proveedor entregó el bien o servicio' },
    p.estatus === 'pagado' && p.fechaPagado && { fecha: p.fechaPagado, titulo: 'Contrato pagado', detalle: 'Proceso concluido', destacado: true }
  ].filter(Boolean).sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));

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
        <div class="subseccion-titulo subseccion-montos">Cantidades del contrato</div>
        ${renderMontosContrato(p)}
      </section>
    </div>
  `;

  // Oficios de ampliación/cancelación: disponibles desde que hay oficio de autorización
  let oficiosHtml = '';
  if (idxActual >= indicePaso('oficio_autorizado')) {
    oficiosHtml = `<div class="bloque-oficios"><div class="subseccion-titulo">Oficios de ampliación / cancelación</div>`;
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
    </div>`;
  }

  const acciones = `
    <div class="tc-acciones">
      <button type="button" class="btn btn-secundario btn-sm" data-editar-pedido="${p.id}"><i class="ti ti-pencil"></i> Editar datos</button>
      <button type="button" class="btn btn-texto btn-sm" data-eliminar-pedido="${p.id}"><i class="ti ti-trash"></i> Eliminar contrato</button>
    </div>`;

  // Documentos: el contrato siempre; los demás cuando su paso ya se registró
  const docs = [
    bloqueDocumento(p, 'Contrato', p.contrato, 'contrato', 'Subir el archivo del contrato'),
    p.autorizacion ? bloqueDocumento(p, 'Oficio de autorización', p.documentoAutorizacion, 'documento-autorizacion', 'Adjuntar el oficio de autorización') : '',
    p.contrarecibo ? bloqueDocumento(p, 'Contrarrecibo', p.documentoContrarecibo, 'documento-contrarecibo', 'Adjuntar el contrarrecibo') : '',
    p.oficio ? bloqueDocumento(p, 'Oficio de adecuación', p.documentoAdecuacion, 'documento-adecuacion', 'Adjuntar el oficio de adecuación') : '',
    p.reduccion ? bloqueDocumento(p, 'Reducción', p.documentoReduccion, 'documento-reduccion', 'Adjuntar el documento de la reducción') : '',
    p.fechaEntrega && idxActual >= indicePaso('entregado') ? bloqueDocumento(p, 'Documento de entrega', p.documentoEntrega, 'documento-entrega', 'Adjuntar documento de entrega (opcional)') : ''
  ].join('');

  return recorrido + `<div class="bloque-documentos">${docs}</div>` + detalle + renderFacturas(p, idxActual) + oficiosHtml + acciones;
}

const tamanoArchivo = b => b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';

function bloqueDocumento(p, titulo, archivo, ruta, textoSubir) {
  return `
    <div class="bloque-archivo">
      <div class="subseccion-titulo">${titulo}</div>
      ${archivo ? `
        <div class="archivo-fila">
          <span class="archivo-icono"><i class="ti ${/pdf/.test(archivo.mime) ? 'ti-file-type-pdf' : /image/.test(archivo.mime) ? 'ti-photo' : 'ti-file-type-doc'}"></i></span>
          <span class="archivo-info"><b>${escaparHtml(archivo.nombre)}</b><small>${tamanoArchivo(archivo.tamano)}</small></span>
          <button type="button" class="btn btn-secundario btn-sm" data-ver-doc="${ruta}" data-pedido-id="${p.id}"><i class="ti ti-eye"></i> Ver</button>
          <label class="btn btn-texto btn-sm btn-reemplazar"><i class="ti ti-replace"></i> Reemplazar
            <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-doc="${ruta}" data-pedido-id="${p.id}" hidden>
          </label>
        </div>` : `
        <label class="zona-archivo zona-archivo--detalle">
          <i class="ti ti-file-upload"></i>
          <span class="zona-archivo__texto">${textoSubir}</span>
          <small>PDF, Word o imagen · máximo 150 MB</small>
          <input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-doc="${ruta}" data-pedido-id="${p.id}">
        </label>`}
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
        titulo: 'Contrarrecibo', ruta: 'contrarecibo', doc: 'documento-contrarecibo', boton: 'Registrar contrarrecibo',
        ayuda: `Autorizado vigente: ${fmtMoneda.format(m.autorizado)}.`,
        campos: `
          <div class="fila-formulario">
            <label>No. de contrarrecibo
              <input type="text" name="noContrarecibo" required>
            </label>
            <label>Fecha de contrarrecibo
              <input type="date" name="fecha" value="${hoy}" required>
            </label>
          </div>
          <div class="fila-formulario">
            <label>Cuenta por pagar
              <input type="text" name="cuentaPorPagar" required>
            </label>
            <label>Monto
              <input type="number" name="monto" step="0.01" min="0.01" value="${valor(m.autorizado)}" required>
            </label>
          </div>
          ${campoDocumento('Adjuntar el contrarrecibo')}`
      });

    case 'contrarecibo':
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
        titulo: 'Primera factura', ruta: 'factura-nueva', doc: 'documento-factura', boton: 'Registrar factura',
        ayuda: `Puedes registrar varias facturas hasta cubrir ${fmtMoneda.format(m.disponible)}. Con la primera ya puedes avanzar.`,
        campos: `
          <div class="fila-formulario">
            <label>No. de factura
              <input type="text" name="noFactura" required>
            </label>
            <label>Fecha de factura
              <input type="date" name="fecha" value="${hoy}" required>
            </label>
          </div>
          <label>Descripción
            <input type="text" name="descripcion" value="${escaparHtml(p.producto)}" required>
          </label>
          <label>Monto
            <input type="number" name="monto" step="0.01" min="0.01" max="${valor(m.porFacturar)}" value="${valor(m.porFacturar)}" required>
          </label>
          ${campoDocumento('Adjuntar la factura')}`
      });

    case 'factura_recibida':
      return panel({
        titulo: 'Reducción', ruta: 'reduccion', doc: 'documento-reduccion', boton: 'Registrar reducción', opcional: true,
        ayuda: `Si no se ocupó todo lo autorizado (${fmtMoneda.format(m.autorizado)}), indica cuánto se gastó y el sobrante se reduce. No puede ser menor a lo ya facturado (${fmtMoneda.format(m.facturado)}). Las facturas que falten se pueden seguir registrando.`,
        campos: `
          <label>¿Cuánto se gastó del total autorizado?
            <input type="number" name="montoEjercido" step="0.01" min="${valor(Math.max(0.01, m.facturado))}" max="${valor(m.autorizado)}" value="${valor(m.facturado)}" data-autorizado="${valor(m.autorizado)}" data-facturado="${valor(m.facturado)}" required>
          </label>
          <p class="calculo-reduccion" data-calculo-reduccion>${m.facturado !== null && m.autorizado !== null ? `Reducción: ${fmtMoneda.format(m.autorizado - m.facturado)} · el contrato queda en ${fmtMoneda.format(m.facturado)}` : ''}</p>
          ${campoDocumento('Adjuntar el documento de la reducción (opcional)')}`
      });

    case 'reduccion':
      return panel({
        titulo: 'Entrega', ruta: 'entrega', doc: 'documento-entrega', boton: 'Registrar entrega', opcional: true,
        ayuda: 'Cuando el proveedor entregue el bien o servicio.',
        campos: `
          <label>Fecha de entrega
            <input type="date" name="fechaEntrega" value="${p.fechaEntrega || hoy}" required>
          </label>
          ${campoDocumento('Adjuntar documento de entrega (opcional)')}`
      });

    case 'entregado':
    case 'en_contabilidad':
    case 'en_pago': {
      const fs = p.facturas || [];
      const cuenta = e => fs.filter(f => f.estado === e).length;
      return `
        <div class="panel-paso-actual panel-seguimiento">
          <div class="ppa-encabezado">
            <span class="ppa-num"><i class="ti ti-list-check"></i></span>
            <div><div class="ppa-titulo">Seguimiento por factura</div>
            <div class="ppa-ayuda">Cada factura avanza sola: contabilidad → proceso de pago → pagada. El contrato se concluye cuando todas estén pagadas y no quede nada por facturar.</div></div>
          </div>
          <div class="seguimiento-cuentas">
            <span><b>${cuenta('registrada')}</b> por turnar</span>
            <span><b>${cuenta('en_contabilidad')}</b> en contabilidad</span>
            <span><b>${cuenta('en_pago')}</b> en pago</span>
            <span class="ok"><b>${cuenta('pagada')}</b> pagadas</span>
          </div>
          ${m.porFacturar > 0.005 ? `<p class="aviso-monto"><i class="ti ti-receipt"></i>Faltan ${fmtMoneda.format(m.porFacturar)} por facturar.</p>` : ''}
          <a class="btn btn-secundario btn-sm ir-facturas" href="#facturas-${p.id}"><i class="ti ti-arrow-down"></i> Ir a las facturas</a>
        </div>`;
    }

    default:
      return '';
  }
}


// ---------- Facturas del contrato (varias) y su seguimiento ----------

const ESTADO_FACTURA = {
  registrada:      { texto: 'Registrada',      clase: 'f-registrada', siguiente: 'contabilidad', boton: 'Turnar a contabilidad', campo: 'Fecha en que pasó a contabilidad' },
  en_contabilidad: { texto: 'En contabilidad', clase: 'f-contab',     siguiente: 'inicio-pago',  boton: 'Iniciar pago',          campo: 'Fecha de inicio del pago' },
  en_pago:         { texto: 'En pago',         clase: 'f-pago',       siguiente: 'pagado',       boton: 'Registrar pago',        campo: 'Fecha de pago' },
  pagada:          { texto: 'Pagada',          clase: 'f-pagada' }
};

function renderFacturas(p, idxActual) {
  if (idxActual < indicePaso('factura_recibida')) return '';
  const m = montosDelContrato(p);
  const hoy = new Date().toISOString().slice(0, 10);
  const valor = v => v === null || v === undefined ? '' : Number(v).toFixed(2);
  const docFila = (archivo, ruta, texto) => archivo
    ? `<button type="button" class="chip-doc" data-ver-doc="${ruta}" data-pedido-id="${p.id}" title="${escaparHtml(archivo.nombre)}"><i class="ti ti-file-type-pdf"></i>${texto}</button>`
    : `<label class="chip-doc chip-doc--subir" title="Adjuntar ${texto.toLowerCase()}"><i class="ti ti-paperclip"></i>${texto}<input type="file" accept=".pdf,.doc,.docx,image/*" data-subir-doc="${ruta}" data-pedido-id="${p.id}" hidden></label>`;

  const filas = (p.facturas || []).map(f => {
    const e = ESTADO_FACTURA[f.estado];
    const avance = e.siguiente ? `
      <form class="form-avance-factura" data-pedido-id="${p.id}" data-fid="${f.id}" data-avance="${e.siguiente}">
        <label class="sr-solo" for="av-${f.id}">${e.campo}</label>
        <input type="date" id="av-${f.id}" name="fecha" value="${hoy}" required title="${e.campo}">
        <button type="submit" class="btn btn-primario btn-sm">${e.boton}</button>
      </form>` : `<span class="f-listo"><i class="ti ti-circle-check"></i> Pagada el ${fmtFecha(f.fechaPagado)}</span>`;
    return `
      <li class="factura-item ${e.clase}">
        <div class="fi-principal">
          <span class="fi-no">${escaparHtml(f.noFactura)}</span>
          <span class="fi-desc">${escaparHtml(f.descripcion || '')}</span>
          <span class="fi-meta">${fmtFecha(f.fecha)}${f.fechaContabilidad ? ' · contab. ' + fmtFecha(f.fechaContabilidad) : ''}${f.fechaInicioPago ? ' · pago iniciado ' + fmtFecha(f.fechaInicioPago) : ''}</span>
        </div>
        <span class="fi-monto">${fmtMoneda.format(f.monto)}</span>
        <span class="fi-estado">${e.texto}</span>
        <div class="fi-docs">
          ${docFila(f.documento, 'documento-factura-' + f.id, 'Factura')}
          ${f.estado === 'pagada' || f.estado === 'en_pago' ? docFila(f.comprobante, 'documento-pago-' + f.id, 'Comprobante de pago') : ''}
        </div>
        <div class="fi-accion">${avance}</div>
        ${f.estado !== 'pagada' ? `<button type="button" class="btn-icono" data-eliminar-factura="${f.id}" data-pedido-id="${p.id}" title="Eliminar factura" aria-label="Eliminar factura ${escaparHtml(f.noFactura)}"><i class="ti ti-trash"></i></button>` : ''}
      </li>`;
  }).join('');

  const puedeAgregar = m.porFacturar === null || m.porFacturar > 0.005;
  const formNueva = puedeAgregar && (p.facturas || []).length ? `
    <details class="nueva-factura">
      <summary><i class="ti ti-plus"></i> Registrar otra factura <span>· por facturar ${m.porFacturar !== null ? fmtMoneda.format(m.porFacturar) : ''}</span></summary>
      <form class="form-paso-pedido" data-pedido-id="${p.id}" data-accion="factura-nueva" data-doc="documento-factura">
        <div class="fila-formulario fila-4">
          <label>No. de factura<input type="text" name="noFactura" required></label>
          <label>Fecha<input type="date" name="fecha" value="${hoy}" required></label>
          <label>Monto<input type="number" name="monto" step="0.01" min="0.01" max="${valor(m.porFacturar)}" value="${valor(m.porFacturar)}" required></label>
          <label>Descripción<input type="text" name="descripcion" value="${escaparHtml(p.producto)}" required></label>
        </div>
        ${campoDocumento('Adjuntar la factura')}
        <button type="submit" class="btn btn-primario btn-sm">Registrar factura <i class="ti ti-arrow-right"></i></button>
      </form>
    </details>` : (!puedeAgregar ? `<p class="facturas-completo"><i class="ti ti-circle-check"></i> Facturación completa: ${fmtMoneda.format(m.facturado)} de ${fmtMoneda.format(m.disponible)}.</p>` : '');

  return `
    <div class="bloque-facturas" id="facturas-${p.id}">
      <div class="subseccion-titulo">Facturas <span class="facturas-resumen">${m.numFacturas} · ${fmtMoneda.format(m.facturado)} facturado${m.disponible !== null ? ' de ' + fmtMoneda.format(m.disponible) : ''}</span></div>
      ${filas ? `<ul class="lista-facturas">${filas}</ul>` : '<p class="texto-suave">Aún no hay facturas.</p>'}
      ${formNueva}
    </div>`;
}
