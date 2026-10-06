// =========================================================
// pedidos.routes.js
// Seguimiento de contratos en 10 pasos + oficios de ampliación/
// cancelación sobre el monto autorizado.
//
// Pasos: contrato → oficio de autorización → contrarrecibo →
// oficio de adecuación (opcional) → factura → reducción (opcional) →
// entrega (opcional) → contabilidad → en pago → pagado.
// "estatus" guarda el último paso alcanzado (registrado u omitido).
//
// El orden de pasos es fijo. Cada endpoint de "avanzar paso"
// valida que el pedido esté justo en el paso anterior antes
// de dejarlo avanzar, para que nunca se salte un paso desde
// el cliente (aunque el frontend ya lo evita también).
// =========================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');
const jwt = require('jsonwebtoken');
const { driveConfigurado, subirADrive, enviarDesdeDrive, papeleraDrive } = require('../drive');

router.use(requiereAutenticacion);

const ORDEN_ESTATUS = [
  'pedido_creado', 'oficio_autorizado', 'adecuacion',
  'factura_recibida', 'reduccion',
  'en_contabilidad', 'en_pago', 'pagado'
];

function oficioAJson(row) {
  return { id: row.id, tipo: row.tipo, folio: row.folio, monto: Number(row.monto), fecha: row.fecha, posteriorReduccion: !!row.posterior_reduccion };
}

const archivoAJson = a => a ? { nombre: a.nombre, mime: a.mime, tamano: a.tamano, subidoEn: a.subido_en } : null;

// 0 contrarrecibo · 1 facturado · 2 entregado · 3 contabilidad · 4 en pago · 5 pagado
function etapaCR(f) { return f.fecha_pagado ? 5 : f.fecha_inicio_pago ? 4 : f.fecha_contabilidad ? 3 : f.entrega_fecha ? 2 : f.no_factura ? 1 : 0; }

// Cada contrarrecibo sigue su camino: contrarrecibo → factura → entrega → contabilidad → pago → pagado
const ESTADOS_CR = ['contrarecibo', 'facturado', 'entregado', 'en_contabilidad', 'en_pago', 'pagada'];
function facturaAJson(f, archivos) {
  const doc = t => archivoAJson(archivos.find(a => a.tipo === t + '-' + f.id));
  return {
    id: f.id, estado: ESTADOS_CR[etapaCR(f)],
    contrarecibo: { noContrarecibo: f.cr_no, fecha: f.cr_fecha, cuentaPorPagar: f.cr_cuenta, monto: f.cr_monto !== null ? Number(f.cr_monto) : null, documento: doc('contrarecibo') },
    factura: f.no_factura ? { noFactura: f.no_factura, fecha: f.fecha, descripcion: f.descripcion, monto: Number(f.monto), documento: doc('factura') } : null,
    entrega: f.entrega_fecha ? { fecha: f.entrega_fecha, documento: doc('entrega') } : null,
    oficioContabilidad: f.fecha_contabilidad ? { noOficio: f.contab_oficio, fecha: f.fecha_contabilidad, monto: f.contab_monto !== null ? Number(f.contab_monto) : null, documento: doc('contab') } : null,
    procesoPago: f.fecha_inicio_pago ? { fecha: f.fecha_inicio_pago, monto: f.proc_pago_monto !== null ? Number(f.proc_pago_monto) : null, documento: doc('procpago') } : null,
    pago: f.fecha_pagado ? { fecha: f.fecha_pagado, documento: doc('pago') } : null,
    // compatibilidad
    noFactura: f.no_factura, monto: f.monto !== null ? Number(f.monto) : null, fecha: f.fecha, descripcion: f.descripcion,
    fechaContabilidad: f.fecha_contabilidad, fechaInicioPago: f.fecha_inicio_pago, fechaPagado: f.fecha_pagado
  };
}

