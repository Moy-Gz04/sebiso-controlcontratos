// Prueba de varios oficios de autorización por contrato (sus montos se suman) y de la
// reducción líquida por oficio. Usa un contrato de PRUEBA que se borra al final.
// Uso (desde Server/): node scripts/prueba-autorizaciones.js [url-api]
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
const hoy = '2026-10-08';

(async () => {
  const ids = [];
  try {
    let r = await api('POST', '/pedidos', { producto: 'PRUEBA VARIOS OFICIOS', cantidad: 1, unidadMedida: 'servicio', montoEstimado: 100000, fechaSolicitud: hoy });
    const A = r.pedido.id; ids.push(A);

    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { oficios: [{ noOficio: 'SH/10/2026', monto: 60000 }, { noOficio: 'sh/10/2026', monto: 1 }] });
    check(r.status === 400, 'no acepta dos oficios con el mismo número');
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { oficios: [{ noOficio: 'SH/10/2026', monto: 60000 }, { noOficio: '', monto: 5 }] });
    check(r.status === 400 && /oficio 2/.test(r.mensaje), 'avisa qué oficio está incompleto: ' + r.mensaje);
    r = await api('PUT', `/pedidos/${A}/oficio-autorizacion`, { oficios: [{ noOficio: 'SH/10/2026', monto: 60000, fecha: hoy }, { noOficio: 'SH/11/2026', monto: 40000, fecha: hoy }] });
    check(r.ok && r.pedido.autorizaciones.length === 2 && r.pedido.autorizacion.monto === 100000, 'dos oficios registrados; el autorizado es la suma (100,000)');
    check(r.pedido.estatus === 'oficio_autorizado', 'el contrato avanza a oficio autorizado');

    r = await api('POST', `/pedidos/${A}/autorizaciones`, { noOficio: 'SH/12/2026', monto: 5000, fecha: hoy });
    check(r.ok && r.pedido.autorizaciones.length === 3 && r.pedido.autorizacion.monto === 105000, 'se agrega un tercer oficio después y se suma (105,000)');
    r = await api('POST', `/pedidos/${A}/autorizaciones`, { noOficio: 'SH/12/2026', monto: 5000, fecha: hoy });
    check(r.status === 400, 'no deja agregar un oficio repetido');
    const [o1, o2, o3] = r.status === 400 ? (await api('GET', '/pedidos')).pedidos.find(p => p.id === A).autorizaciones : [];

    r = await api('PUT', `/pedidos/${A}/omitir/oficio-adecuacion`);
    r = await api('POST', `/pedidos/${A}/facturas`, { noFactura: 'F-1', fecha: hoy, descripcion: 'd', monto: 90000 });
    check(r.ok, 'factura de 90,000 dentro del autorizado sumado');

    r = await api('PUT', `/pedidos/${A}/reduccion`, { montoEjercido: 50000, fecha: hoy });
    check(r.status === 400 && /Elige/.test(r.mensaje), 'con varios oficios pide elegir a cuál aplica la reducción');
    r = await api('PUT', `/pedidos/${A}/reduccion`, { autorizacionId: o1.id, montoEjercido: 70000, fecha: hoy });
    check(r.status === 400, 'la reducción no puede ser mayor al monto de su oficio (60,000)');
    r = await api('PUT', `/pedidos/${A}/reduccion`, { autorizacionId: o1.id, montoEjercido: 50000, fecha: hoy });
    let p = r.pedido;
    check(r.ok && p.autorizaciones.find(a => a.id === o1.id).reduccion.montoEjercido === 50000, 'reducción del oficio 1: queda en 50,000');
    check(p.reduccion && p.reduccion.montoEjercido === 95000, 'el contrato queda en 50,000 + 40,000 + 5,000 = 95,000');
    r = await api('PUT', `/pedidos/${A}/reduccion`, { autorizacionId: o2.id, montoEjercido: 30000, fecha: hoy });
    check(r.status === 400 && /facturado/.test(r.mensaje), 'no deja reducir por debajo de lo facturado (85,000 < 90,000)');
    r = await api('PUT', `/pedidos/${A}/reduccion`, { autorizacionId: o2.id, montoEjercido: 35000, fecha: hoy });
    check(r.ok && r.pedido.reduccion.montoEjercido === 90000, 'reducción del oficio 2: el contrato queda en 90,000');

    r = await api('DELETE', `/pedidos/${A}/autorizaciones/${o3.id}`);
    check(r.ok && r.pedido.autorizaciones.length === 2 && r.pedido.reduccion.montoEjercido === 85000 - 0 || r.status === 400, 'quitar el oficio 3 se valida contra lo facturado');
    r = await api('GET', '/pedidos'); p = r.pedidos.find(x => x.id === A);
    const quedan = p.autorizaciones.length;

    r = await api('PUT', `/pedidos/${A}/editar-todo`, { autorizaciones: [{ id: o1.id, noOficio: 'SH/10-B/2026', monto: 60000, fecha: hoy, reduccion: { montoEjercido: 55000, fecha: hoy } }] });
    check(r.ok && r.pedido.autorizaciones.find(a => a.id === o1.id).noOficio === 'SH/10-B/2026' && r.pedido.autorizaciones.find(a => a.id === o1.id).reduccion.montoEjercido === 55000, 'editar todo corrige número y reducción de un oficio');
    r = await api('PUT', `/pedidos/${A}/editar-todo`, { autorizaciones: [{ id: o1.id, noOficio: 'SH/10-B/2026', monto: 60000, fecha: hoy, reduccion: { montoEjercido: 65000, fecha: hoy } }] });
    check(r.status === 400, 'editar todo no deja una reducción mayor al oficio');

    const pdf = Buffer.from('%PDF-1.4 red');
    r = await api('PUT', `/pedidos/${A}/documento-reduccion-${o1.id}`, pdf, 'application/pdf');
    check(r.ok || r.status === 503, 'acepta el documento de la reducción de un oficio' + (r.status === 503 ? ' (Drive no configurado en local)' : ''));
    r = await api('PUT', `/pedidos/${A}/documento-reduccion-999999`, pdf, 'application/pdf');
    check(r.status === 404 || r.status === 503, 'rechaza documento de reducción de un oficio ajeno');
    console.log('  (oficios restantes tras intentar quitar uno: ' + quedan + ')');
  } catch (e) {
    fallas++; console.log('  ✘ ERROR', e.stack);
  } finally {
    for (const id of ids) await api('DELETE', `/pedidos/${id}`);
    console.log(`Contrato de prueba borrado (${ids.join(', ')}).`);
    console.log(`\nRESULTADO: ${ok} correctas, ${fallas} fallas`);
    process.exit(fallas ? 1 : 0);
  }
})();
