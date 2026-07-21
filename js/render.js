// =========================================================
// render.js
// Todo lo que genera HTML y controla qué pantalla se ve.
// No hace peticiones a la API directamente: recibe datos ya
// resueltos (de state.js) o delega en app.js/modals.js.
// =========================================================

const tarjetasExpandidas = new Set();

const fmtMoneda = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const fmtFecha = (iso) => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const ETIQUETA_TIPO_OFICIO = {
  inicial: 'Oficio inicial',
  ampliacion: 'Ampliación',
  cancelacion: 'Cancelación'
};

const ETIQUETA_ESTATUS = {
  oficio_capturado: 'Oficio capturado',
  en_facturacion: 'En facturación',
  completado: 'Completado'
};

// ---------- Pantallas ----------

function mostrarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach(p => p.classList.remove('activa'));
  document.getElementById(id).classList.add('activa');
}

// ---------- Aviso flotante ----------

let avisoTimeout;
function mostrarAviso(texto, esError = false) {
  const aviso = document.getElementById('aviso-flotante');
  aviso.textContent = texto;
  aviso.classList.toggle('error', esError);
  aviso.classList.add('visible');
  clearTimeout(avisoTimeout);
  avisoTimeout = setTimeout(() => aviso.classList.remove('visible'), esError ? 4000 : 2200);
}

// ---------- Listado de contratos (inicio): tarjetas expandibles ----------

async function renderListadoContratos() {
  const contenedor = document.getElementById('lista-contratos');
  const vacio = document.getElementById('listado-vacio');

  contenedor.innerHTML = `<p class="cargando">Cargando contratos…</p>`;
  vacio.style.display = 'none';

  let contratos;
  try {
    contratos = await Store.listarContratos();
  } catch (err) {
    contenedor.innerHTML = '';
    mostrarAviso(err.message, true);
    if (err.message.includes('sesión')) mostrarPantalla('pantalla-login');
    return;
  }

  if (contratos.length === 0) {
    contenedor.innerHTML = '';
    vacio.style.display = 'block';
    return;
  }

  contenedor.innerHTML = contratos.map(c => renderTarjetaContrato(c)).join('');
  adjuntarEventosListado();
}

function renderTarjetaContrato(c) {
  const oficioInicial = c.oficios.find(o => o.tipo === 'inicial');
  const dg = c.datosGenerales;
  const abierta = tarjetasExpandidas.has(c.id);

  const detalle = dg
    ? `Contrato ${dg.noContrato} · ${dg.proveedor}${dg.descripcion ? ' — ' + dg.descripcion : ''}`
    : 'Datos generales pendientes de captura';

  return `
    <div class="tarjeta-contrato" data-id="${c.id}">
      <div class="tarjeta-contrato-header" data-toggle-tarjeta="${c.id}">
        <span class="tc-chevron ${abierta ? 'abierto' : ''}">›</span>
        <div class="tc-info">
          <span class="tc-folio">${oficioInicial.folio}</span>
          <span class="tc-detalle">${detalle}</span>
        </div>
        <span class="tc-monto">${fmtMoneda.format(c.montoTotal)}</span>
        <span class="badge badge-${c.estatus}">${ETIQUETA_ESTATUS[c.estatus]}</span>
      </div>
      <div class="tarjeta-contrato-acciones">
        <button class="btn btn-secundario btn-sm" data-editar-generales="${c.id}">${dg ? 'Editar' : 'Registrar'} datos generales</button>
        <button class="btn btn-secundario btn-sm" data-registrar-oficio="${c.id}">Registrar oficio</button>
        <button class="btn btn-texto btn-sm" data-eliminar-contrato="${c.id}">Eliminar</button>
      </div>
      <div class="tarjeta-contrato-body" id="cuerpo-tarjeta-${c.id}" style="display:${abierta ? 'block' : 'none'}">
        ${abierta ? renderCuerpoTarjeta(c) : ''}
      </div>
    </div>
  `;
}

