// =========================================================
// contratos.routes.js
// CRUD completo de contratos / oficios / facturas.
// =========================================================

const express = require('express');
const router = express.Router();
const db = require('../db');
const { requiereAutenticacion } = require('../middleware/auth');

router.use(requiereAutenticacion);

function oficioAJson(row) {
  return { id: row.id, tipo: row.tipo, folio: row.folio, monto: Number(row.monto), fecha: row.fecha };
}

function facturaAJson(row) {
  return {
    id: row.id,
    periodoTipo: row.periodo_tipo,
    periodoIndex: row.periodo_index,
    periodoLabel: row.periodo_label,
    noFactura: row.no_factura,
    fecha: row.fecha,
    monto: Number(row.monto),
    fechaPago: row.fecha_pago || null
  };
}

function contratoAJson(row, oficios, facturas) {
  const dg = row.no_contrato ? {
    noContrato: row.no_contrato,
    noRequisicion: row.no_requisicion,
    fecha: row.fecha,
    proveedor: row.proveedor,
    descripcion: row.descripcion,
    modoFacturacion: row.modo_facturacion,
    numPeriodos: row.num_periodos,
    tieneAnticipo: row.tiene_anticipo,
    montoAnticipo: Number(row.monto_anticipo)
  } : null;

  return {
    id: row.id,
    datosGenerales: dg,
    estatus: row.estatus,
    creadoEn: row.creado_en,
    oficios: oficios.map(oficioAJson),
    facturas: facturas.map(facturaAJson)
  };
}

async function cargarContratoCompleto(id) {
  const { rows: contratoRows } = await db.query('SELECT * FROM contratos WHERE id = $1', [id]);
  if (contratoRows.length === 0) return null;
  const { rows: oficios } = await db.query('SELECT * FROM oficios WHERE contrato_id = $1 ORDER BY id', [id]);
  const { rows: facturas } = await db.query('SELECT * FROM facturas WHERE contrato_id = $1 ORDER BY id', [id]);
  return contratoAJson(contratoRows[0], oficios, facturas);
}

router.get('/', async (req, res) => {
  try {
    const { rows: contratos } = await db.query('SELECT * FROM contratos ORDER BY id DESC');
    const { rows: oficios } = await db.query('SELECT * FROM oficios ORDER BY id');
    const { rows: facturas } = await db.query('SELECT * FROM facturas ORDER BY id');

    const resultado = contratos.map(c => contratoAJson(
      c,
      oficios.filter(o => o.contrato_id === c.id),
      facturas.filter(f => f.contrato_id === c.id)
    ));
    res.json({ ok: true, contratos: resultado });
  } catch (error) {
    console.error('Error en GET /api/contratos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al listar contratos' });
  }
});

router.post('/', async (req, res) => {
  const { folioOficio, montoOficio, fechaOficio } = req.body;
  if (!folioOficio || montoOficio === undefined || !fechaOficio) {
    return res.status(400).json({ ok: false, mensaje: 'Faltan datos del oficio inicial' });
  }
  const cliente = await db.pool.connect();
  try {
    await cliente.query('BEGIN');
    const { rows } = await cliente.query(
      `INSERT INTO contratos (estatus) VALUES ('oficio_capturado') RETURNING id`
    );
    const contratoId = rows[0].id;
    await cliente.query(
      `INSERT INTO oficios (contrato_id, tipo, folio, monto, fecha) VALUES ($1, 'inicial', $2, $3, $4)`,
      [contratoId, folioOficio, montoOficio, fechaOficio]
    );
    await cliente.query('COMMIT');
    const contrato = await cargarContratoCompleto(contratoId);
    res.status(201).json({ ok: true, contrato });
  } catch (error) {
    await cliente.query('ROLLBACK');
    console.error('Error en POST /api/contratos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al crear el contrato' });
  } finally {
    cliente.release();
  }
});

