// Prueba completa del flujo con varias facturas, usando contratos de PRUEBA que se borran al final.
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

(async () => {
  const ids = [];
  try {
    // ---------- Contrato A: varias facturas, reducción y seguimiento por factura ----------
    console.log('Contrato A (varias facturas):');
    let r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO A', cantidad: 1, unidadMedida: 'servicio', montoEstimado: 60000, fechaSolicitud: hoy });
    const A = r.pedido.id; ids.push(A);
    r = await api('PUT', `/pedidos/${A}/contrarecibo`, { noContrarecibo: 'X', fecha: hoy, cuentaPorPagar: 'C', monto: 1 });
    check(r.status === 409, 'no deja saltarse el oficio de autorización');
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { noOficio: 'SH/1/2026', monto: 50000 });
    check(r.ok && r.pedido.autorizacion.monto === 50000, 'oficio de autorización 50,000');
    r = await api('PUT', `/pedidos/${A}/documento-autorizacion`, pdf('aut'), 'application/pdf');
    check(r.ok && r.pedido.documentoAutorizacion, 'documento del oficio de autorización');
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F0', fecha: hoy, descripcion: 'x', monto: 10 });
    check(r.status === 409, 'no deja facturar antes de la adecuación');
    r = await api('POST', `/pedidos/${A}/oficios`, { tipo: 'ampliacion', folio: 'AMP-1', monto: 2000, fecha: hoy });
    check(r.ok, 'ampliación +2,000');
    r = await api('PUT', `/pedidos/${A}/contrarecibo`, { noContrarecibo: 'CR-1', fecha: hoy, cuentaPorPagar: 'CXP-1', monto: 52000 });
    check(r.ok && r.pedido.estatus === 'contrarecibo', 'contrarrecibo');
    r = await api('PUT', `/pedidos/${A}/oficio-adecuacion`, { folio: 'ADE-1', monto: 50000, fecha: hoy });
    check(r.ok && r.pedido.estatus === 'adecuacion', 'adecuación a 50,000 (vigente 52,000 con la ampliación)');
    r = await api('PUT', `/pedidos/${A}/documento-adecuacion`, pdf('ade'), 'application/pdf');
    check(r.ok && r.pedido.documentoAdecuacion, 'documento del oficio de adecuación');

    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-1', fecha: hoy, descripcion: 'Primera', monto: 20000 });
    const F1 = r.facturaId;
    check(r.ok && r.pedido.estatus === 'factura_recibida' && r.pedido.facturas.length === 1, 'primera factura 20,000 → avanza a facturas');
    r = await api('PUT', `/pedidos/${A}/documento-factura-${F1}`, pdf('f1'), 'application/pdf');
    check(r.ok && r.pedido.facturas[0].documento, 'PDF de la factura 1');
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'f-1', fecha: hoy, descripcion: 'dup', monto: 10 });
    check(r.status === 400, 'no acepta número de factura repetido');
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-X', fecha: hoy, descripcion: 'de más', monto: 40000 });
    check(r.status === 400, 'no deja facturar de más: ' + r.mensaje);

    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 15000 });
    check(r.status === 400, 'reducción menor a lo facturado → 400');
    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 47000 });
    check(r.ok && r.pedido.reduccion.montoEjercido === 47000, 'reducción: se ejercen 47,000 (por facturar 27,000)');
    r = await api('PUT', `/pedidos/${A}/documento-reduccion`, pdf('red'), 'application/pdf');
    check(r.ok && r.pedido.documentoReduccion, 'documento de la reducción');
    r = await api('PUT', `/pedidos/${A}/entrega`, { fechaEntrega: hoy });
    check(r.ok && r.pedido.estatus === 'entregado', 'entrega (sin esperar las facturas faltantes)');

    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/inicio-pago`, { fecha: hoy });
    check(r.status === 409, 'la factura no salta contabilidad');
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/contabilidad`, { fecha: hoy });
    check(r.ok && r.pedido.estatus === 'en_contabilidad', 'factura 1 a contabilidad → contrato en contabilidad');
    await api('PUT', `/pedidos/${A}/facturas/${F1}/inicio-pago`, { fecha: hoy });
    r = await api('PUT', `/pedidos/${A}/facturas/${F1}/pagado`, { fecha: hoy });
    check(r.ok && r.pedido.estatus === 'en_pago' && r.pedido.facturas[0].estado === 'pagada', 'factura 1 pagada, pero el contrato sigue (faltan 27,000)');
    r = await api('PUT', `/pedidos/${A}/documento-pago-${F1}`, pdf('pago'), 'application/pdf');
    check(r.ok && r.pedido.facturas[0].comprobante, 'comprobante de pago de la factura 1');

    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-2', fecha: hoy, descripcion: 'Restante', monto: 27000 });
    const F2 = r.facturaId;
    check(r.ok && r.pedido.estatus === 'entregado' && r.pedido.facturas.length === 2, 'segunda factura 27,000 después de la entrega');
    await api('PUT', `/pedidos/${A}/facturas/${F2}/contabilidad`, { fecha: hoy });
    await api('PUT', `/pedidos/${A}/facturas/${F2}/inicio-pago`, { fecha: hoy });
    r = await api('PUT', `/pedidos/${A}/facturas/${F2}/pagado`, { fecha: hoy });
    check(r.ok && r.pedido.estatus === 'pagado', 'con todo facturado y pagado el contrato queda PAGADO');
    r = await api('DELETE', `/pedidos/${A}/facturas/${F2}`);
    check(r.status === 409, 'no deja borrar una factura pagada');
    const enl = await api('POST', `/pedidos/${A}/enlace/documento-pago-${F1}`);
    const f = await fetch(API + enl.ruta);
    check(f.ok && (await f.text()).startsWith('%PDF'), 'abre el comprobante con enlace temporal');
    r = await api('PUT', `/pedidos/${A}/documento-factura-999999`, pdf('x'), 'application/pdf');
    check(r.status === 404, 'no acepta documentos de facturas de otro contrato');

    // ---------- Contrato B: omitiendo opcionales y borrando una factura ----------
    console.log('Contrato B (omitiendo opcionales):');
    r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO B', cantidad: 1, unidadMedida: 'pieza', montoEstimado: 1000, fechaSolicitud: hoy });
    const B = r.pedido.id; ids.push(B);
    await api('PUT', `/pedidos/${B}/oficio-autorizacion`, { noOficio: 'SH/2/2026', monto: 1000 });
    await api('PUT', `/pedidos/${B}/contrarecibo`, { noContrarecibo: 'CR', fecha: hoy, cuentaPorPagar: 'C', monto: 1000 });
    r = await api('PUT', `/pedidos/${B}/omitir/oficio-adecuacion`);
    check(r.ok && r.pedido.estatus === 'adecuacion', 'omite adecuación');
    r = await api('POST', `/pedidos/${B}/facturas`, { noFactura: 'B-1', fecha: hoy, descripcion: 'd', monto: 400 });
    const B1 = r.facturaId;
    r = await api('DELETE', `/pedidos/${B}/facturas/${B1}`);
    check(r.ok && r.pedido.estatus === 'adecuacion' && r.pedido.facturas.length === 0, 'borrar la única factura regresa a facturación');
    r = await api('POST', `/pedidos/${B}/facturas`, { noFactura: 'B-1', fecha: hoy, descripcion: 'd', monto: 1000 });
    const B2 = r.facturaId;
    r = await api('PUT', `/pedidos/${B}/omitir/reduccion`);
    r = await api('PUT', `/pedidos/${B}/omitir/entrega`);
    check(r.ok && r.pedido.estatus === 'entregado', 'omite reducción y entrega');
    await api('PUT', `/pedidos/${B}/facturas/${B2}/contabilidad`, { fecha: hoy });
    await api('PUT', `/pedidos/${B}/facturas/${B2}/inicio-pago`, { fecha: hoy });
    r = await api('PUT', `/pedidos/${B}/facturas/${B2}/pagado`, { fecha: hoy });
    check(r.ok && r.pedido.estatus === 'pagado', 'una sola factura por el total → PAGADO');

    r = await api('GET', '/pedidos');
    const a = r.pedidos.find(p => p.id === A);
    check(a && a.facturas.length === 2 && a.documentoReduccion && a.documentoAdecuacion, 'el listado trae facturas y documentos');
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
