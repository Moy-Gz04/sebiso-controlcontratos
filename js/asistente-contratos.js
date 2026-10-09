// =========================================================
// asistente-contratos.js
// La mascota como asistente del sistema de Contratos. Se carga después de
// minisebiso-flotante.js y, sin tocar la lógica de cada pantalla:
//   - acompaña cada acción que guarda algo con una ventana de trabajo:
//     qué está haciendo, barra de avance (real al subir documentos),
//     los pasos que lleva y el resultado (festeja o avisa el error);
//   - pregunta las confirmaciones (eliminar, etc.) con su diálogo;
//   - dice los avisos de error que no vienen de una acción;
//   - saluda al usuario y le cuenta qué tiene pendiente;
//   - al tocarla: «¿En qué puedo ayudarte?» con consultas y atajos.
// =========================================================
(function () {
  const M = window.MiniSEBISO;
  if (!M || !M.preguntar) return;

  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
  const dinero = (n) => (typeof fmtMoneda !== 'undefined' ? fmtMoneda.format(n || 0) : '$' + Number(n || 0).toFixed(2));
  const nombreUsuario = () => {
    const u = (typeof Store !== 'undefined' && Store.usuarioActual && Store.usuarioActual()) || '';
    return !u ? '' : u === 'admin' ? 'Administrador' : u.charAt(0).toUpperCase() + u.slice(1);
  };
  const saludoHora = () => { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'; };
  const enLogin = () => document.getElementById('pantalla-login')?.classList.contains('activa');

  /* ─────────────── Qué hace cada petición (para la ventana de trabajo) ─────────────── */
  const ETAPA = {
    'oficio-autorizacion': 'Registrando el oficio de autorización', 'oficio-adecuacion': 'Registrando el oficio de adecuación',
    reduccion: 'Guardando la reducción líquida', datos: 'Guardando los datos del contrato', 'editar-todo': 'Guardando todos los cambios',
    entrega: 'Registrando la entrega', contabilidad: 'Turnando la factura a contabilidad', contrarecibo: 'Guardando el contrarrecibo',
    'inicio-pago': 'Iniciando el proceso de pago', pagado: 'Registrando el pago', factura: 'Registrando la factura',
    'corregir-factura': 'Corrigiendo la factura', 'oficio-contabilidad': 'Guardando el oficio de contabilidad'
  };
  function describir(ruta, metodo, cuerpo) {
    const r = ruta.split('?')[0].split('/').filter(Boolean);   // ['pedidos', id, ...]
    const ult = r[r.length - 1];
    if (cuerpo instanceof Blob) return { texto: 'Subiendo ' + (cuerpo.name ? '«' + cuerpo.name + '»' : 'el documento'), subida: true };
    if (metodo === 'DELETE') {
      if (r.includes('facturas')) return { texto: 'Eliminando la factura' };
      if (r.includes('autorizaciones')) return { texto: 'Quitando el oficio de autorización' };
      if (r.includes('oficios')) return { texto: 'Quitando el oficio' };
      return { texto: 'Eliminando el contrato' };
    }
    if (r[0] === 'pedidos' && r.length === 1) return { texto: 'Creando el contrato' };
    if (r.includes('omitir')) return { texto: 'Omitiendo el paso' };
    if (ult === 'facturas') return { texto: 'Registrando la factura' };
    if (ult === 'autorizaciones') return { texto: 'Agregando el oficio de autorización' };
    if (ult === 'oficios') return { texto: 'Registrando el oficio' };
    if (ETAPA[ult]) return { texto: ETAPA[ult] };
    return { texto: 'Guardando los cambios' };
  }
  // No llevan ventana: entrar, abrir documentos (tienen su propia carga) y las consultas
  const sinVentana = (ruta, metodo) => metodo === 'GET' || /^\/login\b/.test(ruta) || /\/enlace\//.test(ruta);

  /* ─────────────── Ventana de trabajo ─────────────── */
  let op = null;   // la operación en curso: { overlay, pasos[], pendientes, avance, ... }

  function mascotaHTML() {
    return `<div class="ms-cuerpo"><span class="ms-ojo-mov izq"><span class="ms-ojo"></span></span><span class="ms-ojo-mov der"><span class="ms-ojo"></span></span></div><div class="ms-estrella"></div>`;
  }

  function abrirVentana() {
    const overlay = document.createElement('div');
    overlay.className = 'ms-dlg-overlay ms-trabajo';
    overlay.innerHTML = `
      <div class="ms-dlg-escena" role="status" aria-live="polite">
        <div class="minisebiso ms-dlg-mascota ms-trabajando" aria-hidden="true">${mascotaHTML()}</div>
        <div class="ms-dlg-globo">
          <div class="ms-dlg-saludo">Un momento…</div>
          <div class="ms-dlg-pregunta"></div>
          <div class="ms-trab-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
          <div class="ms-trab-pie"><b class="ms-trab-pct">0%</b><span class="ms-trab-det"></span></div>
          <ul class="ms-trab-pasos"></ul>
          <div class="ms-dlg-botones" hidden><button type="button" class="ms-dlg-btn ms-dlg-ok ms-dlg-ok-dorado"><i class="ti ti-check"></i> Entendido</button></div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    M.callar && M.callar();
    M.tomarEsquina && M.tomarEsquina();
    requestAnimationFrame(() => overlay.classList.add('visible'));
    const o = {
      overlay, pasos: [], pendientes: 0, avance: 0, meta: 0, aviso: null, error: null, cerrando: false, t0: performance.now(),
      el: (s) => overlay.querySelector(s)
    };
    // Los ojos siguen la barra mientras trabaja
    o.el('.ms-dlg-mascota').querySelectorAll('.ms-ojo-mov').forEach(oj => { oj.style.setProperty('--dx', '5px'); oj.style.setProperty('--dy', '4px'); });
    // La barra avanza sola hacia la meta (sin llegar al 100 % hasta que termina)
    const tic = () => {
      if (!o.overlay.isConnected || o.cerrando) return;
      const tope = o.subiendo !== undefined ? o.subiendo : 92;
      o.meta = Math.max(o.meta, tope);
      o.avance += (o.meta - o.avance) * (o.subiendo !== undefined ? 0.25 : 0.035);
      pintarAvance(o, o.avance);
      o.raf = requestAnimationFrame(tic);
    };
    o.raf = requestAnimationFrame(tic);
    return o;
  }

  function pintarAvance(o, pct) {
    const p = Math.max(0, Math.min(100, pct));
    o.el('.ms-trab-barra span').style.width = p.toFixed(1) + '%';
    o.el('.ms-trab-barra').setAttribute('aria-valuenow', Math.round(p));
    o.el('.ms-trab-pct').textContent = Math.round(p) + '%';
  }

  function pintarPasos(o) {
    const actual = o.pasos.filter(p => p.estado === 'actual').pop();
    o.el('.ms-dlg-pregunta').textContent = (actual || o.pasos[o.pasos.length - 1]).texto + (actual ? '…' : '');
    o.el('.ms-trab-pasos').innerHTML = o.pasos.length < 2 ? '' : o.pasos.map(p => `
      <li class="${p.estado}"><i class="ti ${p.estado === 'hecho' ? 'ti-circle-check' : p.estado === 'error' ? 'ti-alert-circle' : 'ti-loader-2'}" aria-hidden="true"></i>${esc(p.texto)}</li>`).join('');
  }

  function empezarPaso(info) {
    if (!op || op.cerrando) { if (op) finalizarYa(op); op = abrirVentana(); }
    clearTimeout(op.espera);
    const paso = { texto: info.texto, estado: 'actual' };
    op.pasos.push(paso);
    op.pendientes++;
    if (info.subida) { op.subiendo = op.avance; op.el('.ms-trab-det').textContent = 'Preparando el archivo…'; }
    else if (op.pasos.length > 1) op.meta = Math.min(op.meta, 92);
    pintarPasos(op);
    return paso;
  }

  function terminarPaso(paso, error) {
    if (!op) return;
    paso.estado = error ? 'error' : 'hecho';
    op.pendientes = Math.max(0, op.pendientes - 1);
    if (error) op.error = op.error || error.message;
    if (op.subiendo !== undefined && !op.pendientes) { delete op.subiendo; op.el('.ms-trab-det').textContent = ''; }
    pintarPasos(op);
    esperarCierre();
  }

  // Al terminar la última petición se espera un poco: puede venir otra (subir el documento),
  // la recarga del listado o el aviso con el resultado que la pantalla iba a mostrar
  function esperarCierre(ms = 450) {
    if (!op || op.pendientes) return;
    clearTimeout(op.espera);
    const o = op;
    o.espera = setTimeout(() => { if (op === o && !o.pendientes) finalizar(o); }, ms);
  }

  async function finalizar(o, { texto, esError } = {}) {
    if (o.cerrando) return;
    o.cerrando = true;
    clearTimeout(o.espera);
    cancelAnimationFrame(o.raf);
    if (op === o) op = null;
    const error = esError ? texto : o.error;
    const mascota = o.el('.ms-dlg-mascota');
    mascota.classList.remove('ms-trabajando');
    mascota.querySelectorAll('.ms-ojo-mov').forEach(oj => { oj.style.setProperty('--dx', '0px'); oj.style.setProperty('--dy', '0px'); });
    o.el('.ms-trab-det').textContent = '';
    if (error) {
      o.overlay.classList.add('ms-tono-error');
      o.el('.ms-dlg-saludo').textContent = 'No se pudo completar';
      o.el('.ms-dlg-pregunta').textContent = error;
      o.el('.ms-trab-barra').classList.add('error');
      o.pasos.forEach(p => { if (p.estado === 'actual') p.estado = 'error'; });
      pintarPasosSinTitulo(o);
      if (!quieto) mascota.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(-5deg)' }, { transform: 'rotate(0)' }], { duration: 460, easing: 'ease-in-out' });
      const botones = o.el('.ms-dlg-botones'); botones.hidden = false;
      const ok = botones.querySelector('button'); ok.focus();
      await new Promise(r => {
        ok.onclick = r;
        o.overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape' || e.key === 'Enter') r(); });
        o.overlay.addEventListener('click', (e) => { if (e.target === o.overlay) r(); });
      });
    } else {
      o.overlay.classList.add('ms-tono-exito');
      pintarAvance(o, 100);
      o.el('.ms-trab-barra').classList.add('listo');
      o.el('.ms-dlg-saludo').textContent = '¡Listo!';
      o.el('.ms-dlg-pregunta').textContent = (texto || (o.pasos.length ? hecho(o.pasos[0].texto) : 'Cambios guardados')).replace(/\.$/, '') + '.';
      pintarPasosSinTitulo(o);
      if (!quieto) mascota.animate([{ transform: 'none' }, { transform: 'translateY(-24px) rotate(-8deg) scale(1.05)', offset: .4 }, { transform: 'translateY(0) scale(1.08, .92)', offset: .75 }, { transform: 'none' }], { duration: 520, easing: 'ease-out' });
      await new Promise(r => { const t = setTimeout(r, 1300); o.overlay.onclick = () => { clearTimeout(t); r(); }; });
    }
    o.overlay.classList.remove('visible');
    setTimeout(() => o.overlay.remove(), 220);
    M.soltarEsquina && M.soltarEsquina();
  }
  function pintarPasosSinTitulo(o) {
    const t = o.el('.ms-dlg-pregunta').textContent;
    pintarPasos(o);
    o.el('.ms-dlg-pregunta').textContent = t;
  }
  function finalizarYa(o) { o.cerrando = true; cancelAnimationFrame(o.raf); o.overlay.remove(); M.soltarEsquina && M.soltarEsquina(); }
  // "Registrando la factura" → "Factura registrada" (para cuando la pantalla no dice nada)
  function hecho(t) {
    const m = { 'Subiendo': 'Documento guardado', 'Eliminando el contrato': 'Contrato eliminado', 'Eliminando la factura': 'Factura eliminada',
      'Creando el contrato': 'Contrato creado', 'Turnando la factura a contabilidad': 'Factura turnada a contabilidad', 'Iniciando el proceso de pago': 'Proceso de pago iniciado',
      'Omitiendo el paso': 'Paso omitido' };
    const k = Object.keys(m).find(k => t.startsWith(k));
    return k ? m[k] : 'Cambios guardados';
  }

  /* ─────────────── Envolver las peticiones ─────────────── */
  // Subida con avance real (fetch no informa cuánto lleva enviado)
  function subirConAvance(url, opciones, alAvanzar) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open(opciones.method || 'PUT', url);
      Object.entries(opciones.headers || {}).forEach(([k, v]) => x.setRequestHeader(k, v));
      x.upload.onprogress = (e) => { if (e.lengthComputable) alAvanzar(e.loaded, e.total); };
      x.onload = () => { let datos = {}; try { datos = JSON.parse(x.responseText); } catch (e) { /* sin cuerpo */ } resolve({ status: x.status, ok: x.status >= 200 && x.status < 300, datos }); };
      x.onerror = () => reject(new Error('No se pudo conectar con el servidor. Revisa tu conexión a internet.'));
      x.send(opciones.body);
    });
  }
  const mb = (b) => (b / 1048576).toFixed(b < 10485760 ? 1 : 0) + ' MB';

  const peticionOriginal = window.peticion;
  window.peticion = async function (ruta, opciones = {}) {
    const metodo = (opciones.method || 'GET').toUpperCase();
    if (sinVentana(ruta, metodo)) {
      // Si ya hay una ventana abierta (p. ej. se recarga el listado después de guardar), la espera
      if (!op || metodo !== 'GET') return peticionOriginal(ruta, opciones);
      op.pendientes++;
      try { return await peticionOriginal(ruta, opciones); }
      finally { if (op) { op.pendientes = Math.max(0, op.pendientes - 1); esperarCierre(); } }
    }
    const info = describir(ruta, metodo, opciones.body);
    const paso = empezarPaso(info);
    try {
      let datos;
      if (info.subida) {
        const o = op;
        const encabezados = { ...(opciones.headers || {}) };
        if (tokenSesion) encabezados.Authorization = `Bearer ${tokenSesion}`;
        const r = await subirConAvance(`${API_BASE_URL}${ruta}`, { ...opciones, headers: encabezados }, (va, total) => {
          if (o.cerrando) return;
          o.subiendo = Math.max(o.subiendo || 0, va / total * 85);
          o.el('.ms-trab-det').textContent = va < total ? `${mb(va)} de ${mb(total)}` : 'Guardando en el expediente…';
        });
        if (r.status === 401) { limpiarSesion(); throw new Error('Tu sesión expiró. Inicia sesión de nuevo.'); }
        if (!r.ok || r.datos.ok === false) throw new Error(r.datos.mensaje || 'Ocurrió un error inesperado.');
        datos = r.datos;
      } else {
        datos = await peticionOriginal(ruta, opciones);
      }
      terminarPaso(paso);
      return datos;
    } catch (err) {
      terminarPaso(paso, err);
      throw err;
    }
  };

  /* ─────────────── Avisos: los de una acción van a su ventana; los errores sueltos los dice la mascota ─────────────── */
  const avisoOriginal = window.mostrarAviso;
  window.mostrarAviso = function (texto, esError = false) {
    if (op && !op.cerrando) {
      // Una pantalla que sube su documento aparte avisa "…pero el documento no se subió": eso es error
      const esFalla = esError || /no se subió/i.test(texto);
      return finalizar(op, { texto, esError: esFalla });
    }
    if (esError && !enLogin() && M.decir(texto, { duracion: 7000 })) {
      const esq = M.esquina && M.esquina();
      if (esq && !quieto) esq.animate([{ transform: 'rotate(0)' }, { transform: 'rotate(-8deg)' }, { transform: 'rotate(8deg)' }, { transform: 'rotate(0)' }], { duration: 420 });
      return;
    }
    return avisoOriginal(texto, esError);
  };

  /* ─────────────── Confirmaciones con la mascota ─────────────── */
  if (typeof window.pedirConfirmacion === 'function') {
    const confirmarOriginal = window.pedirConfirmacion;
    window.pedirConfirmacion = function ({ titulo, mensaje, textoConfirmar = 'Confirmar', peligro = false, accion }) {
      if (enLogin()) return confirmarOriginal.apply(this, arguments);
      M.preguntar({
        titulo: titulo || '¿Seguro?', pregunta: mensaje, btnOk: textoConfirmar, btnCancel: 'Cancelar',
        iconoOk: peligro ? 'ti-trash' : 'ti-check', estiloOk: peligro ? '' : 'verde', tono: peligro ? 'aviso' : '',
        saludoOk: '¡Va!', textoOk: peligro ? 'Lo hago ahora mismo…' : 'Enseguida…',
        saludoCancel: '¡Sin problema!', textoCancel: 'Lo dejamos como está.'
      }).then(ok => { if (ok && accion) accion(); });
    };
  }

  /* ─────────────── Pendientes de los contratos ─────────────── */
  function pendientes() {
    const lista = (typeof pedidosCache !== 'undefined' ? pedidosCache : []).filter(p => p.estatus !== 'pagado');
    const grupos = { autorizacion: [], adecuacion: [], primera: [], porFacturar: [], entrega: [], contab: [], cr: [], pago: [], pagar: [] };
    lista.forEach(p => {
      if (p.estatus === 'pedido_creado') return grupos.autorizacion.push(p);
      if (p.estatus === 'oficio_autorizado') return grupos.adecuacion.push(p);
      if (p.estatus === 'adecuacion') return grupos.primera.push(p);
      const fs = p.facturas || [];
      const m = typeof montosDelContrato === 'function' ? montosDelContrato(p) : {};
      if ((m.porRegistrar || 0) > 0.005) grupos.porFacturar.push(p);
      if (fs.some(f => f.estado === 'sin_factura' || f.estado === 'facturado')) grupos.entrega.push(p);
      if (fs.some(f => f.estado === 'entregado')) grupos.contab.push(p);
      if (fs.some(f => f.estado === 'en_contabilidad')) grupos.cr.push(p);
      if (fs.some(f => f.estado === 'contrarecibo')) grupos.pago.push(p);
      if (fs.some(f => f.estado === 'en_pago')) grupos.pagar.push(p);
    });
    return { total: lista.length, grupos };
  }
  const RENGLON = {
    autorizacion: n => `${plural(n, 'contrato espera', 'contratos esperan')} su oficio de autorización`,
    adecuacion: n => `${plural(n, 'contrato puede llevar', 'contratos pueden llevar')} oficio de adecuación (u omitirlo)`,
    primera: n => `${plural(n, 'contrato espera', 'contratos esperan')} su primera factura`,
    porFacturar: n => `${plural(n, 'contrato tiene', 'contratos tienen')} monto por facturar`,
    entrega: n => `${plural(n, 'contrato tiene', 'contratos tienen')} facturas sin entrega registrada`,
    contab: n => `${plural(n, 'contrato tiene', 'contratos tienen')} facturas por turnar a contabilidad`,
    cr: n => `${plural(n, 'contrato tiene', 'contratos tienen')} facturas esperando su contrarrecibo`,
    pago: n => `${plural(n, 'contrato tiene', 'contratos tienen')} facturas listas para iniciar el pago`,
    pagar: n => `${plural(n, 'contrato tiene', 'contratos tienen')} pagos en proceso`
  };
  const nombreContrato = p => p.noContrato ? 'Contrato ' + p.noContrato : (p.producto || 'Contrato').slice(0, 40);

  // Abre la tarjeta de un contrato y la lleva a la vista
  function abrirContratoEnLista(p) {
    if (typeof filtroEtapa !== 'undefined') filtroEtapa = '';
    const b = document.getElementById('buscador-pedidos');
    if (b && b.value) { b.value = ''; b.dispatchEvent(new Event('input', { bubbles: true })); }
    tarjetasPedidoExpandidas.add(p.id);
    if (typeof renderFiltroEtapas === 'function') renderFiltroEtapas();
    aplicarFiltrosPedidos();
    setTimeout(() => {
      const t = document.querySelector(`[data-toggle-pedido="${p.id}"]`);
      if (!t) return;
      t.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'start' });
      const tarjeta = t.closest('.tc') || t;
      tarjeta.classList.add('ms-resaltado');
      setTimeout(() => tarjeta.classList.remove('ms-resaltado'), 2400);
    }, 60);
  }

  /* ─────────────── Saludo al entrar ─────────────── */
  const sesion = { get: k => { try { return sessionStorage.getItem('msc_' + k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem('msc_' + k, v); } catch (e) { /* sin storage */ } } };
  function decirSerie(mensajes) {
    let espera = 0;
    mensajes.forEach(m => { setTimeout(() => M.decir(m.texto, m), espera); espera += (m.duracion || 6500) + 350; });
  }
  function saludar() {
    const nombre = nombreUsuario();
    const clave = 'saludo_' + nombre;
    if (sesion.get(clave)) return;
    sesion.set(clave, '1');
    const { total, grupos } = pendientes();
    const mensajes = [{ texto: `¡${saludoHora()}${nombre ? ', ' + nombre : ''}! Aquí estoy para ayudarte con los contratos. Si tienes una duda, tócame.`, duracion: 6000 }];
    const claves = Object.keys(grupos).filter(k => grupos[k].length && k !== 'porFacturar');
    if (!total) mensajes.push({ texto: 'No hay contratos en curso. Cuando registres uno, te acompaño paso a paso.', duracion: 6000 });
    else if (!claves.length) mensajes.push({ texto: `Tienes ${plural(total, 'contrato', 'contratos')} en curso y todo está al día.`, duracion: 6000 });
    else mensajes.push({ texto: `Tienes ${plural(total, 'contrato', 'contratos')} en curso. ${RENGLON[claves[0]](grupos[claves[0]].length)}${claves.length > 1 ? ', entre otras cosas' : ''}.`, duracion: 11000, accion: 'Ver pendientes', alTocar: () => { abrirAyuda(); pintarRespuesta(PREGUNTAS[0]); } });
    decirSerie(mensajes);
  }

  /* ─────────────── Menú «¿En qué puedo ayudarte?» ─────────────── */
  const PREGUNTAS = [
    {
      pregunta: '¿Qué tengo pendiente?', icono: 'ti-list-check',
      cargar() {
        const { total, grupos } = pendientes();
        if (!total) return { texto: 'No hay contratos en curso: todo está pagado o aún no registras ninguno.', acciones: [{ texto: 'Registrar un contrato', icono: 'ti-plus', hacer: nuevoContrato }] };
        const claves = Object.keys(grupos).filter(k => grupos[k].length);
        if (!claves.length) return { texto: `Tienes ${plural(total, 'contrato', 'contratos')} en curso y ninguno espera un paso. ¡Todo al día!` };
        // El contrato más atrasado de cada grupo se puede abrir directo
        const vistos = new Set(), acciones = [];
        claves.forEach(k => grupos[k].forEach(p => { if (!vistos.has(p.id) && acciones.length < 3) { vistos.add(p.id); acciones.push({ texto: 'Abrir ' + nombreContrato(p), icono: 'ti-folder-open', hacer: () => abrirContratoEnLista(p) }); } }));
        return { texto: `De tus ${plural(total, 'contrato', 'contratos')} en curso:`, pasos: claves.map(k => RENGLON[k](grupos[k].length)), acciones };
      }
    },
    {
      pregunta: '¿Cuánto falta por facturar?', icono: 'ti-receipt',
      cargar() {
        const lista = (pedidosCache || []).filter(p => p.estatus !== 'pagado').map(p => ({ p, m: montosDelContrato(p) })).filter(x => (x.m.porRegistrar || 0) > 0.005 && x.m.disponible !== null)
          .sort((a, b) => b.m.porRegistrar - a.m.porRegistrar);
        if (!lista.length) return { texto: 'Todos los contratos en curso tienen su monto autorizado cubierto con facturas.' };
        const suma = lista.reduce((t, x) => t + x.m.porRegistrar, 0);
        return {
          texto: `Faltan ${dinero(suma)} por facturar en ${plural(lista.length, 'contrato', 'contratos')}:`,
          pasos: lista.slice(0, 5).map(x => `${nombreContrato(x.p)}: ${dinero(x.m.porRegistrar)} de ${dinero(x.m.disponible)}`),
          acciones: lista.slice(0, 2).map(x => ({ texto: 'Abrir ' + nombreContrato(x.p), icono: 'ti-folder-open', hacer: () => abrirContratoEnLista(x.p) }))
        };
      }
    },
    {
      pregunta: '¿En qué orden va el trámite?', icono: 'ti-route',
      texto: 'Cada contrato sigue este camino. Las facturas avanzan cada una por su lado:',
      pasos: [
        'Contrato: se registra con su monto.',
        'Oficio de autorización: uno o varios; sus montos se suman.',
        'Oficio de adecuación: opcional, si cambia el monto autorizado.',
        'Facturas: una o varias, hasta cubrir el autorizado.',
        'Por cada factura: entrega → contabilidad → contrarrecibo → proceso de pago → pagado.',
        'Reducción líquida: opcional, al final, por lo que realmente se ocupó.'
      ]
    },
    {
      pregunta: '¿Cómo registro una factura?', icono: 'ti-file-invoice',
      texto: 'Así se registra y se le da seguimiento:',
      pasos: [
        'Abre el contrato (debe tener ya su oficio de autorización).',
        'En «Primera factura» o en «Registrar otra factura» captura número, fecha, monto y descripción, y adjunta el PDF.',
        'Después, en la misma factura, usa el botón del siguiente paso: entrega, contabilidad, contrarrecibo y pago.',
        'El contrarrecibo se registra después de turnar la factura a contabilidad.'
      ],
      cargar() {
        const p = (pedidosCache || []).find(p => p.estatus === 'adecuacion') || (pedidosCache || []).find(p => p.estatus !== 'pagado' && (montosDelContrato(p).porRegistrar || 0) > 0.005 && ['factura_recibida', 'en_contabilidad', 'en_pago'].includes(p.estatus));
        return p ? { acciones: [{ texto: 'Ir a ' + nombreContrato(p), icono: 'ti-folder-open', hacer: () => abrirContratoEnLista(p) }] } : {};
      }
    },
    {
      pregunta: 'Buscar un contrato', icono: 'ti-search',
      texto: 'Escribe el número de contrato, el producto o el proveedor en el buscador. También puedes filtrar por etapa con las pastillas de arriba.',
      acciones: [{ texto: 'Ir al buscador', icono: 'ti-search', hacer: () => { const b = document.getElementById('buscador-pedidos'); if (b) { b.scrollIntoView({ behavior: quieto ? 'auto' : 'smooth', block: 'center' }); b.focus(); } } }]
    },
    {
      pregunta: 'Registrar un contrato nuevo', icono: 'ti-file-plus',
      texto: 'Captura los datos y el monto del contrato; si tienes el PDF, adjúntalo. Después sigue el oficio de autorización.',
      acciones: [{ texto: 'Nuevo contrato', icono: 'ti-plus', hacer: nuevoContrato }]
    },
    {
      pregunta: '¿Puedo corregir algo ya guardado?', icono: 'ti-pencil',
      texto: 'Sí. Cada factura tiene «Editar factura» y, si ya lo tiene, «Editar contrarrecibo». Para todo lo demás abre el contrato y usa «Editar información»: no se guarda nada si los montos no cuadran, y te digo qué revisar.'
    }
  ];
  function nuevoContrato() { document.getElementById('btn-nuevo-pedido')?.click(); }

  let panel = null;
  function abrirAyuda() {
    if (panel) { cerrarAyuda(); return; }
    M.callar(); M.despierto(true);
    panel = document.createElement('div');
    panel.className = 'ms-ayuda';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Ayuda');
    document.body.appendChild(panel);
    pintarMenu();
    document.addEventListener('keydown', teclaAyuda);
    document.addEventListener('pointerdown', fueraAyuda, true);
  }
  function cerrarAyuda() {
    if (!panel) return;
    panel.remove(); panel = null;
    document.removeEventListener('keydown', teclaAyuda);
    document.removeEventListener('pointerdown', fueraAyuda, true);
    M.despierto(false);
  }
  function teclaAyuda(e) { if (e.key === 'Escape') cerrarAyuda(); }
  function fueraAyuda(e) { if (panel && !panel.contains(e.target) && !(M.esquina && M.esquina().contains(e.target))) cerrarAyuda(); }
  function pintarMenu() {
    const nombre = nombreUsuario();
    panel.innerHTML = `
      <div class="ms-ayuda-cab">
        <span class="ms-ayuda-saludo">${esc(nombre ? `¡Hola, ${nombre}!` : '¡Hola!')}</span>
        <strong class="ms-ayuda-titulo">¿En qué puedo ayudarte?</strong>
      </div>
      <div class="ms-ayuda-lista">
        ${PREGUNTAS.map((q, i) => `<button type="button" class="ms-ayuda-op" data-i="${i}"><i class="ti ${q.icono}" aria-hidden="true"></i><span>${esc(q.pregunta)}</span><i class="ti ti-chevron-right ms-ayuda-flecha" aria-hidden="true"></i></button>`).join('')}
      </div>
      <button type="button" class="ms-ayuda-cerrar">Nada por ahora, gracias</button>`;
    panel.querySelectorAll('.ms-ayuda-op').forEach(b => { b.onclick = () => pintarRespuesta(PREGUNTAS[Number(b.dataset.i)]); });
    panel.querySelector('.ms-ayuda-cerrar').onclick = cerrarAyuda;
    panel.querySelector('.ms-ayuda-op').focus();
  }
  function pintarRespuesta(q) {
    if (!panel) return;
    const r = q.cargar ? q.cargar() : {};
    const texto = r.texto ?? q.texto, pasos = r.pasos ?? q.pasos, acciones = r.acciones ?? q.acciones ?? [];
    panel.innerHTML = `
      <div class="ms-ayuda-cab ms-ayuda-cab-resp">
        <button type="button" class="ms-ayuda-volver" aria-label="Volver a las preguntas"><i class="ti ti-arrow-left"></i></button>
        <strong class="ms-ayuda-titulo">${esc(q.pregunta)}</strong>
      </div>
      <div class="ms-ayuda-resp">
        ${texto ? `<p>${esc(texto)}</p>` : ''}
        ${pasos ? `<ol class="ms-ayuda-pasos">${pasos.map(p => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
        <div class="ms-ayuda-acciones">
          ${acciones.map((a, i) => `<button type="button" class="ms-ayuda-accion" data-i="${i}"><i class="ti ${a.icono || 'ti-arrow-right'}" aria-hidden="true"></i> ${esc(a.texto)}</button>`).join('')}
          <button type="button" class="ms-ayuda-otra">Otra pregunta</button>
        </div>
      </div>`;
    panel.querySelector('.ms-ayuda-volver').onclick = pintarMenu;
    panel.querySelectorAll('.ms-ayuda-accion').forEach(b => { b.onclick = () => { const a = acciones[Number(b.dataset.i)]; cerrarAyuda(); a.hacer(); }; });
    panel.querySelector('.ms-ayuda-otra').onclick = pintarMenu;
    (panel.querySelector('.ms-ayuda-accion') || panel.querySelector('.ms-ayuda-otra')).focus();
  }
  M.alTocarEsquina = abrirAyuda;

  /* ─────────────── Que no tape nada: si hay un botón o campo debajo, se asoma desde el borde ─────────────── */
  function vigilarDebajo() {
    const esq = M.esquina && M.esquina();
    if (!esq) return;
    const INTERACTIVO = 'button, a, input, select, textarea, label, [role="button"], [data-toggle-pedido]';
    let pendiente = false;
    const revisar = () => {
      pendiente = false;
      if (esq.classList.contains('ms-oculto') || esq.style.visibility === 'hidden') return;
      if (esq.classList.contains('hablando') || panel || esq.matches(':hover, :focus-visible')) { esq.classList.remove('ms-asomado'); return; }
      // Su lugar normal (sin el desplazamiento de "asomado"), para no parpadear
      const cs = getComputedStyle(esq), w = esq.offsetWidth, h = esq.offsetHeight;
      // (clientWidth/Height: sin la barra de desplazamiento)
      const vw = document.documentElement.clientWidth, vh = document.documentElement.clientHeight;
      const r = { left: vw - parseFloat(cs.right) - w + 4, top: vh - parseFloat(cs.bottom) - h + 4, right: vw - parseFloat(cs.right) - 4, bottom: vh - parseFloat(cs.bottom) - 4 };
      const tapa = [...document.querySelectorAll(INTERACTIVO)].some(el => {
        if (esq.contains(el) || el.closest('.ms-ayuda, .ms-dlg-overlay')) return false;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || b.bottom < r.top || b.top > r.bottom || b.right < r.left || b.left > r.right) return false;
        // Solo si de verdad se ve ahí (no tapado por una ventana ni recortado)
        const x = Math.max(b.left, r.left) + 1, y = Math.max(b.top, r.top) + 1;
        return document.elementsFromPoint(x, y).some(e => e === el || el.contains(e));
      });
      esq.classList.toggle('ms-asomado', tapa);
    };
    const programar = () => { if (!pendiente) { pendiente = true; requestAnimationFrame(revisar); } };
    addEventListener('scroll', programar, { passive: true, capture: true });
    addEventListener('resize', programar);
    new MutationObserver(programar).observe(document.getElementById('lista-pedidos') || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden'] });
    esq.addEventListener('mouseenter', () => esq.classList.remove('ms-asomado'));
    esq.addEventListener('mouseleave', programar);
    new MutationObserver(programar).observe(esq, { attributes: true, attributeFilter: ['class'] });
    setInterval(programar, 1500);
    programar();
  }

  /* ─────────────── Arranque: en el login la mascota de la esquina no aparece (ya está la del login) ─────────────── */
  function vigilarPantalla() {
    const esq = M.esquina && M.esquina();
    const login = document.getElementById('pantalla-login');
    if (!esq || !login) return;
    let saludoPendiente = true;
    const revisar = () => {
      const oculto = enLogin();
      esq.classList.toggle('ms-oculto', oculto);
      if (oculto) { cerrarAyuda(); saludoPendiente = true; return; }
      if (saludoPendiente) {
        saludoPendiente = false;
        // Espera a que el listado termine de cargar para contar los pendientes
        let intentos = 0;
        const esperar = () => {
          if (typeof pedidosCache !== 'undefined' && (pedidosCache.length || intentos > 20)) return setTimeout(saludar, 700);
          intentos++; setTimeout(esperar, 300);
        };
        esperar();
      }
    };
    new MutationObserver(revisar).observe(login, { attributes: true, attributeFilter: ['class'] });
    vigilarDebajo();
    revisar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(vigilarPantalla, 0));
  else vigilarPantalla();
})();
