// Prueba completa del flujo de 10 pasos con un contrato de PRUEBA que se borra al final.
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

(async () => {
  const ids = [];
  try {
    // ---------- Contrato A: flujo completo con todos los opcionales ----------
    console.log('Contrato A (todos los pasos):');
    let r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO A', cantidad: 1, unidadMedida: 'servicio', proveedor: 'Prueba', areaSolicitante: 'Coordinación Administrativa', montoEstimado: 60000, fechaSolicitud: '2026-10-06' });
    const A = r.pedido.id; ids.push(A);
    check(r.pedido.estatus === 'pedido_creado', 'creado en pedido_creado');

    r = await api('PUT', `/pedidos/${A}/contrarecibo`, { noContrarecibo: 'X', fecha: '2026-10-06', cuentaPorPagar: 'C', monto: 1 });
    check(r.status === 409, 'no deja saltarse el oficio de autorización (409)');
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { noOficio: '', monto: 50000 });
    check(r.status === 400, 'oficio sin número → 400: ' + r.mensaje);
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { noOficio: 'SH/9999/2026', monto: -5 });
    check(r.status === 400, 'monto negativo → 400');
    r = await api('PUT', `/pedidos/${A}/oficio-adecuacion/../omitir/oficio-adecuacion`);
    r = await api('PUT', `/pedidos/${A}/omitir/oficio-autorizacion`);
    check(r.status === 400, 'no deja omitir un paso obligatorio');
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { noOficio: 'SH/9999/2026', monto: 50000 });
    check(r.ok && r.pedido.estatus === 'oficio_autorizado' && r.pedido.autorizacion.monto === 50000, 'oficio de autorización 50,000');

    r = await api('PUT', `/pedidos/${A}/documento-autorizacion`, Buffer.from('%PDF-1.4 prueba'), 'application/pdf');
    check(r.ok && r.pedido.documentoAutorizacion, 'sube documento del oficio a Drive');

    r = await api('POST', `/pedidos/${A}/oficios`, { tipo: 'ampliacion', folio: 'AMP-1', monto: 2000, fecha: '2026-10-06' });
    check(r.ok && r.pedido.oficios.length === 1, 'ampliación +2,000 (autorizado vigente 52,000)');

    r = await api('PUT', `/pedidos/${A}/contrarecibo`, { noContrarecibo: 'CR-1', fecha: '2026-10-06', cuentaPorPagar: 'CXP-77', monto: 52000 });
    check(r.ok && r.pedido.contrarecibo.cuentaPorPagar === 'CXP-77', 'contrarrecibo con cuenta por pagar');
    r = await api('PUT', `/pedidos/${A}/documento-contrarecibo`, Buffer.from('%PDF-1.4 cr'), 'application/pdf');
    check(r.ok && r.pedido.documentoContrarecibo, 'sube documento del contrarrecibo');

    r = await api('PUT', `/pedidos/${A}/oficio-adecuacion`, { folio: 'ADE-1', monto: 50000, fecha: '2026-10-06' });
    check(r.ok && r.pedido.estatus === 'adecuacion' && r.pedido.oficio.monto === 50000, 'adecuación a 50,000 (vigente = 50,000 + 2,000)');

    r = await api('PUT', `/pedidos/${A}/factura`, { noFactura: 'F-1', fecha: '2026-10-06', descripcion: 'Servicio de prueba', monto: 47000 });
    check(r.ok && r.pedido.factura.descripcion === 'Servicio de prueba', 'factura 47,000 con descripción');
    r = await api('PUT', `/pedidos/${A}/documento-factura`, Buffer.from('%PDF-1.4 fac'), 'application/pdf');
    check(r.ok && r.pedido.documentoFactura, 'sube el PDF de la factura');
    const enlF = await api('POST', `/pedidos/${A}/enlace/documento-factura`);
    const fF = await fetch(API + enlF.ruta);
    check(fF.ok && (await fF.text()).startsWith('%PDF'), 'abre la factura con enlace temporal');

    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 99999 });
    check(r.status === 400, 'reducción mayor al autorizado → 400: ' + r.mensaje);
    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 47000 });
    check(r.ok && r.pedido.reduccion.montoEjercido === 47000, 'reducción: se gastaron 47,000');

    r = await api('PUT', `/pedidos/${A}/entrega`, { fechaEntrega: '2026-10-06' });
    check(r.ok && r.pedido.estatus === 'entregado', 'entrega');
    r = await api('PUT', `/pedidos/${A}/contabilidad`, { fechaContabilidad: '2026-10-06' });
    r = await api('PUT', `/pedidos/${A}/inicio-pago`, { fechaInicioPago: '2026-10-06' });
    r = await api('PUT', `/pedidos/${A}/pagado`, { fechaPagado: '2026-10-06' });
    check(r.ok && r.pedido.estatus === 'pagado', 'contabilidad → pago → pagado');
    r = await api('PUT', `/pedidos/${A}/pagado`, { fechaPagado: '2026-10-06' });
    check(r.status === 409, 'no deja registrar el pago dos veces');

    // ---------- Contrato B: omitiendo los tres opcionales ----------
    console.log('Contrato B (omitiendo opcionales):');
    r = await api('POST', '/pedidos', { producto: 'PRUEBA FLUJO B', cantidad: 1, unidadMedida: 'pieza', montoEstimado: 1000, fechaSolicitud: '2026-10-06' });
    const B = r.pedido.id; ids.push(B);
    await api('PUT', `/pedidos/${B}/oficio-autorizacion`, { noOficio: 'SH/1/2026', monto: 1000 });
    await api('PUT', `/pedidos/${B}/contrarecibo`, { noContrarecibo: 'CR', fecha: '2026-10-06', cuentaPorPagar: 'C', monto: 1000 });
    r = await api('PUT', `/pedidos/${B}/omitir/reduccion`);
    check(r.status === 409, 'no deja omitir la reducción antes de tiempo');
    r = await api('PUT', `/pedidos/${B}/omitir/oficio-adecuacion`);
    check(r.ok && r.pedido.estatus === 'adecuacion' && !r.pedido.oficio, 'omite adecuación');
    await api('PUT', `/pedidos/${B}/factura`, { noFactura: 'F', fecha: '2026-10-06', descripcion: 'd', monto: 1000 });
    r = await api('PUT', `/pedidos/${B}/omitir/reduccion`);
    check(r.ok && r.pedido.estatus === 'reduccion' && !r.pedido.reduccion, 'omite reducción');
    r = await api('PUT', `/pedidos/${B}/omitir/entrega`);
    check(r.ok && r.pedido.estatus === 'entregado' && !r.pedido.fechaEntrega, 'omite entrega');
    r = await api('PUT', `/pedidos/${B}/contabilidad`, { fechaContabilidad: '2026-10-06' });
    check(r.ok && r.pedido.estatus === 'en_contabilidad', 'sigue a contabilidad');

    // ---------- Listado ----------
    r = await api('GET', '/pedidos');
    const a = r.pedidos.find(p => p.id === A);
    check(a && a.documentoAutorizacion && a.documentoContrarecibo && a.reduccion, 'el listado trae todos los datos del contrato A');
    const enlace = await api('POST', `/pedidos/${A}/enlace/documento-contrarecibo`);
    const f = await fetch(API + enlace.ruta);
    check(f.ok && (await f.text()).startsWith('%PDF'), 'abre el documento del contrarrecibo con enlace temporal');
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
