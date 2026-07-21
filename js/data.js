// =========================================================
// data.js
// Capa de datos. POR AHORA es un mock en memoria (arrays JS).
// Cuando conectemos el backend (Node + NeonDB), estas mismas
// funciones se convertirán en llamadas fetch() a la API,
// pero conservarán la misma firma para no tocar app.js.
// =========================================================

const DB = {
  usuario: { usuario: 'admin', password: 'admin123' }, // TEMPORAL: se reemplaza por login real con JWT en backend
  contratos: []
};

let contadorId = 1;
function nuevoId() { return contadorId++; }

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

const Store = {
  login(usuario, password) {
    return usuario === DB.usuario.usuario && password === DB.usuario.password;
  },

  listarContratos() {
    return DB.contratos.map(c => { recalcularSaldos(c); return c; }).sort((a, b) => b.id - a.id);
  },

  obtenerContrato(id) {
    const c = DB.contratos.find(c => c.id === id);
    if (c) recalcularSaldos(c);
    return c;
  },

  crearContratoInicial({ folioOficio, montoOficio, fechaOficio }) {
    const contrato = {
      id: nuevoId(),
      oficios: [{
        id: nuevoId(),
        tipo: 'inicial',
        folio: folioOficio,
        monto: Number(montoOficio),
        fecha: fechaOficio
      }],
      datosGenerales: null,
      facturas: [],
      estatus: 'oficio_capturado',
      creadoEn: new Date().toISOString()
    };
    DB.contratos.push(contrato);
    recalcularSaldos(contrato);
    return contrato;
  },

  guardarDatosGenerales(contratoId, datos) {
    const contrato = this.obtenerContrato(contratoId);
    if (!contrato) return null;
    contrato.datosGenerales = { ...datos };
    contrato.estatus = 'en_facturacion';
    recalcularSaldos(contrato);
    return contrato;
  },

  agregarOficio(contratoId, { tipo, folio, monto, fecha }) {
    const contrato = this.obtenerContrato(contratoId);
    if (!contrato) return null;
    contrato.oficios.push({ id: nuevoId(), tipo, folio, monto: Number(monto), fecha });
    recalcularSaldos(contrato);
    return contrato;
  },

  editarOficio(contratoId, oficioId, cambios) {
    const contrato = this.obtenerContrato(contratoId);
    if (!contrato) return null;
    const of = contrato.oficios.find(o => o.id === oficioId);
    if (!of) return null;
    Object.assign(of, cambios, { monto: Number(cambios.monto ?? of.monto) });
    recalcularSaldos(contrato);
    return contrato;
  },

  eliminarOficio(contratoId, oficioId) {
    const contrato = this.obtenerContrato(contratoId);
    if (!contrato) return null;
    if (contrato.oficios.find(o => o.id === oficioId)?.tipo === 'inicial') return null; // no se borra el oficio inicial
    contrato.oficios = contrato.oficios.filter(o => o.id !== oficioId);
    recalcularSaldos(contrato);
    return contrato;
  },

  registrarFactura(contratoId, periodo, datos) {
    const contrato = this.obtenerContrato(contratoId);
    if (!contrato) return null;
    let factura = contrato.facturas.find(f => f.periodoIndex === periodo.index && f.periodoTipo === periodo.tipo);
    if (!factura) {
      factura = { id: nuevoId(), periodoIndex: periodo.index, periodoTipo: periodo.tipo, periodoLabel: periodo.label };
      contrato.facturas.push(factura);
    }
    // Actualización parcial-segura: si "datos" no trae monto (p. ej. al
    // guardar solo la fecha de pago), no se pisa el monto ya guardado.
    const cambios = { ...datos };
    if (cambios.monto !== undefined) cambios.monto = Number(cambios.monto);
    Object.assign(factura, cambios);
    recalcularSaldos(contrato);
    return contrato;
  },

  eliminarFactura(contratoId, facturaId) {
    const contrato = this.obtenerContrato(contratoId);
    if (!contrato) return null;
    contrato.facturas = contrato.facturas.filter(f => f.id !== facturaId);
    recalcularSaldos(contrato);
    return contrato;
  },

  eliminarContrato(id) {
    const existe = DB.contratos.some(c => c.id === id);
    if (!existe) return false;
    DB.contratos = DB.contratos.filter(c => c.id !== id);
    return true;
  },

  marcarCompletado(id) {
    const contrato = this.obtenerContrato(id);
    if (!contrato) return null;
    contrato.estatus = 'completado';
    return contrato;
  },

  periodosDe(contrato) {
    return generarPeriodos(contrato);
  }
};