function pedidoAJson(row, oficios, archivos = [], facturas = []) {
  return {
    id: row.id,
    producto: row.producto,
    cantidad: Number(row.cantidad),
    unidadMedida: row.unidad_medida,
    descripcion: row.descripcion,
    proveedor: row.proveedor,
    areaSolicitante: row.area_solicitante,
    montoEstimado: Number(row.monto_estimado),
    fechaSolicitud: row.fecha_solicitud,
    fechaEntrega: row.fecha_entrega,
    autorizacion: row.aut_folio ? { noOficio: row.aut_folio, monto: Number(row.aut_monto), fecha: row.aut_fecha } : null,
    contrarecibo: row.contrarecibo_no ? { noContrarecibo: row.contrarecibo_no, fecha: row.contrarecibo_fecha, cuentaPorPagar: row.contrarecibo_cuenta, monto: Number(row.contrarecibo_monto) } : null,
    oficio: row.oficio_folio ? { folio: row.oficio_folio, monto: Number(row.oficio_monto), fecha: row.oficio_fecha } : null,
    facturas: facturas.map(f => facturaAJson(f, archivos)),
    reduccion: row.reduccion_monto !== null && row.reduccion_monto !== undefined ? { montoEjercido: Number(row.reduccion_monto), fecha: row.reduccion_fecha } : null,
    fechaContabilidad: row.fecha_contabilidad,
    fechaInicioPago: row.fecha_inicio_pago,
    fechaPagado: row.fecha_pagado,
    estatus: row.estatus,
    creadoEn: row.creado_en,
    oficios: oficios.map(oficioAJson),
    contrato: archivoAJson(archivos.find(a => a.tipo === 'contrato')),
    documentoEntrega: archivoAJson(archivos.find(a => a.tipo === 'entrega')),
    documentoAutorizacion: archivoAJson(archivos.find(a => a.tipo === 'autorizacion')),
    documentoContrarecibo: archivoAJson(archivos.find(a => a.tipo === 'contrarecibo')),
    documentoAdecuacion: archivoAJson(archivos.find(a => a.tipo === 'adecuacion')),
    documentoReduccion: archivoAJson(archivos.find(a => a.tipo === 'reduccion'))
  };
}

async function cargarPedidoCompleto(id) {
  const { rows: pedidoRows } = await db.query('SELECT * FROM pedidos WHERE id = $1', [id]);
  if (pedidoRows.length === 0) return null;
  const { rows: oficios } = await db.query('SELECT * FROM pedido_oficios WHERE pedido_id = $1 ORDER BY id', [id]);
  const { rows: archivos } = await db.query('SELECT tipo, nombre, mime, tamano, subido_en FROM pedido_archivos WHERE pedido_id = $1', [id]);
  const { rows: facturas } = await db.query('SELECT * FROM pedido_facturas WHERE pedido_id = $1 ORDER BY id', [id]);
  return pedidoAJson(pedidoRows[0], oficios, archivos, facturas);
}

function validarPasoAnterior(estatusActual, pasoEsperado, res) {
  if (estatusActual !== pasoEsperado) {
    res.status(409).json({
      ok: false,
      mensaje: `Este contrato no está en el paso previo requerido (está en "${estatusActual}"). Recarga la página.`
    });
    return false;
  }
  return true;
}

// ---------- Listar todos ----------

router.get('/', async (req, res) => {
  try {
    const { rows: pedidos } = await db.query('SELECT * FROM pedidos ORDER BY id DESC');
    const { rows: oficios } = await db.query('SELECT * FROM pedido_oficios ORDER BY id');
    const { rows: archivos } = await db.query('SELECT pedido_id, tipo, nombre, mime, tamano, subido_en FROM pedido_archivos');
    const { rows: facturas } = await db.query('SELECT * FROM pedido_facturas ORDER BY id');
    const resultado = pedidos.map(p => pedidoAJson(p, oficios.filter(o => o.pedido_id === p.id), archivos.filter(a => a.pedido_id === p.id), facturas.filter(f => f.pedido_id === p.id)));
    res.json({ ok: true, pedidos: resultado });
  } catch (error) {
    console.error('Error en GET /api/pedidos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al listar pedidos' });
  }
});

// ---------- Paso 1: crear pedido ----------

