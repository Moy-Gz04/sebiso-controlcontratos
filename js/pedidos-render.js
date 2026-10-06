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
const tarjetasOficiosAbiertos = new Set();   // "Oficios de ampliación / cancelación" desplegados   // "Cantidades del contrato" desplegadas
let filtroEtapa = '';          // '' = todas las etapas
let ultimaTarjetaAbierta = null; // para animar solo la que se acaba de abrir
let animarEntrada = true;      // la entrada escalonada solo al cargar o filtrar

const PASOS_PEDIDO = [
  { clave: 'pedido_creado',     label: 'Contrato',                 corto: 'Contrato',       icono: 'ti-file-plus' },
  { clave: 'oficio_autorizado', label: 'Oficio de autorización',   corto: 'Autorización',   icono: 'ti-file-certificate' },
  { clave: 'adecuacion',        label: 'Oficio de adecuación',     corto: 'Adecuación',     icono: 'ti-adjustments-dollar', opcional: true },
  { clave: 'factura_recibida',  label: 'Contrarrecibos',           corto: 'Contrarrecibos', icono: 'ti-receipt-2' },
  { clave: 'reduccion',         label: 'Reducción líquida',        corto: 'Reducción',      icono: 'ti-arrow-down-circle', opcional: true },
  { clave: 'en_contabilidad',   label: 'Contabilidad',             corto: 'Contabilidad',   icono: 'ti-calculator' },
  { clave: 'en_pago',           label: 'Proceso de pago',          corto: 'En pago',        icono: 'ti-cash' },
  { clave: 'pagado',            label: 'Pagado',                   corto: 'Pagado',         icono: 'ti-circle-check' }
];