function renderCuerpoTarjeta(c) {
  const inicial = c.oficios.filter(o => o.tipo === 'inicial').reduce((s, o) => s + o.monto, 0);
  const ampliaciones = c.oficios.filter(o => o.tipo === 'ampliacion').reduce((s, o) => s + o.monto, 0);
  const cancelaciones = c.oficios.filter(o => o.tipo === 'cancelacion').reduce((s, o) => s + o.monto, 0);

  const resumenHtml = `
    <div class="subseccion-titulo">Resumen de montos</div>
    <div class="resumen-grid" style="margin-bottom:26px;">
      <div class="resumen-item">
        <div class="resumen-label">Oficio inicial</div>
        <div class="resumen-valor">${fmtMoneda.format(inicial)}</div>
      </div>
      <div class="resumen-item">
        <div class="resumen-label">Ampliaciones</div>
        <div class="resumen-valor">+${fmtMoneda.format(ampliaciones)}</div>
      </div>
      <div class="resumen-item">
        <div class="resumen-label">Cancelaciones</div>
        <div class="resumen-valor">−${fmtMoneda.format(cancelaciones)}</div>
      </div>
      <div class="resumen-item destacado">
        <div class="resumen-label">Monto total</div>
        <div class="resumen-valor">${fmtMoneda.format(c.montoTotal)}</div>
      </div>
      <div class="resumen-item">
        <div class="resumen-label">Importe restante después de facturas</div>
        <div class="resumen-valor ${c.saldoActual < 0 ? 'texto-negativo' : ''}">${fmtMoneda.format(c.saldoActual)}</div>
      </div>
    </div>
  `;

  const oficiosAdicionales = c.oficios.filter(o => o.tipo !== 'inicial');
  let oficiosHtml = `<div class="subseccion-titulo">Oficios registrados (ampliaciones / cancelaciones)</div>`;
  if (oficiosAdicionales.length === 0) {
    oficiosHtml += `<div class="bloqueo" style="margin-bottom:26px;">Aún no se han registrado oficios de ampliación o cancelación.</div>`;
  } else {
    oficiosHtml += `
      <table class="tabla-oficios-registrados" style="margin-bottom:26px;">
        <thead>
          <tr><th>Tipo de oficio</th><th>Folio</th><th>Monto</th><th>Fecha de registro</th><th></th></tr>
        </thead>
        <tbody>
          ${oficiosAdicionales.map(of => `
            <tr>
              <td>${ETIQUETA_TIPO_OFICIO[of.tipo]}</td>
              <td>${of.folio}</td>
              <td class="${of.tipo === 'cancelacion' ? 'texto-negativo' : ''}">${of.tipo === 'cancelacion' ? '−' : '+'}${fmtMoneda.format(of.monto)}</td>
              <td>${fmtFecha(of.fecha)}</td>
              <td><button class="btn-icono" data-eliminar-oficio="${of.id}" data-contrato-id="${c.id}" title="Eliminar">✕</button></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  let facturacionHtml = `<div class="subseccion-titulo">Facturación por periodo</div>`;
  let todosFacturados = false;

  if (!c.datosGenerales) {
    facturacionHtml += `<div class="bloqueo">Registra los datos generales de este contrato para habilitar la facturación.</div>`;
  } else {
    const periodos = Store.periodosDe(c);
    todosFacturados = periodos.length > 0 && periodos.every(p =>
      c.facturas.some(f => f.periodoIndex === p.index && f.periodoTipo === p.tipo)
    );

    facturacionHtml += `<div class="lista-periodos">` + periodos.map(periodo => {
      const factura = c.facturas.find(f => f.periodoIndex === periodo.index && f.periodoTipo === periodo.tipo);
      const registrada = !!factura;
      const pagada = registrada && !!factura.fechaPago;
      const claveDom = `${c.id}-${periodo.tipo}-${periodo.index}`;

      let claseBadge = 'badge-oficio_capturado';
      let textoBadge = 'Pendiente';
      if (registrada) { claseBadge = 'badge-en_facturacion'; textoBadge = 'Registrado'; }
      if (pagada) { claseBadge = 'badge-completado'; textoBadge = 'Pagado'; }

      let infoLinea = '';
      if (registrada) {
        infoLinea = pagada
          ? `Fecha de pago: ${fmtFecha(factura.fechaPago)} · Importe registrado: ${fmtMoneda.format(factura.monto)}`
          : `Importe registrado: ${fmtMoneda.format(factura.monto)}`;
      }

      return `
        <div class="tarjeta-periodo ${registrada ? 'registrado' : ''}">
          <div class="tarjeta-periodo-header" data-toggle-periodo="${claveDom}">
            <span class="tarjeta-periodo-titulo">${periodo.label}</span>
            <span class="badge ${claseBadge}">${textoBadge}</span>
            ${infoLinea ? `<span class="tarjeta-periodo-saldo">${infoLinea}</span>` : ''}
          </div>
          <div class="tarjeta-periodo-body" id="periodo-body-${claveDom}" style="display:none">
            <form class="form-factura" data-contrato-id="${c.id}" data-periodo-tipo="${periodo.tipo}" data-periodo-index="${periodo.index}" data-periodo-label="${periodo.label}">
              <div class="fila-formulario">
                <label>No. de factura
                  <input type="text" name="noFactura" value="${factura?.noFactura || ''}" required>
                </label>
                <label>Fecha de factura
                  <input type="date" name="fecha" value="${factura?.fecha || ''}" required>
                </label>
              </div>
              <label style="margin-bottom:18px;">Monto
                <input type="number" name="monto" step="0.01" min="0" value="${factura?.monto || ''}" required>
              </label>
              <div class="fila-formulario-acciones">
                <button type="submit" class="btn btn-primario btn-sm">${registrada ? 'Guardar datos' : 'Registrar factura'}</button>
                ${registrada ? `<button type="button" class="btn btn-texto btn-sm" data-eliminar-factura="${factura.id}" data-contrato-id="${c.id}">Eliminar</button>` : ''}
              </div>
            </form>

            ${registrada ? `
              <div class="seccion-pago">
                ${pagada
                  ? `<div class="info-pago"><span class="badge badge-completado">Pagado</span> el ${fmtFecha(factura.fechaPago)}
                       <button type="button" class="btn btn-texto btn-sm" data-toggle-pago="${claveDom}">Editar fecha de pago</button>
                     </div>`
                  : `<button type="button" class="btn btn-secundario btn-sm" data-toggle-pago="${claveDom}">Registrar fecha de pago</button>`
                }
                <div class="form-pago-contenedor" id="pago-form-${claveDom}" style="display:none;">
                  <form class="form-fecha-pago" data-contrato-id="${c.id}" data-factura-id="${factura.id}">
                    <div class="fila-formulario" style="grid-template-columns:1fr; margin-bottom:14px;">
                      <label>Fecha de pago
                        <input type="date" name="fechaPago" value="${factura.fechaPago || ''}" required>
                      </label>
                    </div>
                    <button type="submit" class="btn btn-primario btn-sm">Guardar fecha de pago</button>
                  </form>
                </div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('') + `</div>`;
  }

  let cierreHtml = '';
  if (c.estatus === 'completado') {
    cierreHtml = `<p class="ayuda-boton" style="margin-top:24px;">✓ Este contrato ya fue marcado como proceso completado.</p>`;
  } else {
    cierreHtml = `
      <div style="margin-top:26px; border-top:1px solid var(--borde); padding-top:22px;">
        <button class="btn btn-primario btn-ancho" data-completar="${c.id}" ${todosFacturados ? '' : 'disabled'}>Proceso completado</button>
        ${!todosFacturados ? `<p class="ayuda-boton">Completa la facturación de todos los periodos para poder cerrar el proceso.</p>` : ''}
      </div>
    `;
  }

  return resumenHtml + oficiosHtml + facturacionHtml + cierreHtml;
}