router.post('/', async (req, res) => {
  const { producto, cantidad, unidadMedida, descripcion, proveedor, areaSolicitante, montoEstimado, fechaSolicitud } = req.body;
  if (!producto || cantidad === undefined || !fechaSolicitud) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan datos del pedido (producto, cantidad, fecha)' });
  }
  try {
    const { rows } = await db.query(
      `INSERT INTO pedidos (producto, cantidad, unidad_medida, descripcion, proveedor, area_solicitante, monto_estimado, fecha_solicitud)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [producto, cantidad, unidadMedida || null, descripcion || null, proveedor || null, areaSolicitante || null, montoEstimado || 0, fechaSolicitud]
    );
    const pedido = await cargarPedidoCompleto(rows[0].id);
    res.status(201).json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en POST /api/pedidos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear el pedido' });
  }
});

// ---------- Archivo del contrato (subir / reemplazar y ver) ----------

const MIMES_CONTRATO = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp'
];
const MAX_CONTRATO = 150 * 1024 * 1024;   // 150 MB (va a Drive por partes)

// Ruta pública de cada archivo -> tipo guardado en pedido_archivos.
// contrato | documento-<paso> | documento-factura-<id> | documento-pago-<id>
const PASOS_CON_DOCUMENTO = ['entrega', 'autorizacion', 'contrarecibo', 'adecuacion', 'reduccion'];
function tipoDeRuta(ruta) {
  if (ruta === 'contrato') return 'contrato';
  const m = /^documento-([a-z]+)(?:-(\d+))?$/.exec(String(ruta || ''));
  if (!m) return null;
  if (!m[2]) return PASOS_CON_DOCUMENTO.includes(m[1]) ? m[1] : null;
  return ['factura', 'pago', 'contab', 'procpago', 'contrarecibo', 'entrega'].includes(m[1]) ? m[1] + '-' + m[2] : null;
}
const ETIQUETA_ARCHIVO = { contrato: 'Contrato', entrega: 'Entrega contrarrecibo', autorizacion: 'Oficio autorizacion', contrarecibo: 'Contrarrecibo', adecuacion: 'Oficio adecuacion', reduccion: 'Reduccion', factura: 'Factura', pago: 'Comprobante de pago', contab: 'Oficio contabilidad factura', procpago: 'Proceso de pago' };
const etiquetaArchivo = tipo => { const [t, n] = tipo.split('-'); return (ETIQUETA_ARCHIVO[t] || 'Documento') + (n ? ' ' + n : ''); };

// Los documentos de una factura o de su pago solo se aceptan si la factura es del contrato
async function facturaDelContrato(tipo, id) {
  const m = /^(factura|pago|contab|procpago|contrarecibo|entrega)-(\d+)$/.exec(tipo);
  if (!m) return true;
  const { rows } = await db.query('SELECT 1 FROM pedido_facturas WHERE id = $1 AND pedido_id = $2', [Number(m[2]), id]);
  return rows.length > 0;
}

// tipo: 'contrato' (archivo del contrato) o 'entrega' (documento de la entrega, opcional).
// El archivo llega tal cual en el cuerpo (no en JSON) y se pasa por partes a
// la carpeta de Drive; aquí solo se guarda su ID. Nombre en X-Nombre-Archivo.
const subirArchivo = tipo => async (req, res) => {
  const id = Number(req.params.id);
  const mime = String(req.headers['content-type'] || '').split(';')[0].trim();
  const tamano = Number(req.headers['content-length'] || 0);
  let nombre = 'archivo';
  try { nombre = decodeURIComponent(String(req.headers['x-nombre-archivo'] || 'archivo')); } catch (e) {}
  if (!MIMES_CONTRATO.includes(mime)) return res.status(400).json({ ok: false, mensaje: 'El archivo debe ser PDF, Word o imagen' });
  if (!tamano) return res.status(400).json({ ok: false, mensaje: 'El archivo está vacío' });
  if (tamano > MAX_CONTRATO) return res.status(413).json({ ok: false, mensaje: 'El archivo pesa más de ' + Math.round(MAX_CONTRATO / 1048576) + ' MB' });
  if (!driveConfigurado()) return res.status(503).json({ ok: false, mensaje: 'La carpeta de Drive todavía no está configurada' });
  try {
    const { rows: existe } = await db.query('SELECT id FROM pedidos WHERE id = $1', [id]);
    if (existe.length === 0) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    const { rows: previo } = await db.query('SELECT drive_id FROM pedido_archivos WHERE pedido_id = $1 AND tipo = $2', [id, tipo]);
    if (!(await facturaDelContrato(tipo, id))) return res.status(404).json({ ok: false, mensaje: 'Factura no encontrada' });
    const driveId = await subirADrive({ nombre: `${etiquetaArchivo(tipo)} - Contrato ${id} - ${nombre}`, mime, tamano, cuerpo: req });
    await db.query(
      `INSERT INTO pedido_archivos (pedido_id, tipo, nombre, mime, tamano, datos, drive_id) VALUES ($1,$2,$3,$4,$5,NULL,$6)
       ON CONFLICT (pedido_id, tipo) DO UPDATE SET nombre = EXCLUDED.nombre, mime = EXCLUDED.mime,
         tamano = EXCLUDED.tamano, datos = NULL, drive_id = EXCLUDED.drive_id, subido_en = now()`,
      [id, tipo, String(nombre).slice(0, 200), mime, tamano, driveId]
    );
    if (previo[0] && previo[0].drive_id) papeleraDrive(previo[0].drive_id);
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error al subir archivo (' + tipo + '):', error);
    if (!res.headersSent) res.status(500).json({ ok: false, mensaje: 'Error al guardar el archivo en Drive' });
  }
};

const verArchivo = tipo => async (req, res) => {
  try {
    const { rows } = await db.query('SELECT nombre, mime, drive_id, (drive_id IS NULL) AS en_base FROM pedido_archivos WHERE pedido_id = $1 AND tipo = $2', [Number(req.params.id), tipo]);
    if (rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'No hay archivo' });
    res.setHeader('Content-Type', rows[0].mime);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(rows[0].nombre)}`);
    if (rows[0].drive_id) return await enviarDesdeDrive(rows[0].drive_id, res);
    // Archivos anteriores que aún no se pasan a Drive
    const { rows: b } = await db.query('SELECT datos FROM pedido_archivos WHERE pedido_id = $1 AND tipo = $2', [Number(req.params.id), tipo]);
    res.send(b[0].datos);
  } catch (error) {
    console.error('Error al leer archivo (' + tipo + '):', error);
    if (!res.headersSent) res.status(500).json({ ok: false, mensaje: 'Error al leer el archivo' });
    else res.end();
  }
};