// Qué hace falta para avanzar desde cada paso
const SIGUIENTE_PASO = {
  pedido_creado: 'Registrar el oficio de autorización',
  oficio_autorizado: 'Oficio de adecuación (opcional)',
  adecuacion: 'Registrar el primer contrarrecibo',
  factura_recibida: 'Reducción líquida (opcional)',
  reduccion: 'Seguimiento de cada contrarrecibo',
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
  if (clave === 'reduccion') return !p.reduccion;
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

// ---------- Cuerpo desplegado ----------

function renderCuerpoPedido(p) {
  const idxActual = indicePaso(p.estatus);
  const mRec = montosDelContrato(p);

  const recorrido = `
    <div class="subseccion-titulo">Recorrido del contrato</div>
    <ol class="recorrido" style="--avance:${idxActual / (PASOS_PEDIDO.length - 1)}">
      ${PASOS_PEDIDO.map((paso, i) => {
        const omitido = pasoOmitido(p, paso.clave);
        // "estatus" es el último paso ya registrado: lo de antes está hecho y el siguiente es el actual
        // Facturas ya iniciadas pero sin cubrir el saldo: en lugar de palomita, alerta roja que parpadea
        const faltanFacturas = paso.clave === 'factura_recibida' && i <= idxActual && ((mRec.porRegistrar || 0) > 0.005 || (mRec.porFacturar || 0) > 0.005);
        const estado = faltanFacturas ? 'faltan' : omitido ? 'omitido' : i <= idxActual ? 'hecho' : i === idxActual + 1 ? 'actual' : 'pendiente';
        const icono = faltanFacturas ? 'ti-alert-triangle' : omitido ? 'ti-minus' : i <= idxActual ? 'ti-check' : paso.icono;
        return `
          <li class="rec-paso ${estado}" style="--j:${i}" ${faltanFacturas ? `title="${textoFaltan(mRec)}"` : ''}>
            <span class="rec-circulo"><i class="ti ${icono}"></i></span>
            <span class="rec-label">${paso.label}${faltanFacturas ? `<small>${(mRec.porRegistrar || 0) > 0.005 ? ((mRec.porFacturar || 0) > 0.005 ? 'faltan contrarrecibos y facturas' : 'faltan contrarrecibos') : 'faltan facturas'}</small>` : paso.opcional ? `<small>${omitido ? 'omitido' : 'opcional'}</small>` : ''}</span>
          </li>`;
      }).join('')}
    </ol>
  `;

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
        f.factura && { fecha: f.factura.fecha, titulo: cr + ' · factura ' + escaparHtml(f.factura.noFactura), detalle: `${fmtMoneda.format(f.factura.monto)} · ${escaparHtml(f.factura.descripcion || '')}` },
        f.entrega && { fecha: f.entrega.fecha, titulo: cr + ' · entrega', detalle: '' },
        f.oficioContabilidad && { fecha: f.oficioContabilidad.fecha, titulo: cr + ' · a contabilidad', detalle: f.oficioContabilidad.noOficio ? 'Oficio ' + escaparHtml(f.oficioContabilidad.noOficio) : '' },
        f.procesoPago && { fecha: f.procesoPago.fecha, titulo: cr + ' · proceso de pago', detalle: f.procesoPago.monto !== null ? fmtMoneda.format(f.procesoPago.monto) : '' },
        f.pago && { fecha: f.pago.fecha, titulo: cr + ' · pagado', detalle: f.factura ? fmtMoneda.format(f.factura.monto) : '', destacado: true }
      ];
    }).filter(Boolean),
    p.reduccion && { fecha: p.reduccion.fecha, titulo: 'Reducción líquida', detalle: `El autorizado queda en ${fmtMoneda.format(p.reduccion.montoEjercido)}${m.autorizadoPrevio !== null ? ` (antes ${fmtMoneda.format(m.autorizadoPrevio)})` : ''}`, destacado: true },
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
      </section>
    </div>
  `;

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

  const acciones = `
    <div class="tc-acciones">
      <button type="button" class="btn btn-secundario btn-sm" data-editar-pedido="${p.id}"><i class="ti ti-pencil"></i> Editar datos</button>
      <button type="button" class="btn btn-texto btn-sm" data-eliminar-pedido="${p.id}"><i class="ti ti-trash"></i> Eliminar contrato</button>
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
      return panel({
        titulo: 'Reducción líquida', ruta: 'reduccion', doc: 'documento-reduccion', boton: 'Registrar reducción líquida', opcional: true,
        ayuda: `La reducción líquida reemplaza el autorizado vigente (hoy ${fmtMoneda.format(m.autorizado)}) por lo que realmente se ocupó. No puede ser menor a lo ya amparado en contrarrecibos (${fmtMoneda.format(m.contrarecibos)}). Las ampliaciones o cancelaciones que se registren después se aplicarán sobre este nuevo monto.`,
        campos: `
          <label>¿Cuánto se gastó del total autorizado? (nuevo autorizado)
            <input type="number" name="montoEjercido" step="0.01" min="${valor(Math.max(0.01, m.contrarecibos))}" max="${valor(m.autorizado)}" value="${valor(m.contrarecibos)}" data-autorizado="${valor(m.autorizado)}" data-facturado="${valor(m.contrarecibos)}" required>
          </label>
          <p class="calculo-reduccion" data-calculo-reduccion>${m.autorizado !== null ? `Reducción: ${fmtMoneda.format(m.autorizado - m.contrarecibos)} · el contrato queda en ${fmtMoneda.format(m.contrarecibos)}` : ''}</p>
          ${campoDocumento('Adjuntar el documento de la reducción (opcional)')}`
      });

    case 'reduccion':
    case 'en_contabilidad':
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

    const meta = [
      `${fmtFecha(cr.fecha)} · cuenta por pagar ${escaparHtml(cr.cuentaPorPagar || '—')}`,
      fa && `factura ${escaparHtml(fa.noFactura)} (${fmtFecha(fa.fecha)}, ${fmtMoneda.format(fa.monto)})`,
      f.entrega && `entrega ${fmtFecha(f.entrega.fecha)}`,
      oc && `oficio contab. ${escaparHtml(oc.noOficio || 'sin número')} (${fmtFecha(oc.fecha)}${oc.monto !== null ? ', ' + fmtMoneda.format(oc.monto) : ''})`,
      pp && `pago iniciado ${fmtFecha(pp.fecha)}${pp.monto !== null ? ' (' + fmtMoneda.format(pp.monto) + ')' : ''}`
    ].filter(Boolean).map(t => `<span>${t}</span>`).join('');

    return `
      <li class="factura-item ${CLASE_CR[f.estado]}">
        <div class="fi-principal">
          <span class="fi-no">CR ${escaparHtml(cr.noContrarecibo || '')}</span>
          <span class="fi-desc">${fa ? escaparHtml(fa.descripcion || '') : 'Sin factura aún'}</span>
          <span class="fi-meta">${meta}</span>
          <span class="cr-etapas">${pasos}</span>
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
      <div class="subseccion-titulo">Contrarrecibos ${textoFaltan(m) && (p.facturas || []).length ? `<span class="alerta-faltan" role="status"><i class="ti ti-alert-triangle"></i>${textoFaltan(m)}</span>` : ''}<span class="facturas-resumen">${m.numContrarecibos} · ${fmtMoneda.format(m.contrarecibos)}${m.disponible !== null ? ' de ' + fmtMoneda.format(m.disponible) : ''}</span></div>
      ${filas ? `<ul class="lista-facturas">${filas}</ul>` : '<p class="texto-suave">Aún no hay contrarrecibos.</p>'}
      ${formNueva}
    </div>`;
}
