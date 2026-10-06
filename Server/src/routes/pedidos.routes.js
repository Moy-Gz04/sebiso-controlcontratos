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
  'pedido_creado', 'oficio_autorizado', 'contrarecibo', 'adecuacion',
  'factura_recibida', 'reduccion', 'entregado',
  'en_contabilidad', 'en_pago', 'pagado'
];

function oficioAJson(row) {
  return { id: row.id, tipo: row.tipo, folio: row.folio, monto: Number(row.monto), fecha: row.fecha };
}

const archivoAJson = a => a ? { nombre: a.nombre, mime: a.mime, tamano: a.tamano, subidoEn: a.subido_en } : null;

function pedidoAJson(row, oficios, archivos = []) {
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
    factura: row.factura_no ? { noFactura: row.factura_no, monto: Number(row.factura_monto), fecha: row.factura_fecha, descripcion: row.factura_descripcion } : null,
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
    documentoContrarecibo: archivoAJson(archivos.find(a => a.tipo === 'contrarecibo'))
  };
}

async function cargarPedidoCompleto(id) {
  const { rows: pedidoRows } = await db.query('SELECT * FROM pedidos WHERE id = $1', [id]);
  if (pedidoRows.length === 0) return null;
  const { rows: oficios } = await db.query('SELECT * FROM pedido_oficios WHERE pedido_id = $1 ORDER BY id', [id]);
  const { rows: archivos } = await db.query('SELECT tipo, nombre, mime, tamano, subido_en FROM pedido_archivos WHERE pedido_id = $1', [id]);
  return pedidoAJson(pedidoRows[0], oficios, archivos);
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
    const resultado = pedidos.map(p => pedidoAJson(p, oficios.filter(o => o.pedido_id === p.id), archivos.filter(a => a.pedido_id === p.id)));
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

// Ruta pública de cada archivo -> tipo guardado en pedido_archivos
const RUTAS_ARCHIVO = {
  'contrato': 'contrato',
  'documento-entrega': 'entrega',
  'documento-autorizacion': 'autorizacion',
  'documento-contrarecibo': 'contrarecibo'
};
const ETIQUETA_ARCHIVO = { contrato: 'Contrato', entrega: 'Entrega', autorizacion: 'Oficio autorizacion', contrarecibo: 'Contrarecibo' };

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
    const driveId = await subirADrive({ nombre: `${ETIQUETA_ARCHIVO[tipo]} ${id} - ${nombre}`, mime, tamano, cuerpo: req });
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
  if (!RUTAS_ARCHIVO[ruta]) return res.status(400).json({ ok: false, mensaje: 'Archivo no válido' });
  const acceso = jwt.sign({ id: req.usuario.id, usuario: req.usuario.usuario, uso: 'archivo' }, process.env.JWT_SECRET, { expiresIn: '2m' });
  res.json({ ok: true, ruta: `/pedidos/${Number(req.params.id)}/${ruta}?acceso=${encodeURIComponent(acceso)}` });
});

for (const [ruta, tipo] of Object.entries(RUTAS_ARCHIVO)) {
  router.put('/:id/' + ruta, subirArchivo(tipo));
  router.get('/:id/' + ruta, verArchivo(tipo));
}

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

// Monto autorizado vigente: adecuación (si hay) o autorización, más ampliaciones y menos cancelaciones
async function autorizadoVigente(id, row) {
  const base = row.oficio_monto !== null ? Number(row.oficio_monto) : (row.aut_monto !== null ? Number(row.aut_monto) : null);
  if (base === null) return null;
  const { rows } = await db.query(`SELECT COALESCE(SUM(CASE WHEN tipo='ampliacion' THEN monto ELSE -monto END),0) AS ajuste FROM pedido_oficios WHERE pedido_id=$1`, [id]);
  return base + Number(rows[0].ajuste);
}