// Enlace temporal (2 min) para abrir el archivo directo en otra pestaña
router.post('/:id/enlace/:ruta', (req, res) => {
  const { ruta } = req.params;
  if (!tipoDeRuta(ruta)) return res.status(400).json({ ok: false, mensaje: 'Archivo no válido' });
  const acceso = jwt.sign({ id: req.usuario.id, usuario: req.usuario.usuario, uso: 'archivo' }, process.env.JWT_SECRET, { expiresIn: '2m' });
  res.json({ ok: true, ruta: `/pedidos/${Number(req.params.id)}/${ruta}?acceso=${encodeURIComponent(acceso)}` });
});

router.put('/:id/contrato', subirArchivo('contrato'));
router.get('/:id/contrato', verArchivo('contrato'));
router.put('/:id/documento-:tipo', (req, res) => {
  const tipo = tipoDeRuta('documento-' + req.params.tipo);
  if (!tipo) return res.status(400).json({ ok: false, mensaje: 'Documento no válido' });
  return subirArchivo(tipo)(req, res);
});
router.get('/:id/documento-:tipo', (req, res) => {
  const tipo = tipoDeRuta('documento-' + req.params.tipo);
  if (!tipo) return res.status(400).json({ ok: false, mensaje: 'Documento no válido' });
  return verArchivo(tipo)(req, res);
});

// ---------- Editar datos generales del pedido (paso 1, editable siempre) ----------

