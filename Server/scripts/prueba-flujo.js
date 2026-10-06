// Prueba completa del flujo por contrarrecibos, usando contratos de PRUEBA que se borran al final.
// Cada contrarrecibo: factura → entrega → contabilidad → proceso de pago → pagado.
// Uso (desde Server/): node scripts/prueba-flujo.js [url-api]
require('dotenv').config();
const jwt = require('jsonwebtoken');
const API = process.argv[2] || 'http://localhost:3917/api';
const T = 'Bearer ' + jwt.sign({ id: 1, usuario: 'admin' }, process.env.JWT_SECRET, { expiresIn: '20m' });
let fallas = 0, ok = 0;
const check = (cond, msg) => { if (cond) { ok++; console.log('  ✔', msg); } else { fallas++; console.log('  ✘', msg); } };
async function api(metodo, ruta, cuerpo, tipo = 'application/json') {
  const r = await fetch(API + ruta, { method: metodo, headers: { Authorization: T, 'Content-Type': tipo }, body: cuerpo === undefined ? undefined : (tipo === 'application/json' ? JSON.stringify(cuerpo) : cuerpo) });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, ...j };
}
const pdf = t => Buffer.from('%PDF-1.4 ' + t);
const hoy = '2026-10-06';
const cr = (p, fid) => p.facturas.find(f => f.id === fid);

// Lleva un contrarrecibo de punta a punta
async function completar(P, fid, monto, noFactura) {
  await api('PUT', `/pedidos/${P}/facturas/${fid}/factura`, { noFactura, fecha: hoy, descripcion: 'd', monto });
  await api('PUT', `/pedidos/${P}/facturas/${fid}/entrega`, { fecha: hoy });
  await api('PUT', `/pedidos/${P}/facturas/${fid}/contabilidad`, { fecha: hoy, noOficio: 'OF-' + noFactura, monto });
  await api('PUT', `/pedidos/${P}/facturas/${fid}/inicio-pago`, { fecha: hoy, monto });
  return api('PUT', `/pedidos/${P}/facturas/${fid}/pagado`, { fecha: hoy });
}