router.put('/:id/datos-generales', async (req, res) => {
  const id = Number(req.params.id);
  const {
    noContrato, noRequisicion, fecha, proveedor, descripcion,
    modoFacturacion, numPeriodos, tieneAnticipo, montoAnticipo
  } = req.body;

  try {
    const { rows } = await db.query(
      `UPDATE contratos SET
         no_contrato = $1, no_requisicion = $2, fecha = $3, proveedor = $4, descripcion = $5,
         modo_facturacion = $6, num_periodos = $7, tiene_anticipo = $8, monto_anticipo = $9,
         estatus = CASE WHEN estatus = 'oficio_capturado' THEN 'en_facturacion' ELSE estatus END
       WHERE id = $10
       RETURNING id`,
      [noContrato, noRequisicion, fecha, proveedor, descripcion, modoFacturacion, numPeriodos, !!tieneAnticipo, montoAnticipo || 0, id]
    );
    if (rows.length === 0) return res.status(404).json({ ok: false, mensaje: 'Contrato no encontrado' });
    const contrato = await cargarContratoCompleto(id);
    res.json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en PUT /datos-generales:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al guardar los datos generales' });
  }
});

router.post('/:id/oficios', async (req, res) => {
  const id = Number(req.params.id);
  const { tipo, folio, monto, fecha } = req.body;
  if (!['ampliacion', 'cancelacion'].includes(tipo)) {
    return res.status(400).json({ ok: false, mensaje: 'Tipo de oficio inválido' });
  }
  try {
    await db.query(
      `INSERT INTO oficios (contrato_id, tipo, folio, monto, fecha) VALUES ($1,$2,$3,$4,$5)`,
      [id, tipo, folio, monto, fecha]
    );
    const contrato = await cargarContratoCompleto(id);
    res.status(201).json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en POST /oficios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar el oficio' });
  }
});

router.delete('/:id/oficios/:oficioId', async (req, res) => {
  const id = Number(req.params.id);
  const oficioId = Number(req.params.oficioId);
  try {
    await db.query(
      `DELETE FROM oficios WHERE id = $1 AND contrato_id = $2 AND tipo <> 'inicial'`,
      [oficioId, id]
    );
    const contrato = await cargarContratoCompleto(id);
    res.json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en DELETE /oficios:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el oficio' });
  }
});

router.post('/:id/facturas', async (req, res) => {
  const id = Number(req.params.id);
  const { periodoTipo, periodoIndex, periodoLabel, noFactura, fecha, monto } = req.body;
  try {
    const existente = await db.query(
      `SELECT id FROM facturas WHERE contrato_id = $1 AND periodo_tipo = $2 AND periodo_index = $3`,
      [id, periodoTipo, periodoIndex]
    );

    if (existente.rows.length > 0) {
      await db.query(
        `UPDATE facturas SET no_factura = $1, fecha = $2, monto = $3 WHERE id = $4`,
        [noFactura, fecha, monto, existente.rows[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO facturas (contrato_id, periodo_tipo, periodo_index, periodo_label, no_factura, fecha, monto)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, periodoTipo, periodoIndex, periodoLabel, noFactura, fecha, monto]
      );
    }
    const contrato = await cargarContratoCompleto(id);
    res.status(201).json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en POST /facturas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar la factura' });
  }
});

router.put('/:id/facturas/:facturaId/fecha-pago', async (req, res) => {
  const id = Number(req.params.id);
  const facturaId = Number(req.params.facturaId);
  const { fechaPago } = req.body;
  try {
    await db.query(
      `UPDATE facturas SET fecha_pago = $1 WHERE id = $2 AND contrato_id = $3`,
      [fechaPago, facturaId, id]
    );
    const contrato = await cargarContratoCompleto(id);
    res.json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en PUT /fecha-pago:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al registrar la fecha de pago' });
  }
});

router.delete('/:id/facturas/:facturaId', async (req, res) => {
  const id = Number(req.params.id);
  const facturaId = Number(req.params.facturaId);
  try {
    await db.query(`DELETE FROM facturas WHERE id = $1 AND contrato_id = $2`, [facturaId, id]);
    const contrato = await cargarContratoCompleto(id);
    res.json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en DELETE /facturas:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar la factura' });
  }
});

router.put('/:id/completar', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.query(`UPDATE contratos SET estatus = 'completado' WHERE id = $1`, [id]);
    const contrato = await cargarContratoCompleto(id);
    res.json({ ok: true, contrato });
  } catch (error) {
    console.error('Error en PUT /completar:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al marcar el contrato como completado' });
  }
});

router.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await db.query(`DELETE FROM contratos WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Error en DELETE /contratos:', error);
    res.status(500).json({ ok: false, mensaje: 'Error al eliminar el contrato' });
  }
});

module.exports = router;