router.put('/:id/datos', async (req, res) => {
  const id = Number(req.params.id);
  const { producto, cantidad, unidadMedida, descripcion, proveedor, areaSolicitante, montoEstimado, fechaSolicitud } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE pedidos SET producto=$1, cantidad=$2, unidad_medida=$3, descripcion=$4, proveedor=$5,
         area_solicitante=$6, monto_estimado=$7, fecha_solicitud=$8
       WHERE id=$9 RETURNING id`,
      [producto, cantidad, unidadMedida || null, descripcion || null, proveedor || null, areaSolicitante || null, montoEstimado || 0, fechaSolicitud, id]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /datos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al actualizar el pedido' });
  }
});

// ---------- Pasos del flujo ----------
// Cada paso solo se registra si el contrato está justo en el paso
// anterior. Los opcionales también se pueden omitir (PUT /:id/omitir/:paso).

const num = v => (v === '' || v === null || v === undefined || isNaN(Number(v))) ? null : Number(v);
const texto = v => (typeof v === 'string' && v.trim()) ? v.trim() : null;
const fecha = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) ? v : null;

// Monto disponible para contrarrecibos: el autorizado vigente (ya considera la reducción líquida)
async function montoDisponible(id, row) {
  return autorizadoVigente(id, row);
}
// Total comprometido en contrarrecibos del contrato
async function totalContrarecibos(id, excepto = 0) {
  const { rows } = await db.query('SELECT COALESCE(SUM(cr_monto),0) AS t FROM pedido_facturas WHERE pedido_id=$1 AND id<>$2', [id, excepto]);
  return Number(rows[0].t);
}

// Monto autorizado vigente: adecuación (si hay) o autorización, más ampliaciones y menos cancelaciones
// La reducción líquida NO suma ni resta: REEMPLAZA el autorizado. Desde ese
// momento las ampliaciones/cancelaciones nuevas se aplican sobre ella; las
// anteriores quedan absorbidas en la reducción.
async function autorizadoVigente(id, row) {
  const conReduccion = row.reduccion_monto !== null && row.reduccion_monto !== undefined;
  const base = conReduccion ? Number(row.reduccion_monto)
    : row.oficio_monto !== null ? Number(row.oficio_monto) : (row.aut_monto !== null ? Number(row.aut_monto) : null);
  if (base === null) return null;
  const { rows } = await db.query(
    `SELECT COALESCE(SUM(CASE WHEN tipo='ampliacion' THEN monto ELSE -monto END),0) AS ajuste
       FROM pedido_oficios WHERE pedido_id=$1 AND posterior_reduccion = $2`, [id, conReduccion]);
  return base + Number(rows[0].ajuste);
}

// Pasos del contrato (los contrarrecibos tienen su propio camino, más abajo)
const PASOS = {
  'oficio-autorizacion': {
    de: 'pedido_creado', a: 'oficio_autorizado', nombre: 'el oficio de autorización',
    leer: b => ({ aut_folio: texto(b.noOficio), aut_monto: num(b.monto), aut_fecha: fecha(b.fecha) || new Date().toISOString().slice(0, 10) }),
    validar: d => !d.aut_folio ? 'Falta el No. de oficio' : !(d.aut_monto > 0) ? 'El monto autorizado debe ser mayor a 0' : null
  },
  'oficio-adecuacion': {
    de: 'oficio_autorizado', a: 'adecuacion', opcional: true, nombre: 'el oficio de adecuación',
    leer: b => ({ oficio_folio: texto(b.folio), oficio_monto: num(b.monto), oficio_fecha: fecha(b.fecha) }),
    validar: d => !d.oficio_folio ? 'Falta el folio del oficio' : !(d.oficio_monto > 0) ? 'El monto debe ser mayor a 0' : !d.oficio_fecha ? 'Falta la fecha del oficio' : null
  },
  'reduccion': {
    de: 'factura_recibida', a: 'reduccion', opcional: true, nombre: 'la reducción',
    leer: b => ({ reduccion_monto: num(b.montoEjercido), reduccion_fecha: fecha(b.fecha) || new Date().toISOString().slice(0, 10) }),
    validar: async (d, id, row) => {
      if (!(d.reduccion_monto > 0)) return 'Indica cuánto se gastó (mayor a 0)';
      const aut = await autorizadoVigente(id, row);
      if (aut !== null && d.reduccion_monto > aut + 0.005) return 'Lo gastado no puede ser mayor al monto autorizado vigente';
      const cr = await totalContrarecibos(id);
      if (d.reduccion_monto < cr - 0.005) return 'Lo gastado no puede ser menor a lo ya registrado en contrarrecibos (' + cr.toFixed(2) + ')';
      return null;
    }
  },
};

for (const [ruta, paso] of Object.entries(PASOS)) {
  router.put('/:id/' + ruta, async (req, res) => {
    const id = Number(req.params.id);
    try {
      const actual = await db.query('SELECT * FROM pedidos WHERE id=$1', [id]);
      if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
      if (!validarPasoAnterior(actual.rows[0].estatus, paso.de, res)) return;
      const datos = paso.leer(req.body || {});
      const error = await paso.validar(datos, id, actual.rows[0]);
      if (error) return res.status(400).json({ ok: false, mensaje: error });
      const columnas = Object.keys(datos);
      await db.query(
        `UPDATE pedidos SET ${columnas.map((c, i) => c + '=$' + (i + 1)).join(', ')}, estatus='${paso.a}', actualizado_en=now() WHERE id=$${columnas.length + 1}`,
        [...columnas.map(c => datos[c]), id]
      );
      await recalcularEstatus(id);
      res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
    } catch (error) {
      console.error('Error en PUT /' + ruta + ':', error);
      res.status(500).json({ ok: false, mensaje: 'Error al registrar ' + paso.nombre });
    }
  });
}

// Omitir un paso opcional (adecuación o reducción)
router.put('/:id/omitir/:paso', async (req, res) => {
  const id = Number(req.params.id);
  const paso = PASOS[req.params.paso];
  if (!paso || !paso.opcional) return res.status(400).json({ ok: false, mensaje: 'Ese paso no se puede omitir' });
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, paso.de, res)) return;
    await db.query(`UPDATE pedidos SET estatus=$1, actualizado_en=now() WHERE id=$2`, [paso.a, id]);
    await recalcularEstatus(id);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en PUT /omitir:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al omitir el paso' });
  }
});

// ---------- Contrarrecibos ----------
// Se registran varios (desde el paso de adecuación) hasta cubrir el monto
// disponible. Cada contrarrecibo sigue su camino sin frenar al resto:
// contrarrecibo → factura → entrega → contabilidad (oficio) → proceso de pago → pagado.
// Se guardan en pedido_facturas (una fila por contrarrecibo).


async function recalcularEstatus(id) {
  const { rows } = await db.query('SELECT * FROM pedidos WHERE id=$1', [id]);
  if (!rows.length) return;
  const row = rows[0];
  // Antes de terminar (u omitir) la reducción, el contrato sigue en "contrarrecibos"
  if (ORDEN_ESTATUS.indexOf(row.estatus) < ORDEN_ESTATUS.indexOf('reduccion')) return;
  const { rows: crs } = await db.query('SELECT * FROM pedido_facturas WHERE pedido_id=$1', [id]);
  let nuevo = 'reduccion', fechaPagado = null;
  if (crs.length) {
    const minima = Math.min(...crs.map(etapaCR));
    const disp = await montoDisponible(id, row);
    // Concluido solo si lo facturado (y pagado) cubre el monto disponible
    const total = crs.reduce((t, f) => t + Number(f.monto || 0), 0);
    const completo = disp !== null && total >= disp - 0.005;
    if (minima === 5 && completo) { nuevo = 'pagado'; fechaPagado = crs.map(f => f.fecha_pagado).sort().pop(); }
    else if (minima >= 4) nuevo = 'en_pago';
    else if (minima >= 3) nuevo = 'en_contabilidad';
  }
  if (nuevo !== row.estatus || (nuevo === 'pagado' && String(row.fecha_pagado) !== String(fechaPagado))) {
    await db.query('UPDATE pedidos SET estatus=$1, fecha_pagado=$2, actualizado_en=now() WHERE id=$3', [nuevo, fechaPagado, id]);
  }
}

function leerContrarecibo(b) {
  const d = { no: texto(b.noContrarecibo), fecha: fecha(b.fecha), cuenta: texto(b.cuentaPorPagar), monto: num(b.monto) };
  const error = !d.no ? 'Falta el No. de contrarrecibo' : !d.fecha ? 'Falta la fecha del contrarrecibo'
    : !d.cuenta ? 'Falta la cuenta por pagar' : !(d.monto > 0) ? 'El monto del contrarrecibo debe ser mayor a 0' : null;
  return { d, error };
}

// Nuevo contrarrecibo
router.post('/:id/facturas', async (req, res) => {
  const id = Number(req.params.id);
  const { d, error } = leerContrarecibo(req.body || {});
  if (error) return res.status(400).json({ ok: false, mensaje: error });
  try {
    const { rows } = await db.query('SELECT * FROM pedidos WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    const row = rows[0];
    if (ORDEN_ESTATUS.indexOf(row.estatus) < ORDEN_ESTATUS.indexOf('adecuacion')) {
      return res.status(409).json({ ok: false, mensaje: 'Primero registra (u omite) el oficio de adecuación.' });
    }
    const disp = await montoDisponible(id, row);
    const tot = await totalContrarecibos(id);
    if (disp !== null && tot + d.monto > disp + 0.005) {
      return res.status(400).json({ ok: false, mensaje: 'Con este contrarrecibo se pasaría del monto disponible. Por registrar: $' + Math.max(0, disp - tot).toFixed(2) });
    }
    const { rows: dup } = await db.query('SELECT 1 FROM pedido_facturas WHERE pedido_id=$1 AND lower(cr_no)=lower($2)', [id, d.no]);
    if (dup.length) return res.status(400).json({ ok: false, mensaje: 'Ya hay un contrarrecibo con ese número en este contrato' });
    const { rows: nuevo } = await db.query(
      'INSERT INTO pedido_facturas (pedido_id, cr_no, cr_fecha, cr_cuenta, cr_monto) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [id, d.no, d.fecha, d.cuenta, d.monto]);
    if (row.estatus === 'adecuacion') await db.query(`UPDATE pedidos SET estatus='factura_recibida', actualizado_en=now() WHERE id=$1`, [id]);
    await recalcularEstatus(id);
    res.status(201).json({ ok: true, facturaId: nuevo[0].id, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en POST contrarrecibo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el contrarrecibo' });
  }
});

// Corregir los datos de un contrarrecibo
router.put('/:id/facturas/:fid/contrarecibo', async (req, res) => {
  const id = Number(req.params.id), fid = Number(req.params.fid);
  const { d, error } = leerContrarecibo(req.body || {});
  if (error) return res.status(400).json({ ok: false, mensaje: error });
  try {
    const { rows } = await db.query('SELECT * FROM pedidos WHERE id=$1', [id]);
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    const { rows: cr } = await db.query('SELECT 1 FROM pedido_facturas WHERE id=$1 AND pedido_id=$2', [fid, id]);
    if (!cr.length) return res.status(404).json({ ok: false, mensaje: 'Contrarrecibo no encontrado' });
    const disp = await montoDisponible(id, rows[0]);
    const tot = await totalContrarecibos(id, fid);
    if (disp !== null && tot + d.monto > disp + 0.005) {
      return res.status(400).json({ ok: false, mensaje: 'Se pasaría del monto disponible. Máximo para este contrarrecibo: $' + Math.max(0, disp - tot).toFixed(2) });
    }
    const { rows: dup } = await db.query('SELECT 1 FROM pedido_facturas WHERE pedido_id=$1 AND id<>$2 AND lower(cr_no)=lower($3)', [id, fid, d.no]);
    if (dup.length) return res.status(400).json({ ok: false, mensaje: 'Ya hay otro contrarrecibo con ese número' });
    await db.query('UPDATE pedido_facturas SET cr_no=$1, cr_fecha=$2, cr_cuenta=$3, cr_monto=$4 WHERE id=$5', [d.no, d.fecha, d.cuenta, d.monto, fid]);
    await recalcularEstatus(id);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en PUT contrarrecibo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar el contrarrecibo' });
  }
});

// Avance de un contrarrecibo (en orden): factura → entrega → contabilidad → inicio de pago → pagado
const AVANCE_FACTURA = {
  'factura':      { columna: 'no_factura', antes: null, nombre: 'la factura' },
  'entrega':      { columna: 'entrega_fecha', antes: 'no_factura', nombre: 'la entrega' },
  'contabilidad': { columna: 'fecha_contabilidad', antes: 'entrega_fecha', nombre: 'el paso a contabilidad' },
  'inicio-pago':  { columna: 'fecha_inicio_pago', antes: 'fecha_contabilidad', nombre: 'el inicio del pago' },
  'pagado':       { columna: 'fecha_pagado', antes: 'fecha_inicio_pago', nombre: 'el pago' }
};
router.put('/:id/facturas/:fid/:avance', async (req, res, next) => {
  const id = Number(req.params.id), fid = Number(req.params.fid);
  const av = AVANCE_FACTURA[req.params.avance];
  if (!av) return next();   // otras rutas (p. ej. oficio-contabilidad, contrarecibo)
  const b = req.body || {};
  const f = fecha(b.fecha);
  if (!f) return res.status(400).json({ ok: false, mensaje: 'Falta la fecha' });
  const tipo = req.params.avance;
  const no = texto(b.noOficio), monto = num(b.monto);
  // Validaciones propias de cada avance
  if (tipo === 'factura') {
    if (!texto(b.noFactura)) return res.status(400).json({ ok: false, mensaje: 'Falta el No. de factura' });
    if (!texto(b.descripcion)) return res.status(400).json({ ok: false, mensaje: 'Falta la descripción de la factura' });
    if (!(monto > 0)) return res.status(400).json({ ok: false, mensaje: 'El monto de la factura debe ser mayor a 0' });
  }
  if (tipo === 'contabilidad' && !no) return res.status(400).json({ ok: false, mensaje: 'Falta el No. de oficio para contabilidad' });
  if ((tipo === 'contabilidad' || tipo === 'inicio-pago') && !(monto > 0)) return res.status(400).json({ ok: false, mensaje: 'El monto debe ser mayor a 0' });
  try {
    const { rows } = await db.query('SELECT * FROM pedido_facturas WHERE id=$1 AND pedido_id=$2', [fid, id]);
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Contrarrecibo no encontrado' });
    const cr = rows[0];
    if (cr[av.columna]) return res.status(409).json({ ok: false, mensaje: 'Este contrarrecibo ya tiene registrado ' + av.nombre + '. Recarga la página.' });
    if (av.antes && !cr[av.antes]) return res.status(409).json({ ok: false, mensaje: 'Este contrarrecibo aún no está en el paso previo.' });
    if (tipo === 'factura') {
      const { rows: dup } = await db.query('SELECT 1 FROM pedido_facturas WHERE pedido_id=$1 AND id<>$2 AND lower(no_factura)=lower($3)', [id, fid, texto(b.noFactura)]);
      if (dup.length) return res.status(400).json({ ok: false, mensaje: 'Ya hay una factura con ese número en este contrato' });
      await db.query('UPDATE pedido_facturas SET no_factura=$1, fecha=$2, descripcion=$3, monto=$4 WHERE id=$5', [texto(b.noFactura), f, texto(b.descripcion), monto, fid]);
    } else if (tipo === 'contabilidad') {
      await db.query('UPDATE pedido_facturas SET fecha_contabilidad=$1, contab_oficio=$2, contab_monto=$3 WHERE id=$4', [f, no, monto, fid]);
    } else if (tipo === 'inicio-pago') {
      await db.query('UPDATE pedido_facturas SET fecha_inicio_pago=$1, proc_pago_monto=$2 WHERE id=$3', [f, monto, fid]);
    } else {
      await db.query(`UPDATE pedido_facturas SET ${av.columna}=$1 WHERE id=$2`, [f, fid]);
    }
    await recalcularEstatus(id);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en PUT contrarrecibo avance:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar ' + av.nombre });
  }
});

// Completar o corregir el oficio de contabilidad de un contrarrecibo ya turnado
router.put('/:id/facturas/:fid/oficio-contabilidad', async (req, res) => {
  const id = Number(req.params.id), fid = Number(req.params.fid);
  const b = req.body || {};
  const f = fecha(b.fecha), no = texto(b.noOficio), monto = num(b.monto);
  if (!no) return res.status(400).json({ ok: false, mensaje: 'Falta el No. de oficio para contabilidad' });
  if (!f) return res.status(400).json({ ok: false, mensaje: 'Falta la fecha del oficio' });
  if (!(monto > 0)) return res.status(400).json({ ok: false, mensaje: 'El monto del oficio debe ser mayor a 0' });
  try {
    const { rows } = await db.query('SELECT fecha_contabilidad FROM pedido_facturas WHERE id=$1 AND pedido_id=$2', [fid, id]);
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Contrarrecibo no encontrado' });
    if (!rows[0].fecha_contabilidad) return res.status(409).json({ ok: false, mensaje: 'Este contrarrecibo todavía no se turna a contabilidad.' });
    await db.query('UPDATE pedido_facturas SET contab_oficio=$1, fecha_contabilidad=$2, contab_monto=$3 WHERE id=$4', [no, f, monto, fid]);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en PUT /oficio-contabilidad:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar el oficio de contabilidad' });
  }
});

// Eliminar un contrarrecibo capturado por error (no si ya está pagado)
const DOCS_CR = ['contrarecibo', 'factura', 'entrega', 'contab', 'procpago', 'pago'];
router.delete('/:id/facturas/:fid', async (req, res) => {
  const id = Number(req.params.id), fid = Number(req.params.fid);
  try {
    const { rows } = await db.query('SELECT fecha_pagado FROM pedido_facturas WHERE id=$1 AND pedido_id=$2', [fid, id]);
    if (!rows.length) return res.status(404).json({ ok: false, mensaje: 'Contrarrecibo no encontrado' });
    if (rows[0].fecha_pagado) return res.status(409).json({ ok: false, mensaje: 'No se puede eliminar un contrarrecibo pagado' });
    const tipos = DOCS_CR.map(t => t + '-' + fid);
    const { rows: arch } = await db.query('SELECT drive_id FROM pedido_archivos WHERE pedido_id=$1 AND tipo = ANY($2) AND drive_id IS NOT NULL', [id, tipos]);
    await db.query('DELETE FROM pedido_archivos WHERE pedido_id=$1 AND tipo = ANY($2)', [id, tipos]);
    await db.query('DELETE FROM pedido_facturas WHERE id=$1', [fid]);
    arch.forEach(a => papeleraDrive(a.drive_id));
    const { rows: quedan } = await db.query('SELECT count(*)::int n FROM pedido_facturas WHERE pedido_id=$1', [id]);
    if (quedan[0].n === 0) await db.query(`UPDATE pedidos SET estatus='adecuacion' WHERE id=$1 AND estatus='factura_recibida'`, [id]);
    await recalcularEstatus(id);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en DELETE contrarrecibo:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el contrarrecibo' });
  }
});

// ---------- Oficios de ampliación / cancelación (desde que hay oficio de autorización) ----------

router.post('/:id/oficios', async (req, res) => {
  const id = Number(req.params.id);
  const { tipo } = req.body || {};
  const folio = texto(req.body && req.body.folio), monto = num(req.body && req.body.monto), f = fecha(req.body && req.body.fecha);
  if (!['ampliacion', 'cancelacion'].includes(tipo)) return res.status(400).json({ ok: false, mensaje: 'Tipo de oficio inválido' });
  if (!folio || !(monto > 0) || !f) return res.status(400).json({ ok: false, mensaje: 'Completa folio, monto (mayor a 0) y fecha' });
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    if (ORDEN_ESTATUS.indexOf(actual.rows[0].estatus) < ORDEN_ESTATUS.indexOf('oficio_autorizado')) {
      return res.status(409).json({ ok: false, mensaje: 'Primero registra el oficio de autorización.' });
    }
    // Si ya hay reducción líquida, el ajuste se aplica sobre ella
    await db.query(
      `INSERT INTO pedido_oficios (pedido_id, tipo, folio, monto, fecha, posterior_reduccion)
       SELECT $1,$2,$3,$4,$5, (reduccion_monto IS NOT NULL) FROM pedidos WHERE id=$1`, [id, tipo, folio, monto, f]);
    await recalcularEstatus(id);
    res.status(201).json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en POST /pedidos/:id/oficios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el oficio' });
  }
});

router.delete('/:id/oficios/:oficioId', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.query(`DELETE FROM pedido_oficios WHERE id=$1 AND pedido_id=$2`, [Number(req.params.oficioId), id]);
    await recalcularEstatus(id);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en DELETE /pedidos/:id/oficios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el oficio' });
  }
});

// ---------- Eliminar pedido ----------

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    const { rows: archivos } = await db.query('SELECT drive_id FROM pedido_archivos WHERE pedido_id = $1 AND drive_id IS NOT NULL', [id]);
    await db.query(`DELETE FROM pedidos WHERE id = $1`, [id]);
    archivos.forEach(a => papeleraDrive(a.drive_id));   // sus archivos van a la papelera de Drive
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en DELETE /pedidos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el pedido' });
  }
});

module.exports = router;