(async () => {
  const ids = [];
  try {
    console.log('Contrato A (varios contrarrecibos):');
    let r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO A', cantidad: 1, unidadMedida: 'servicio', montoEstimado: 60000, fechaSolicitud: hoy });
    const A = r.pedido.id; ids.push(A);
    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'X', fecha: hoy, cuentaPorPagar: 'C', monto: 1 });
    check(r.status === 409, 'no deja registrar contrarrecibo sin autorización ni adecuación');
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { noOficio: 'SH/1/2026', monto: 50000 });
    check(r.ok && r.pedido.estatus === 'oficio_autorizado', 'oficio de autorización 50,000');
    r = await api('PUT', `/pedidos/${A}/documento-autorizacion`, pdf('aut'), 'application/pdf');
    check(r.ok && r.pedido.documentoAutorizacion, 'documento del oficio de autorización');
    r = await api('PUT', `/pedidos/${A}/contrarecibo`, { noContrarecibo: 'X', fecha: hoy, cuentaPorPagar: 'C', monto: 1 });
    check(r.status === 404 || r.status === 400, 'ya no existe el contrarrecibo general del contrato');
    r = await api('POST', `/pedidos/${A}/oficios`, { tipo: 'ampliacion', folio: 'AMP-1', monto: 2000, fecha: hoy });
    check(r.ok, 'ampliación +2,000');
    r = await api('PUT', `/pedidos/${A}/oficio-adecuacion`, { folio: 'ADE-1', monto: 50000, fecha: hoy });
    check(r.ok && r.pedido.estatus === 'adecuacion', 'adecuación a 50,000 (vigente 52,000 con la ampliación)');

    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'CR-1', fecha: hoy, cuentaPorPagar: 'CXP-1', monto: 20000 });
    const C1 = r.facturaId;
    check(r.ok && r.pedido.estatus === 'factura_recibida' && cr(r.pedido, C1).estado === 'contrarecibo', 'primer contrarrecibo 20,000 → contrato en contrarrecibos');
    r = await api('PUT', `/pedidos/${A}/documento-contrarecibo-${C1}`, pdf('cr1'), 'application/pdf');
    check(r.ok && cr(r.pedido, C1).contrarecibo.documento, 'documento del contrarrecibo 1');
    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'cr-1', fecha: hoy, cuentaPorPagar: 'C', monto: 10 });
    check(r.status === 400, 'no acepta número de contrarrecibo repetido');
    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'CR-X', fecha: hoy, cuentaPorPagar: 'C', monto: 40000 });
    check(r.status === 400, 'no deja pasarse del disponible: ' + r.mensaje);
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/contrarecibo`, { noContrarecibo: 'CR-1', fecha: hoy, cuentaPorPagar: 'CXP-1b', monto: 21000 });
    check(r.ok && cr(r.pedido, C1).contrarecibo.monto === 21000 && cr(r.pedido, C1).contrarecibo.cuentaPorPagar === 'CXP-1b', 'editar el contrarrecibo');

    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/entrega`, { fecha: hoy });
    check(r.status === 409, 'no hay entrega sin factura');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/factura`, { noFactura: 'F-1', fecha: hoy, descripcion: 'Primera', monto: 21000 });
    check(r.ok && cr(r.pedido, C1).estado === 'facturado' && cr(r.pedido, C1).factura.noFactura === 'F-1', 'factura del contrarrecibo 1');
    r = await api('PUT', `/pedidos/${A}/documento-factura-${C1}`, pdf('f1'), 'application/pdf');
    check(r.ok && cr(r.pedido, C1).factura.documento, 'PDF de la factura');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/contabilidad`, { fecha: hoy, noOficio: 'O', monto: 1 });
    check(r.status === 409, 'no pasa a contabilidad sin entrega');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/entrega`, { fecha: hoy });
    check(r.ok && cr(r.pedido, C1).estado === 'entregado', 'entrega del contrarrecibo 1');
    r = await api('PUT', `/pedidos/${A}/documento-entrega-${C1}`, pdf('ent'), 'application/pdf');
    check(r.ok && cr(r.pedido, C1).entrega.documento, 'documento de entrega');

    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 15000 });
    check(r.status === 400, 'reducción menor a los contrarrecibos → 400');
    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 47000 });
    check(r.ok && r.pedido.reduccion.montoEjercido === 47000, 'reducción: se ejercen 47,000');
    r = await api('PUT', `/pedidos/${A}/documento-reduccion`, pdf('red'), 'application/pdf');
    check(r.ok && r.pedido.documentoReduccion, 'documento de la reducción');

    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/contabilidad`, { fecha: hoy });
    check(r.status === 400, 'turnar a contabilidad sin oficio → 400');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/contabilidad`, { fecha: hoy, noOficio: 'OF-CONT', monto: 100 });
    check(r.ok && cr(r.pedido, C1).oficioContabilidad.noOficio === 'OF-CONT' && r.pedido.estatus === 'en_contabilidad', 'turnado a contabilidad con oficio → contrato en contabilidad');
    r = await api('PUT', `/pedidos/${A}/documento-contab-${C1}`, pdf('contab'), 'application/pdf');
    check(r.ok && cr(r.pedido, C1).oficioContabilidad.documento, 'documento del oficio de contabilidad');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/oficio-contabilidad`, { noOficio: 'OF-CONT-2', fecha: hoy, monto: 21000 });
    check(r.ok && cr(r.pedido, C1).oficioContabilidad.noOficio === 'OF-CONT-2' && cr(r.pedido, C1).oficioContabilidad.monto === 21000, 'corregir el oficio de contabilidad');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/inicio-pago`, { fecha: hoy });
    check(r.status === 400, 'iniciar pago sin monto → 400');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/inicio-pago`, { fecha: hoy, monto: 21000 });
    check(r.ok && cr(r.pedido, C1).procesoPago.monto === 21000 && r.pedido.estatus === 'en_pago', 'proceso de pago con monto → contrato en pago');
    r = await api('PUT', `/pedidos/${A}/documento-procpago-${C1}`, pdf('pp'), 'application/pdf');
    check(r.ok && cr(r.pedido, C1).procesoPago.documento, 'documento del proceso de pago');
    r = await api('PUT', `/pedidos/${A}/facturas/${C1}/pagado`, { fecha: hoy });
    check(r.ok && cr(r.pedido, C1).estado === 'pagada' && r.pedido.estatus !== 'pagado', 'contrarrecibo 1 pagado; el contrato sigue (faltan 26,000)');
    r = await api('PUT', `/pedidos/${A}/documento-pago-${C1}`, pdf('pago'), 'application/pdf');
    check(r.ok && cr(r.pedido, C1).pago.documento, 'comprobante de pago');
    r = await api('DELETE', `/pedidos/${A}/facturas/${C1}`);
    check(r.status === 409, 'no deja borrar un contrarrecibo pagado');

    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'CR-2', fecha: hoy, cuentaPorPagar: 'CXP-2', monto: 26000 });
    const C2 = r.facturaId;
    check(r.ok && r.pedido.facturas.length === 2 && r.pedido.estatus === 'reduccion', 'segundo contrarrecibo 26,000 (el contrato vuelve al mínimo de etapas)');
    r = await completar(A, C2, 26000, 'F-2');
    check(r.ok && r.pedido.estatus === 'pagado', 'con todo cubierto y pagado el contrato queda PAGADO');

    r = await api('POST', `/pedidos/${A}/oficios`, { tipo: 'ampliacion', folio: 'AMP-2', monto: 1000, fecha: hoy });
    check(r.ok && r.pedido.oficios.find(o => o.folio === 'AMP-2').posteriorReduccion === true, 'ampliación posterior a la reducción');
    check(r.pedido.estatus === 'en_pago', 'con +1,000 se reabre el saldo');
    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'CR-3', fecha: hoy, cuentaPorPagar: 'C', monto: 1000.01 });
    check(r.status === 400, 'solo deja registrar 1,000 más');
    r = await api('POST', `/pedidos/${A}/facturas`, { noContrarecibo: 'CR-3', fecha: hoy, cuentaPorPagar: 'C', monto: 1000 });
    check(r.ok, 'contrarrecibo de 1,000 por la ampliación');
    const enl = await api('POST', `/pedidos/${A}/enlace/documento-entrega-${C1}`);
    const f = await fetch(API + enl.ruta);
    check(f.ok && (await f.text()).startsWith('%PDF'), 'abre el documento de entrega con enlace temporal');
    r = await api('PUT', `/pedidos/${A}/documento-contrarecibo-999999`, pdf('x'), 'application/pdf');
    check(r.status === 404, 'no acepta documentos de contrarrecibos de otro contrato');

    console.log('Contrato B (omitiendo opcionales):');
    r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO B', cantidad: 1, unidadMedida: 'pieza', montoEstimado: 1000, fechaSolicitud: hoy });
    const B = r.pedido.id; ids.push(B);
    await api('PUT', `/pedidos/${B}/oficio-autorizacion`, { noOficio: 'SH/2/2026', monto: 1000 });
    r = await api('PUT', `/pedidos/${B}/omitir/oficio-adecuacion`);
    check(r.ok && r.pedido.estatus === 'adecuacion', 'omite adecuación');
    r = await api('POST', `/pedidos/${B}/facturas`, { noContrarecibo: 'B-1', fecha: hoy, cuentaPorPagar: 'C', monto: 400 });
    const B1 = r.facturaId;
    r = await api('DELETE', `/pedidos/${B}/facturas/${B1}`);
    check(r.ok && r.pedido.estatus === 'adecuacion' && r.pedido.facturas.length === 0, 'borrar el único contrarrecibo regresa al paso anterior');
    r = await api('POST', `/pedidos/${B}/facturas`, { noContrarecibo: 'B-1', fecha: hoy, cuentaPorPagar: 'C', monto: 1000 });
    const B2 = r.facturaId;
    r = await api('PUT', `/pedidos/${B}/omitir/reduccion`);
    check(r.ok && r.pedido.estatus === 'reduccion', 'omite reducción');
    r = await completar(B, B2, 1000, 'FB-1');
    check(r.ok && r.pedido.estatus === 'pagado', 'un solo contrarrecibo por el total → PAGADO');

    r = await api('GET', '/pedidos');
    const a = r.pedidos.find(p => p.id === A);
    check(a && a.facturas.length === 3 && a.documentoReduccion, 'el listado trae contrarrecibos y documentos');
  } catch (e) {
    fallas++; console.log('  ✘ ERROR', e.message);
  } finally {
    for (const id of ids) await api('DELETE', `/pedidos/${id}`);
    const r = await api('GET', '/pedidos');
    console.log(`Contratos de prueba borrados (${ids.join(', ')}); quedan ${r.pedidos.length} contratos.`);
    console.log(`\nRESULTADO: ${ok} correctas, ${fallas} fallas`);
    process.exit(fallas ? 1 : 0);
  }
})();
