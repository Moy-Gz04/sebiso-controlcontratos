// Prueba completa del flujo por factura, usando contratos de PRUEBA que se borran al final.
// Cada factura: factura → entrega → contabilidad → contrarrecibo → proceso de pago → pagado.
// Uso (desde Server/): node scripts/prueba-flujo.js [url-api]
require('dotenv').config();
const jwt = require('jsonwebtoken');
const db = require('../src/db');
const API = process.argv[2] || 'http://localhost:3917/api';
const T = 'Bearer ' + jwt.sign({ id: 1, usuario: 'admin' }, process.env.JWT_SECRET, { expiresIn: '20m' });
let fallas = 0, ok = 0;
const check = (cond, msg) => { if (cond) { ok++; console.log('  ✔', msg); } else { fallas++; console.log('  ✘', msg); } };
async function api(metodo, ruta, cuerpo, tipo = 'application/json') {
  const r = await fetch(API + ruta, { method: metodo, headers: { Authorization: T, 'Content-Type': tipo }, body: cuerpo === undefined ? undefined : (tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ...j };
}
const hoy = '2026-10-08';
const reg = (p, fid) => p.facturas.find(f => f.id === fid);

// Lleva una factura de punta a punta
async function completar(P, fid, monto, n) {
  await api('PUT', `/pedidos/${P}/facturas/${fid}/entrega`, { fecha: hoy });
  await api('PUT', `/pedidos/${P}/facturas/${fid}/contabilidad`, { fecha: hoy, noOficio: 'OF-' + n, monto });
  await api('PUT', `/pedidos/${P}/facturas/${fid}/contrarecibo`, { noContrarecibo: 'CR-' + n, fecha: hoy, cuentaPorPagar: 'C', monto });
  await api('PUT', `/pedidos/${P}/facturas/${fid}/inicio-pago`, { fecha: hoy, monto });
  return api('PUT', `/pedidos/${P}/facturas/${fid}/pagado`, { fecha: hoy });
}

(async () => {
  const ids = [];
  try {
    console.log('Contrato A (varias facturas):');
    let r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO FACTURA', cantidad: 1, montoEstimado: 60000, fechaSolicitud: hoy });
    const A = r.pedido.id; ids.push(A);
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'X', fecha: hoy, descripcion: 'd', monto: 1 });
    check(r.status === 409, 'no deja registrar factura sin autorización ni adecuación');
    await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { noOficio: 'SH/1/2026', monto: 50000 });
    await api('PUT', `/pedidos/${A}/omitir/oficio-adecuacion`);

    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-1', fecha: hoy, descripcion: 'Primera', monto: 60000 });
    check(r.status === 400 && /Por facturar/.test(r.mensaje), 'no deja facturar más del autorizado: ' + r.mensaje);
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-1', fecha: hoy, descripcion: 'Primera', monto: 20000 });
    const F1 = r.facturaId;
    check(r.ok && reg(r.pedido, F1).estado === 'facturado' && !reg(r.pedido, F1).contrarecibo, 'el registro nace con la factura (sin contrarrecibo)');
    check(r.pedido.estatus === 'factura_recibida', 'el contrato pasa a seguimiento de facturas');
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'f-1', fecha: hoy, descripcion: 'x', monto: 1 });
    check(r.status === 400, 'no deja dos facturas con el mismo número');
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-2', fecha: hoy, descripcion: 'Segunda', monto: 30000 });
    const F2 = r.facturaId;
    check(r.ok && r.pedido.facturas.length === 2, 'segunda factura: 50,000 de 50,000 facturados');

    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/contrarecibo`, { noContrarecibo: 'CR-X', fecha: hoy, cuentaPorPagar: 'C', monto: 20000 });
    check(r.status === 409, 'el contrarrecibo no se registra antes de contabilidad');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/contabilidad`, { fecha: hoy, noOficio: 'OF', monto: 20000 });
    check(r.status === 409, 'contabilidad espera a la entrega');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/entrega`, { fecha: hoy });
    check(r.ok && reg(r.pedido, F1).estado === 'entregado', 'entrega registrada');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/contabilidad`, { fecha: hoy, noOficio: 'OF-1', monto: 20000 });
    check(r.ok && reg(r.pedido, F1).estado === 'en_contabilidad', 'turnada a contabilidad');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/inicio-pago`, { fecha: hoy, monto: 20000 });
    check(r.status === 409 && /contrarrecibo/.test(r.mensaje), 'el pago espera al contrarrecibo');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/contrarecibo`, { noContrarecibo: 'CR-1', fecha: hoy, cuentaPorPagar: 'C', monto: 20000 });
    check(r.ok && reg(r.pedido, F1).estado === 'contrarecibo' && reg(r.pedido, F1).contrarecibo.noContrarecibo === 'CR-1', 'contrarrecibo registrado después de contabilidad');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/inicio-pago`, { fecha: hoy, monto: 20000 });
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/pagado`, { fecha: hoy });
    check(r.ok && reg(r.pedido, F1).estado === 'pagada' && r.pedido.estatus !== 'pagado', 'factura 1 pagada; el contrato sigue abierto');
    r = await completar(A, F2, 30000, 2);
    check(r.ok && r.pedido.estatus === 'pagado', 'con todas las facturas pagadas y el monto cubierto, el contrato queda PAGADO');

    r = await api('PUT', `/pedidos/${A}/facturas/${F2}/corregir-factura`, { noFactura: 'F-2B', fecha: hoy, descripcion: 'Segunda', monto: 30001 });
    check(r.status === 400, 'corregir una factura respeta el autorizado');
    r = await api('PUT', `/pedidos/${A}/facturas/${F2}/corregir-factura`, { noFactura: 'F-2B', fecha: hoy, descripcion: 'Segunda bis', monto: 30000 });
    check(r.ok && reg(r.pedido, F2).factura.noFactura === 'F-2B', 'corrige número y descripción de una factura');

    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 45000, fecha: hoy });
    check(r.status === 400 && /facturado/.test(r.mensaje), 'la reducción no puede quedar debajo de lo facturado');

    console.log('Registro anterior al cambio (contrarrecibo sin factura):');
    r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO LEGADO', cantidad: 1, montoEstimado: 10000, fechaSolicitud: hoy });
    const B = r.pedido.id; ids.push(B);
    await api('PUT', `/pedidos/${B}/oficio-autorizacion`, { noOficio: 'SH/2/2026', monto: 10000 });
    await api('PUT', `/pedidos/${B}/omitir/oficio-adecuacion`);
    const { rows } = await db.query("INSERT INTO pedido_facturas (pedido_id, cr_no, cr_fecha, cr_cuenta, cr_monto) VALUES ($1,'CR-V',$2,'C',8000) RETURNING id", [B, hoy]);
    await db.query("UPDATE pedidos SET estatus='factura_recibida' WHERE id=$1", [B]);
    const V = rows[0].id;
    r = await api('GET', '/pedidos');
    let b = r.pedidos.find(p => p.id === B);
    check(reg(b, V).estado === 'sin_factura' && reg(b, V).contrarecibo.noContrarecibo === 'CR-V' && reg(b, V).montoAmparado === 8000, 'se conserva su contrarrecibo y pide su factura');
    r = await api('POST', `/pedidos/${B}/facturas`, { noFactura: 'F-N', fecha: hoy, descripcion: 'n', monto: 3000 });
    check(r.status === 400, 'su contrarrecibo cuenta contra el autorizado mientras no tenga factura');
    r = await api('PUT', `/pedidos/${B}/facturas/${V}/factura`, { noFactura: 'F-V', fecha: hoy, descripcion: 'v', monto: 8000 });
    check(r.ok && reg(r.pedido, V).estado === 'facturado', 'se le registra la factura y sigue el camino nuevo');
    await api('PUT', `/pedidos/${B}/facturas/${V}/entrega`, { fecha: hoy });
    r = await api('PUT', `/pedidos/${B}/facturas/${V}/contabilidad`, { fecha: hoy, noOficio: 'OF-V', monto: 8000 });
    check(r.ok && reg(r.pedido, V).estado === 'contrarecibo', 'como ya tenía contrarrecibo, tras contabilidad queda listo para el pago');
  } catch (e) {
    fallas++; console.log('  ✘ ERROR', e.stack);
  } finally {
    for (const id of ids) await api('DELETE', `/pedidos/${id}`);
    console.log(`Contratos de prueba borrados (${ids.join(', ')}).`);
    console.log(`\nRESULTADO: ${ok} correctas, ${fallas} fallas`);
    process.exit(fallas ? 1 : 0);
  }
})();
