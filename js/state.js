// =========================================================
// data.js
// Capa de datos. Ahora habla con la API real (Render + Neon)
// vía fetch(). app.js sigue llamando a "Store.metodo(...)"
// exactamente igual que antes; la única diferencia es que
// cada método ahora es async y hay que usar await/.then().
//
// El monto total y el saldo/avance del contrato NUNCA vienen
// del servidor: se calculan aquí mismo a partir de los
// oficios y facturas crudos, igual que en el mock anterior.
// =========================================================

const NOMBRE_PERIODO = { mensual: 'mes', bimestral: 'bimestre', trimestral: 'trimestre' };
const ORDINALES = ['', '1er', '2do', '3er', '4to', '5to', '6to', '7mo', '8vo', '9no', '10mo', '11vo', '12vo'];

function ordinal(n) {
  return ORDINALES[n] || (n + '°');
}

function calcularMontoTotal(contrato) {
  return contrato.oficios.reduce((total, of) => {
    if (of.tipo === 'cancelacion') return total - Number(of.monto);
    return total + Number(of.monto);
  }, 0);
}

function generarPeriodos(contrato) {
  const dg = contrato.datosGenerales;
  if (!dg) return [];
  const periodos = [];
  if (dg.tieneAnticipo) {
    periodos.push({ tipo: 'anticipo', label: 'Anticipo', index: 0 });
  }
  if (dg.modoFacturacion === 'unico') {
    periodos.push({ tipo: 'pago', label: 'Pago único', index: 1 });
  } else {
    const nombre = NOMBRE_PERIODO[dg.modoFacturacion];
    for (let i = 1; i <= dg.numPeriodos; i++) {
      periodos.push({ tipo: 'pago', label: `${ordinal(i)} ${nombre}`, index: i });
    }
  }
  return periodos;
}

function recalcularSaldos(contrato) {
  const montoTotal = calcularMontoTotal(contrato);
  let saldoAcumulado = montoTotal;
  const periodos = generarPeriodos(contrato);
  periodos.forEach(periodo => {
    const factura = contrato.facturas.find(f => f.periodoIndex === periodo.index && f.periodoTipo === periodo.tipo);
    if (factura) {
      saldoAcumulado -= Number(factura.monto);
      factura.saldo = saldoAcumulado;
    }
  });
  contrato.montoTotal = montoTotal;
  contrato.saldoActual = saldoAcumulado;
}

// ---------- Sesión ----------

let tokenSesion = localStorage.getItem('contratos_token') || null;
let usuarioSesion = localStorage.getItem('contratos_usuario') || null;

function guardarSesion(token, usuario) {
  tokenSesion = token;
  usuarioSesion = usuario;
  localStorage.setItem('contratos_token', token);
  localStorage.setItem('contratos_usuario', usuario);
}

function limpiarSesion() {
  tokenSesion = null;
  usuarioSesion = null;
  localStorage.removeItem('contratos_token');
  localStorage.removeItem('contratos_usuario');
}

// ---------- Cliente HTTP ----------

async function peticion(ruta, opciones = {}) {
  const encabezados = { 'Content-Type': 'application/json', ...(opciones.headers || {}) };
  if (tokenSesion) encabezados.Authorization = `Bearer ${tokenSesion}`;

  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE_URL}${ruta}`, { ...opciones, headers: encabezados });
  } catch (error) {
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión a internet.');
  }

  let datos = {};
  try { datos = await respuesta.json(); } catch (error) { /* respuesta sin cuerpo, ej. 204 */ }

  if (respuesta.status === 401) {
    limpiarSesion();
    throw new Error('Tu sesión expiró. Inicia sesión de nuevo.');
  }
  if (!respuesta.ok || datos.ok === false) {
    throw new Error(datos.mensaje || 'Ocurrió un error inesperado.');
  }
  return datos;
}

const Store = {
  haySesionGuardada() {
    return !!tokenSesion;
  },

  usuarioActual() {
    return usuarioSesion;
  },

  async login(usuario, password) {
    const datos = await peticion('/login', {
      method: 'POST',
      body: JSON.stringify({ usuario, password })
    });
    guardarSesion(datos.token, datos.usuario);
    return true;
  },

  cerrarSesion() {
    limpiarSesion();
  },

  async listarContratos() {
    const datos = await peticion('/contratos');
    datos.contratos.forEach(recalcularSaldos);
    return datos.contratos;
  },

  async crearContratoInicial({ folioOficio, montoOficio, fechaOficio }) {
    const datos = await peticion('/contratos', {
      method: 'POST',
      body: JSON.stringify({ folioOficio, montoOficio, fechaOficio })
    });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async guardarDatosGenerales(contratoId, datosGenerales) {
    const datos = await peticion(`/contratos/${contratoId}/datos-generales`, {
      method: 'PUT',
      body: JSON.stringify(datosGenerales)
    });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async agregarOficio(contratoId, { tipo, folio, monto, fecha }) {
    const datos = await peticion(`/contratos/${contratoId}/oficios`, {
      method: 'POST',
      body: JSON.stringify({ tipo, folio, monto, fecha })
    });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async eliminarOficio(contratoId, oficioId) {
    const datos = await peticion(`/contratos/${contratoId}/oficios/${oficioId}`, { method: 'DELETE' });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async registrarFactura(contratoId, periodo, datosFactura) {
    const datos = await peticion(`/contratos/${contratoId}/facturas`, {
      method: 'POST',
      body: JSON.stringify({
        periodoTipo: periodo.tipo,
        periodoIndex: periodo.index,
        periodoLabel: periodo.label,
        ...datosFactura
      })
    });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async registrarFechaPago(contratoId, facturaId, fechaPago) {
    const datos = await peticion(`/contratos/${contratoId}/facturas/${facturaId}/fecha-pago`, {
      method: 'PUT',
      body: JSON.stringify({ fechaPago })
    });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async eliminarFactura(contratoId, facturaId) {
    const datos = await peticion(`/contratos/${contratoId}/facturas/${facturaId}`, { method: 'DELETE' });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  async eliminarContrato(id) {
    await peticion(`/contratos/${id}`, { method: 'DELETE' });
    return true;
  },

  async marcarCompletado(id) {
    const datos = await peticion(`/contratos/${id}/completar`, { method: 'PUT' });
    recalcularSaldos(datos.contrato);
    return datos.contrato;
  },

  periodosDe(contrato) {
    return generarPeriodos(contrato);
  }
};