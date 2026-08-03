// =========================================================
// pedidos.routes.js
// CRUD del seguimiento de pedidos (7 pasos) + oficios de
// ampliación/cancelación sobre el oficio de adecuación.
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

router.use(requiereAutenticacion);

const ORDEN_ESTATUS = [
  'pedido_creado', 'entregado', 'oficio_registrado',
  'factura_recibida', 'en_contabilidad', 'en_pago', 'pagado'
];

function oficioAJson(row) {
  return { id: row.id, tipo: row.tipo, folio: row.folio, monto: Number(row.monto), fecha: row.fecha };
}

function pedidoAJson(row, oficios) {
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
    oficio: row.oficio_folio ? { folio: row.oficio_folio, monto: Number(row.oficio_monto), fecha: row.oficio_fecha } : null,
    factura: row.factura_no ? { noFactura: row.factura_no, monto: Number(row.factura_monto), fecha: row.factura_fecha } : null,
    fechaContabilidad: row.fecha_contabilidad,
    fechaInicioPago: row.fecha_inicio_pago,
    fechaPagado: row.fecha_pagado,
    estatus: row.estatus,
    creadoEn: row.creado_en,
    oficios: oficios.map(oficioAJson)
  };
}

async function cargarPedidoCompleto(id) {
  const { rows: pedidoRows } = await db.query('SELECT * FROM pedidos WHERE id = $1', [id]);
  if (pedidoRows.length === 0) return null;
  const { rows: oficios } = await db.query('SELECT * FROM pedido_oficios WHERE pedido_id = $1 ORDER BY id', [id]);
  return pedidoAJson(pedidoRows[0], oficios);
}

function validarPasoAnterior(estatusActual, pasoEsperado, res) {
  if (estatusActual !== pasoEsperado) {
    res.status(409).json({
      ok: false,
      mensaje: `Este pedido no está en el paso previo requerido (está en "${estatusActual}").`
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
    const resultado = pedidos.map(p => pedidoAJson(p, oficios.filter(o => o.pedido_id === p.id)));
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

// ---------- Paso 2: entrega ----------

router.put('/:id/entrega', async (req, res) => {
  const id = Number(req.params.id);
  const { fechaEntrega } = req.body;
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, 'pedido_creado', res)) return;

    await db.query(
      `UPDATE pedidos SET fecha_entrega=$1, estatus='entregado' WHERE id=$2`,
      [fechaEntrega, id]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /entrega:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar la entrega' });
  }
});

// ---------- Paso 3: oficio de adecuación ----------

router.put('/:id/oficio-adecuacion', async (req, res) => {
  const id = Number(req.params.id);
  const { folio, monto, fecha } = req.body;
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, 'entregado', res)) return;

    await db.query(
      `UPDATE pedidos SET oficio_folio=$1, oficio_monto=$2, oficio_fecha=$3, estatus='oficio_registrado' WHERE id=$4`,
      [folio, monto, fecha, id]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /oficio-adecuacion:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el oficio de adecuación' });
  }
});

// ---------- Oficios de ampliación / cancelación (paralelo, desde paso 3) ----------

router.post('/:id/oficios', async (req, res) => {
  const id = Number(req.params.id);
  const { tipo, folio, monto, fecha } = req.body;
  if (!['ampliacion', 'cancelacion'].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: 'Tipo de oficio inválido' });
  }
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    const indiceActual = ORDEN_ESTATUS.indexOf(actual.rows[0].estatus);
    if (indiceActual < ORDEN_ESTATUS.indexOf('oficio_registrado')) {
      return res.status(409).json({ ok: false, mensaje: 'Aún no se ha registrado el oficio de adecuación de este pedido.' });
    }

    await db.query(
      `INSERT INTO pedido_oficios (pedido_id, tipo, folio, monto, fecha) VALUES ($1,$2,$3,$4,$5)`,
      [id, tipo, folio, monto, fecha]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.status(201).json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en POST /pedidos/:id/oficios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el oficio' });
  }
});

router.delete('/:id/oficios/:oficioId', async (req, res) => {
  const id = Number(req.params.id);
  const oficioId = Number(req.params.oficioId);
  try {
    await db.query(`DELETE FROM pedido_oficios WHERE id=$1 AND pedido_id=$2`, [oficioId, id]);
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en DELETE /pedidos/:id/oficios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el oficio' });
  }
});

// ---------- Paso 4: factura recibida ----------

router.put('/:id/factura', async (req, res) => {
  const id = Number(req.params.id);
  const { noFactura, monto, fecha } = req.body;
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, 'oficio_registrado', res)) return;

    await db.query(
      `UPDATE pedidos SET factura_no=$1, factura_monto=$2, factura_fecha=$3, estatus='factura_recibida' WHERE id=$4`,
      [noFactura, monto, fecha, id]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /factura:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar la factura' });
  }
});

// ---------- Paso 5: pasó a contabilidad ----------

router.put('/:id/contabilidad', async (req, res) => {
  const id = Number(req.params.id);
  const { fechaContabilidad } = req.body;
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, 'factura_recibida', res)) return;

    await db.query(
      `UPDATE pedidos SET fecha_contabilidad=$1, estatus='en_contabilidad' WHERE id=$2`,
      [fechaContabilidad, id]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /contabilidad:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el paso a contabilidad' });
  }
});

// ---------- Paso 6: en proceso de pago ----------

router.put('/:id/inicio-pago', async (req, res) => {
  const id = Number(req.params.id);
  const { fechaInicioPago } = req.body;
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, 'en_contabilidad', res)) return;

    await db.query(
      `UPDATE pedidos SET fecha_inicio_pago=$1, estatus='en_pago' WHERE id=$2`,
      [fechaInicioPago, id]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /inicio-pago:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al marcar en proceso de pago' });
  }
});

// ---------- Paso 7: pagado (cierre) ----------

router.put('/:id/pagado', async (req, res) => {
  const id = Number(req.params.id);
  const { fechaPagado } = req.body;
  try {
    const actual = await db.query('SELECT estatus FROM pedidos WHERE id=$1', [id]);
    if (actual.rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Pedido no encontrado' });
    if (!validarPasoAnterior(actual.rows[0].estatus, 'en_pago', res)) return;

    await db.query(
      `UPDATE pedidos SET fecha_pagado=$1, estatus='pagado' WHERE id=$2`,
      [fechaPagado, id]
    );
    const pedido = await cargarPedidoCompleto(id);
    res.json({ ok: true, pedido });
  } catch (error) {
    console.error('Error en PUT /pagado:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el pago' });
  }
});

// ---------- Eliminar pedido ----------

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.query(`DELETE FROM pedidos WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en DELETE /pedidos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el pedido' });
  }
});

module.exports = router;