const PASOS = {
  'oficio-autorizacion': {
    de: 'pedido_creado', a: 'oficio_autorizado', nombre: 'el oficio de autorización',
    leer: b => ({ aut_folio: texto(b.noOficio), aut_monto: num(b.monto), aut_fecha: fecha(b.fecha) || new Date().toISOString().slice(0, 10) }),
    validar: d => !d.aut_folio ? 'Falta el No. de oficio' : !(d.aut_monto > 0) ? 'El monto autorizado debe ser mayor a 0' : null
  },
  'contrarecibo': {
    de: 'oficio_autorizado', a: 'contrarecibo', nombre: 'el contrarrecibo',
    leer: b => ({ contrarecibo_no: texto(b.noContrarecibo), contrarecibo_fecha: fecha(b.fecha), contrarecibo_cuenta: texto(b.cuentaPorPagar), contrarecibo_monto: num(b.monto) }),
    validar: d => !d.contrarecibo_no ? 'Falta el No. de contrarrecibo' : !d.contrarecibo_fecha ? 'Falta la fecha del contrarrecibo' : !d.contrarecibo_cuenta ? 'Falta la cuenta por pagar' : !(d.contrarecibo_monto > 0) ? 'El monto del contrarrecibo debe ser mayor a 0' : null
  },
  'oficio-adecuacion': {
    de: 'contrarecibo', a: 'adecuacion', opcional: true, nombre: 'el oficio de adecuación',
    leer: b => ({ oficio_folio: texto(b.folio), oficio_monto: num(b.monto), oficio_fecha: fecha(b.fecha) }),
    validar: d => !d.oficio_folio ? 'Falta el folio del oficio' : !(d.oficio_monto > 0) ? 'El monto debe ser mayor a 0' : !d.oficio_fecha ? 'Falta la fecha del oficio' : null
  },
  'factura': {
    de: 'adecuacion', a: 'factura_recibida', nombre: 'la factura',
    leer: b => ({ factura_no: texto(b.noFactura), factura_fecha: fecha(b.fecha), factura_descripcion: texto(b.descripcion), factura_monto: num(b.monto) }),
    validar: d => !d.factura_no ? 'Falta el No. de factura' : !d.factura_fecha ? 'Falta la fecha de la factura' : !d.factura_descripcion ? 'Falta la descripción de la factura' : !(d.factura_monto > 0) ? 'El monto de la factura debe ser mayor a 0' : null
  },
  'reduccion': {
    de: 'factura_recibida', a: 'reduccion', opcional: true, nombre: 'la reducción',
    leer: b => ({ reduccion_monto: num(b.montoEjercido), reduccion_fecha: fecha(b.fecha) || new Date().toISOString().slice(0, 10) }),
    validar: async (d, id, row) => {
      if (!(d.reduccion_monto > 0)) return 'Indica cuánto se gastó (mayor a 0)';
      const aut = await autorizadoVigente(id, row);
      if (aut !== null && d.reduccion_monto > aut + 0.005) return 'Lo gastado no puede ser mayor al monto autorizado vigente';
      return null;
    }
  },
  'entrega': {
    de: 'reduccion', a: 'entregado', opcional: true, nombre: 'la entrega',
    leer: b => ({ fecha_entrega: fecha(b.fechaEntrega) }),
    validar: d => !d.fecha_entrega ? 'Falta la fecha de entrega' : null
  },
  'contabilidad': {
    de: 'entregado', a: 'en_contabilidad', nombre: 'el paso a contabilidad',
    leer: b => ({ fecha_contabilidad: fecha(b.fechaContabilidad) }),
    validar: d => !d.fecha_contabilidad ? 'Falta la fecha' : null
  },
  'inicio-pago': {
    de: 'en_contabilidad', a: 'en_pago', nombre: 'el inicio del pago',
    leer: b => ({ fecha_inicio_pago: fecha(b.fechaInicioPago) }),
    validar: d => !d.fecha_inicio_pago ? 'Falta la fecha' : null
  },
  'pagado': {
    de: 'en_pago', a: 'pagado', nombre: 'el pago',
    leer: b => ({ fecha_pagado: fecha(b.fechaPagado) }),
    validar: d => !d.fecha_pagado ? 'Falta la fecha de pago' : null
  }
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
      res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
    } catch (error) {
      console.error('Error en PUT /' + ruta + ':', error);
      res.status(500).json({ ok: false, mensaje: 'Error al registrar ' + paso.nombre });
    }
  });
}

// Omitir un paso opcional (adecuación, reducción o entrega)
router.put('/:id/omitir/:paso', async (req, res) => {
  const id = Number(req.params.id);
  const paso = PASOS[req.params.paso];
  if (!paso || !paso.opcional) return res.status(400).json({ ok: false, mensaje: 'Ese paso no se puede omitir' });
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, paso.de, res)) return;
    await db.query(`UPDATE pedidos SET estatus=$1, actualizado_en=now() WHERE id=$2`, [paso.a, id]);
    res.json({ ok: true, pedido: await cargarPedidoCompleto(id) });
  } catch (error) {
    console.error('Error en PUT /omitir:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al omitir el paso' });
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
    await db.query(`INSERT INTO pedido_oficios (pedido_id, tipo, folio, monto, fecha) VALUES ($1,$2,$3,$4,$5)`, [id, tipo, folio, monto, f]);
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