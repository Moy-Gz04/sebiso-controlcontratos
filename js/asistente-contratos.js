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
  // Preferencias del usuario (encendido y color); las pinta preferencias más abajo
  let pref = { activo: true, color: null, estrella: 'guinda', ropa: 'ninguna', gafas: 'ninguno' };
  const encendido = () => pref.activo !== false;

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
    if (!encendido() && !op) return peticionOriginal(ruta, opciones);
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
    if (esError && !enLogin() && encendido() && M.decir(texto, { duracion: 7000 })) {
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
      if (enLogin() || !encendido()) return confirmarOriginal.apply(this, arguments);
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
    if (!encendido() || enLogin()) return;
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

  /* ─────────────── Lo acompaña en cada ventana de edición ─────────────── */
  const TEXTO_VENTANA = {
    'editar-todo': 'Corrige lo que haga falta. Si algo no cuadra, no se guarda nada y te digo qué revisar.',
    'factura-nueva': 'Captura los datos tal como vienen en la factura y adjunta su PDF.',
    factura: 'Registra la factura de este contrarrecibo; después sigue su camino normal.',
    entrega: 'Pon la fecha en que se entregó y, si lo tienes, el documento de entrega.',
    contabilidad: 'Captura el oficio con el que turnas la factura a contabilidad.',
    contrarecibo: 'Captura el contrarrecibo tal como lo entregó contabilidad.',
    'inicio-pago': 'Registra el comprobante con el que inicia el pago.',
    pagado: 'Pon la fecha en que quedó pagada la factura.',
    'corregir-factura': 'Corrige los datos de la factura; respeto el monto autorizado.',
    'oficio-contabilidad': 'Completa el oficio de contabilidad que faltaba.',
    'modal-nuevo-pedido': '¡Vamos a registrar un contrato! Empieza por el producto y el monto.',
    'modal-editar-pedido': 'Actualiza los datos generales del contrato.'
  };
  function textoDeVentana(fondo) {
    if (TEXTO_VENTANA[fondo.id]) return TEXTO_VENTANA[fondo.id];
    const f = fondo.querySelector('form');
    if (!f) return null;
    if (f.classList.contains('form-editar-todo')) return TEXTO_VENTANA['editar-todo'];
    return TEXTO_VENTANA[f.dataset.ruta || f.dataset.accion] || '¡Te ayudo con esta ventana!';
  }
  function acompanarVentanas() {
    if (!M.ayudarEditar) return;
    const acompanar = (fondo) => {
      if (fondo.id === 'modal-confirmar-accion' || enLogin() || !encendido()) return;
      const texto = textoDeVentana(fondo);
      if (texto) setTimeout(() => { if (fondo.isConnected && fondo.classList.contains('activo')) M.ayudarEditar(fondo, { texto }); }, 30);
    };
    // Ventanas de las facturas (se arman al vuelo) y las fijas (nuevo / editar contrato)
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.classList && n.classList.contains('modal-cr-fondo')) acompanar(n); })))
      .observe(document.body, { childList: true });
    document.querySelectorAll('.modal-fondo[id]').forEach(fondo => {
      new MutationObserver(() => { if (fondo.classList.contains('activo')) acompanar(fondo); })
        .observe(fondo, { attributes: true, attributeFilter: ['class'] });
    });
    // Si falta un dato al guardar, salta hasta el campo y lo pide
    let yaSenalo = 0;
    document.addEventListener('invalid', (e) => {
      if (!M.ayudando || !M.ayudando() || Date.now() - yaSenalo < 600) return;
      yaSenalo = Date.now();
      const campo = e.target, etiqueta = etiquetaDe(campo);
      const texto = campo.validity.valueMissing ? `Falta ${etiqueta ? '«' + etiqueta + '»' : 'este dato'}.` : (campo.validationMessage || 'Revisa este dato.');
      // Lo dice desde su lugar junto a la ventana (sin taparla) y marca el campo; sustituye el globito del navegador
      if (!M.comentar(texto, { alerta: true })) return;
      e.preventDefault();
      campo.classList.add('ms-campo-senalado');
      campo.focus();
      const quitar = () => { campo.classList.remove('ms-campo-senalado'); if (M.ayudando()) M.comentar('¡Perfecto! Sigue con los demás datos.'); };
      campo.addEventListener('input', quitar, { once: true });
      campo.addEventListener('change', quitar, { once: true });
    }, true);
  }
  function etiquetaDe(el) {
    const l = el.closest('label');
    const t = l ? [...l.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ') : (el.getAttribute('aria-label') || el.placeholder || '');
    return t.replace(/\s+/g, ' ').trim();
  }

  /* ─────────────── Cerrar sesión: lo pregunta y se despide ─────────────── */
  function prepararSalida() {
    document.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-cerrar-sesion]');
      if (!btn || btn.dataset.msOk || !encendido()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const nombre = nombreUsuario();
      const h = new Date().getHours();
      const ok = await M.preguntar({
        titulo: 'Cerrar sesión', pregunta: `¿Quieres salir del sistema${nombre ? ', ' + nombre : ''}?`,
        detalle: op ? 'Todavía estoy guardando algo: espera a que termine antes de salir.' : 'Lo que ya guardaste queda a salvo.',
        btnOk: 'Sí, salir', iconoOk: 'ti-logout', estiloOk: 'dorado', btnCancel: 'Quedarme',
        saludoOk: '¡Hasta pronto!', textoOk: h < 12 ? 'Que tengas un excelente día.' : h < 19 ? 'Que tengas una excelente tarde.' : 'Que descanses.',
        saludoCancel: '¡Qué bien!', textoCancel: 'Sigo aquí para ayudarte.'
      });
      if (!ok) return;
      try { sessionStorage.removeItem('msc_saludo_' + nombre); } catch (err) { /* sin storage */ }
      btn.dataset.msOk = '1'; btn.click(); delete btn.dataset.msOk;
    }, true);
  }

  /* ─────────────── Antes de guardar: muestra lo que se va a guardar y pide confirmación ─────────────── */
  const FORMULARIOS = '.form-paso-pedido, .form-avance-cr, .form-editar-todo, #form-nuevo-pedido, #form-editar-pedido';
  function resumenFormulario(form) {
    const lineas = [];
    form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
      if (el.type === 'hidden' || el.disabled || el.closest('[hidden]')) return;
      if (el.type === 'file') { if (el.files[0]) lineas.push('Documento: ' + el.files[0].name); return; }
      if (el.type === 'checkbox' || el.type === 'radio') return;
      let v = el.tagName === 'SELECT' ? (el.selectedOptions[0] ? el.selectedOptions[0].textContent : '') : el.value.trim();
      if (!v) return;
      if (el.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = v.split('-').reverse().join('/');
      if (el.dataset.moneda !== undefined && typeof numMonto === 'function' && !isNaN(numMonto(v))) v = dinero(numMonto(v));
      lineas.push((etiquetaDe(el) || el.name) + ': ' + v);
    });
    return lineas;
  }
  function tituloFormulario(form) {
    const t = form.querySelector('.fi-oficio-titulo') || form.closest('.panel-paso-actual')?.querySelector('.ppa-titulo') || form.closest('.modal-caja')?.querySelector('h2, h3, .modal-titulo');
    return t ? t.textContent.replace(/\s*Opcional\s*$/, '').trim() : 'estos datos';
  }
  // Los montos fuera de rango los avisa la validación normal: no se pregunta antes
  const montosValidos = (form) => [...form.querySelectorAll('input[data-moneda]')].every(el => {
    if (el.value === '' || typeof numMonto !== 'function') return true;
    const n = numMonto(el.value);
    return !isNaN(n) && !(el.dataset.min !== undefined && n < Number(el.dataset.min) - 1e-9) && !(el.dataset.max && n > Number(el.dataset.max) + 1e-9);
  });
  function confirmarGuardados() {
    document.addEventListener('submit', async (e) => {
      const form = e.target;
      if (!form.matches || !form.matches(FORMULARIOS) || form.dataset.msConfirmado || !encendido()) return;
      e.preventDefault(); e.stopImmediatePropagation();
      const seguir = () => { form.dataset.msConfirmado = '1'; try { form.requestSubmit(); } finally { delete form.dataset.msConfirmado; } };
      if (!form.checkValidity() || !montosValidos(form)) { seguir(); return; }   // que la validación normal lo marque
      const boton = form.querySelector('button[type="submit"]');
      const accion = boton ? boton.textContent.trim() : 'Guardar';
      const lineas = resumenFormulario(form);
      const editar = form.classList.contains('form-editar-todo');
      const ok = await M.preguntar({
        titulo: 'Antes de guardar', pregunta: `¿${accion.replace(/^\w/, c => c.toUpperCase())}?`,
        detalle: editar ? 'Se guardarán todos los cambios que hiciste en el contrato.' : `${tituloFormulario(form)}${lineas.length ? '\n' + lineas.slice(0, 7).join('\n') + (lineas.length > 7 ? '\n…' : '') : ''}`,
        btnOk: 'Sí, guardar', iconoOk: 'ti-device-floppy', estiloOk: 'verde', btnCancel: 'Revisar',
        saludoOk: '¡Va!', textoOk: 'Lo guardo ahora mismo…', saludoCancel: '¡Claro!', textoCancel: 'Revísalo con calma.'
      });
      if (ok && form.isConnected) seguir();
    }, true);
  }

  /* ─────────────── Preferencias por usuario: encender/apagar y color ─────────────── */
  let refrescarPantalla = () => {};
  const COLORES = [
    { nombre: 'Dorado', color: null, muestra: '#E6CB93' },
    { nombre: 'Perla', color: '#DCE2EC' },
    { nombre: 'Rosa', color: '#F2B8C6' },
    { nombre: 'Guinda', color: '#B0475F' },
    { nombre: 'Durazno', color: '#F5B98E' },
    { nombre: 'Menta', color: '#A8DCC2' },
    { nombre: 'Cielo', color: '#A9CBEF' },
    { nombre: 'Lavanda', color: '#C7B6EA' },
    { nombre: 'Carbón', color: '#6E6A72' },
    { nombre: 'Galaxia', color: 'galaxia', muestra: 'radial-gradient(circle at 30% 30%, #fff 0 4%, transparent 6%), radial-gradient(circle at 70% 60%, #fff 0 3%, transparent 5%), radial-gradient(ellipse at 30% 30%, #7B5CF0, transparent 60%), radial-gradient(ellipse at 75% 75%, #E0559F, transparent 60%), #1B1347' }
  ];
  const clavePref = () => 'msc_pref_' + ((typeof Store !== 'undefined' && Store.usuarioActual && Store.usuarioActual()) || '');
  const PREF_BASE = { activo: true, color: null, estrella: 'guinda', ropa: 'ninguna', gafas: 'ninguno' };
  const ESTRELLAS = [{ clave: 'guinda', nombre: 'Guinda', muestra: '#9C2647' }, { clave: 'dorada', nombre: 'Dorada', muestra: '#D8B866' }];
  // Cada prenda se dibuja con dos capas (a y b) sobre el cuerpo: posición, tamaño, recorte y relleno
  const GUINDA = '#7A1E35', GUINDA_OSC = '#5A0F24', ORO = '#D8B866';
  const ROPAS = {
    ninguna: { nombre: 'Ninguna', icono: 'ti-circle-off' },
    mono: { nombre: 'Moño', icono: 'ti-ribbon-health', a: { x: '33%', y: '71%', w: '34%', h: '15%',
      bg: `radial-gradient(circle at 50% 50%, ${GUINDA_OSC} 0 15%, ${GUINDA} 16% 100%)`, clip: 'polygon(0 0, 50% 36%, 100% 0, 100% 100%, 50% 64%, 0 100%)' } },
    corbata: { nombre: 'Corbata', icono: 'ti-tie', a: { x: '40.5%', y: '66%', w: '19%', h: '40%',
      bg: `repeating-linear-gradient(135deg, transparent 0 5px, rgba(216, 184, 102, .55) 5px 7px), linear-gradient(180deg, ${GUINDA_OSC} 0 16%, ${GUINDA} 16% 100%)`,
      clip: 'polygon(22% 0, 78% 0, 68% 16%, 100% 80%, 50% 100%, 0 80%, 32% 16%)' } },
    bufanda: { nombre: 'Bufanda', icono: 'ti-wind',
      a: { x: '-5%', y: '70%', w: '110%', h: '16%', r: '45% / 50%', bg: `repeating-linear-gradient(90deg, ${GUINDA} 0 12px, ${ORO} 12px 17px)` },
      b: { x: '18%', y: '76%', w: '15%', h: '36%', r: '3px 3px 7px 7px', bg: `repeating-linear-gradient(180deg, ${GUINDA} 0 9px, ${ORO} 9px 13px)` } },
    saco: { nombre: 'Saco', icono: 'ti-shirt',
      b: { x: '0', y: '64%', w: '100%', h: '36%', r: '0 0 30% 30% / 0 0 45% 45%',
        bg: `linear-gradient(180deg, ${GUINDA} 0%, ${GUINDA_OSC} 100%)`, clip: 'polygon(0 0, 36% 0, 50% 55%, 64% 0, 100% 0, 100% 100%, 0 100%)' },
      a: { x: '47%', y: '80%', w: '6%', h: '14%', bg: `radial-gradient(circle at 50% 22%, ${ORO} 0 32%, transparent 34%), radial-gradient(circle at 50% 78%, ${ORO} 0 32%, transparent 34%)` } }
  };
  // Lentes: dos micas sobre los ojos (forma, marco y relleno por variables)
  const GAFAS = {
    ninguno: { nombre: 'Ninguno', icono: 'ti-circle-off' },
    redondos: { nombre: 'Redondos', icono: 'ti-eyeglass', v: { borde: '2px solid #2A2228', radio: '50%', fondo: 'rgba(255,255,255,.12)', marco: '#2A2228' } },
    cuadrados: { nombre: 'Cuadrados', icono: 'ti-eyeglass-2', v: { borde: '3px solid #1C1A1D', radio: '18%', fondo: 'rgba(255,255,255,.1)', marco: '#1C1A1D', w: '23.5%', h: '30%', top: '32%' } },
    sol: { nombre: 'De sol', icono: 'ti-sunglasses', v: { borde: '2px solid #111', radio: '28% 28% 46% 46%', fondo: 'linear-gradient(160deg, #5A5866 0%, #17161C 55%, #000 100%)', marco: '#111', w: '23.5%', h: '31%', top: '31%' } },
    corazon: { nombre: 'Corazón', icono: 'ti-heart', v: { borde: '0', radio: '0', fondo: 'linear-gradient(160deg, rgba(255,130,175,.9), rgba(200,30,90,.85))', marco: '#B0175A', clip: 'polygon(50% 100%, 6% 52%, 0 30%, 8% 8%, 28% 0, 50% 16%, 72% 0, 92% 8%, 100% 30%, 94% 52%)', w: '23.5%', h: '30%', top: '31%' } },
    gato: { nombre: 'Ojo de gato', icono: 'ti-cat', v: { borde: '2px solid #4A0A1D', bordeArriba: '4px solid #4A0A1D', radio: '62% 62% 46% 46% / 72% 72% 42% 42%', fondo: 'rgba(255,255,255,.08)', marco: '#4A0A1D', rotIzq: '-10deg', rotDer: '10deg' } },
    dorados: { nombre: 'Dorados', icono: 'ti-eyeglass', v: { borde: '2px solid #B8922F', radio: '50%', fondo: 'rgba(255,240,200,.15)', marco: '#B8922F' } }
  };
  const GALAXIA = {
    fondo: 'radial-gradient(circle at 22% 30%, #fff 0 1.2%, transparent 1.8%), radial-gradient(circle at 70% 22%, #fff 0 1%, transparent 1.6%), radial-gradient(circle at 82% 62%, #fff 0 1.3%, transparent 2%), radial-gradient(circle at 35% 78%, #fff 0 .9%, transparent 1.5%), radial-gradient(circle at 55% 48%, rgba(255,255,255,.8) 0 .7%, transparent 1.2%), radial-gradient(circle at 12% 62%, rgba(255,255,255,.85) 0 .8%, transparent 1.4%), radial-gradient(ellipse 60% 45% at 28% 25%, rgba(123, 92, 240, .95), transparent 70%), radial-gradient(ellipse 55% 50% at 78% 78%, rgba(224, 85, 159, .85), transparent 70%), radial-gradient(ellipse 40% 35% at 70% 30%, rgba(80, 180, 255, .55), transparent 70%), linear-gradient(160deg, #241A5C 0%, #1B1347 45%, #0C0A24 100%)',
    sombra: 'inset 0 -7px 12px rgba(10, 5, 40, .6), inset 0 4px 8px rgba(200, 180, 255, .45), 0 0 0 1px rgba(150, 120, 255, .6), 0 0 18px rgba(140, 100, 255, .55), 0 8px 18px rgba(20, 5, 50, .45)',
    ojo: 'radial-gradient(ellipse 60% 55% at 45% 40%, #FFFFFF 0%, #E4E8FF 70%, #B9C2FF 100%)'
  };
  function aplicarApariencia(el, { color, estrella, ropa, gafas } = {}) {
    if (color) { el.style.setProperty('--ms-color', color === 'galaxia' ? '#5B47C8' : color); el.setAttribute('data-ms-color', ''); }
    else { el.style.removeProperty('--ms-color'); el.removeAttribute('data-ms-color'); }
    // 'initial' deja la variable vacía: así la vista previa no hereda la galaxia de la página
    const gal = color === 'galaxia';
    el.style.setProperty('--ms-fondo', gal ? GALAXIA.fondo : 'initial');
    el.style.setProperty('--ms-sombra', gal ? GALAXIA.sombra : 'initial');
    el.style.setProperty('--ms-ojo-fondo', gal ? GALAXIA.ojo : 'initial');
    el.style.setProperty('--ms-brillos', gal ? 'block' : 'none');
    el.style.setProperty('--ms-ojo-dormido', gal ? `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 18'%3E%3Cpath d='M2.5 5 Q12 16 21.5 5' fill='none' stroke='%23F2EEFF' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E")` : 'initial');
    const g = (GAFAS[gafas] || GAFAS.ninguno).v;
    el.style.setProperty('--gafas', g ? 'block' : 'none');
    // Con lentes elegidos, el ayudante de las ventanas de edición deja sus lentes de lectura
    el.style.setProperty('--lentes-lectura', g ? 'none' : 'initial');
    el.style.setProperty('--ojo-izq-lectura', g ? '32.5%' : 'initial');
    el.style.setProperty('--ojo-der-lectura', g ? '57.3%' : 'initial');
    [['borde', 'g-borde'], ['bordeArriba', 'g-borde-arriba'], ['radio', 'g-radio'], ['fondo', 'g-fondo'], ['marco', 'g-marco'], ['clip', 'g-clip'],
     ['w', 'g-w'], ['h', 'g-h'], ['top', 'g-top'], ['rotIzq', 'g-rot-izq'], ['rotDer', 'g-rot-der']].forEach(([k, v]) => {
      el.style.setProperty('--' + v, g && g[k] ? g[k] : 'initial');
    });
    el.style.setProperty('--ms-oro', estrella === 'dorada' ? '1' : '0');
    const r = ROPAS[ropa] || ROPAS.ninguna;
    ['a', 'b'].forEach(k => {
      const c = r[k];
      el.style.setProperty(`--ropa-${k}`, c ? 'block' : 'none');
      [['x', 'x'], ['y', 'y'], ['w', 'w'], ['h', 'h'], ['bg', 'bg'], ['clip', 'clip'], ['r', 'r'], ['sombra', 'sombra']].forEach(([p, v]) => {
        if (c && c[v]) el.style.setProperty(`--ropa-${k}-${p}`, c[v]); else el.style.removeProperty(`--ropa-${k}-${p}`);
      });
    });
  }
  function pintarColor(color) { aplicarApariencia(document.documentElement, color === null ? {} : { color: pref.color, estrella: pref.estrella, ropa: pref.ropa, gafas: pref.gafas }); }

  // Cada mascota (esquina, diálogos, ventanas, vista previa) lleva sus lentes y sus brillitos, ocultos hasta que se eligen
  function equipar(raiz) {
    (raiz.matches && raiz.matches('.minisebiso') ? [raiz] : []).concat([...(raiz.querySelectorAll ? raiz.querySelectorAll('.minisebiso') : [])]).forEach(m => {
      const cuerpo = m.querySelector('.ms-cuerpo');
      if (cuerpo && !cuerpo.querySelector('.ms-gafas')) cuerpo.insertAdjacentHTML('beforeend', '<span class="ms-gafas" aria-hidden="true"><i></i><i></i></span>');
      if (!m.querySelector('.ms-brillos')) m.insertAdjacentHTML('beforeend', '<span class="ms-brillos" aria-hidden="true">' + '<i></i>'.repeat(7) + '</span>');
    });
  }
  equipar(document.body);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) equipar(n); }))).observe(document.body, { childList: true, subtree: true });

  function aplicarPref() {
    pintarColor(enLogin() ? null : true);
    const t = document.querySelector('.nav-asistente');
    if (t) {
      t.setAttribute('aria-pressed', encendido() ? 'true' : 'false');
      t.title = encendido() ? 'Asistente encendido: toca para apagarlo' : 'Asistente apagado: toca para encenderlo';
    }
    if (!encendido()) { cerrarAyuda(); M.callar && M.callar(); }
    refrescarPantalla();
  }
  async function cargarPref() {
    try { const c = JSON.parse(localStorage.getItem(clavePref()) || 'null'); if (c) { pref = { ...PREF_BASE, ...c }; aplicarPref(); } } catch (e) { /* sin storage */ }
    try {
      const d = await peticionOriginal('/preferencias');
      pref = { ...PREF_BASE, ...(d.asistente || {}) };
      try { localStorage.setItem(clavePref(), JSON.stringify(pref)); } catch (e) { /* sin storage */ }
      aplicarPref();
    } catch (e) { /* sin conexión: se queda con lo guardado en este equipo */ }
  }
  async function guardarPref(cambios) {
    pref = { ...pref, ...cambios };
    try { localStorage.setItem(clavePref(), JSON.stringify(pref)); } catch (e) { /* sin storage */ }
    aplicarPref();
    try { await peticionOriginal('/preferencias', { method: 'PUT', body: JSON.stringify({ asistente: cambios }) }); }
    catch (e) { avisoOriginal('Se aplicó en este equipo, pero no se pudo guardar en tu usuario: ' + e.message, true); }
  }

  function prepararBotonesEncabezado() {
    const salir = document.querySelector('.navbar-top-right [data-cerrar-sesion]');
    if (!salir || document.querySelector('.nav-asistente')) return;
    const grupo = document.createElement('div');
    grupo.className = 'nav-asis-grupo';
    grupo.innerHTML = `
      <button type="button" class="nav-asistente" aria-pressed="true">
        <span class="nav-asis-switch" aria-hidden="true"><span></span></span>
        <span class="nav-asis-texto">Asistente</span>
      </button>
      <button type="button" class="nav-asis-color" aria-label="Personalizar el color del asistente" title="Personalizar el asistente"><i class="ti ti-pencil" aria-hidden="true"></i></button>`;
    salir.parentNode.insertBefore(grupo, salir);
    grupo.querySelector('.nav-asistente').addEventListener('click', async () => {
      const prender = !encendido();
      await guardarPref({ activo: prender });
      if (prender) setTimeout(() => M.decir('¡Aquí estoy de nuevo! Tócame cuando necesites ayuda.', { duracion: 4500 }), 150);
      else avisoOriginal('Asistente apagado. Puedes encenderlo cuando quieras.');
    });
    grupo.querySelector('.nav-asis-color').addEventListener('click', abrirPersonalizar);
    aplicarPref();
  }

  // Ventana para personalizar: vista previa en vivo con color, estrella y ropa
  function abrirPersonalizar() {
    if (document.querySelector('.ms-perso')) return;
    const elegido = { color: pref.color, estrella: pref.estrella || 'guinda', ropa: pref.ropa || 'ninguna', gafas: pref.gafas || 'ninguno' };
    const inicial = { ...elegido, color: elegido.color || null };
    const opcion = (grupo, valor, texto, extra = '') => `<button type="button" class="ms-perso-op" role="radio" data-grupo="${grupo}" data-valor="${valor}" ${extra}><span>${texto}</span></button>`;
    const fondo = document.createElement('div');
    fondo.className = 'ms-dlg-overlay ms-perso';
    fondo.innerHTML = `
      <div class="ms-perso-caja" role="dialog" aria-modal="true" aria-labelledby="ms-perso-titulo">
        <button type="button" class="ms-perso-cerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>
        <div class="ms-perso-vista">
          <div class="minisebiso ms-perso-mascota" aria-hidden="true">${mascotaHTML()}</div>
        </div>
        <div class="ms-perso-cuerpo">
          <span class="ms-dlg-saludo">Personaliza a tu asistente</span>
          <h2 id="ms-perso-titulo" class="ms-perso-titulo">¿Cómo me quieres?</h2>
          <p class="ms-perso-ayuda">Se guarda en tu usuario: me verás así en cualquier equipo donde entres.</p>
          <div class="ms-perso-seccion">Color</div>
          <div class="ms-perso-colores" role="radiogroup" aria-label="Color">
            ${COLORES.map((c, i) => `<button type="button" class="ms-perso-color" role="radio" data-i="${i}" style="--c:${c.muestra || c.color}" aria-label="${c.nombre}"><span>${c.nombre}</span></button>`).join('')}
            <label class="ms-perso-color ms-perso-libre" title="Elige cualquier color">
              <input type="color" value="${/^#/.test(elegido.color || '') ? elegido.color : '#E6CB93'}" aria-label="Otro color"><span>Otro</span>
            </label>
          </div>
          <div class="ms-perso-seccion">Estrella</div>
          <div class="ms-perso-ops" role="radiogroup" aria-label="Estrella">
            ${ESTRELLAS.map(e => opcion('estrella', e.clave, e.nombre, `style="--c:${e.muestra}"`)).join('')}
          </div>
          <div class="ms-perso-seccion">Lentes</div>
          <div class="ms-perso-ops" role="radiogroup" aria-label="Lentes">
            ${Object.entries(GAFAS).map(([k, g]) => opcion('gafas', k, `<i class="ti ${g.icono}" aria-hidden="true"></i> ${g.nombre}`)).join('')}
          </div>
          <div class="ms-perso-seccion">Ropa</div>
          <div class="ms-perso-ops" role="radiogroup" aria-label="Ropa">
            ${Object.entries(ROPAS).map(([k, r]) => opcion('ropa', k, `<i class="ti ${r.icono}" aria-hidden="true"></i> ${r.nombre}`)).join('')}
          </div>
          <div class="ms-dlg-botones">
            <button type="button" class="ms-dlg-btn ms-dlg-cancelar" data-perso="cancelar">Cancelar</button>
            <button type="button" class="ms-dlg-btn ms-dlg-ok ms-dlg-ok-dorado" data-perso="guardar"><i class="ti ti-device-floppy"></i> Guardar</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(fondo);
    requestAnimationFrame(() => fondo.classList.add('visible'));
    const vista = fondo.querySelector('.ms-perso-vista');
    const mascota = fondo.querySelector('.ms-perso-mascota');
    const libre = fondo.querySelector('input[type="color"]');
    const marcar = () => {
      aplicarApariencia(vista, { color: elegido.color || '#E6CB93', estrella: elegido.estrella, ropa: elegido.ropa, gafas: elegido.gafas });
      if (!elegido.color) vista.removeAttribute('data-ms-color');
      fondo.querySelectorAll('.ms-perso-color[data-i]').forEach(b => {
        const c = COLORES[Number(b.dataset.i)].color;
        b.setAttribute('aria-checked', String((c || null) === (elegido.color || null)));
      });
      const esLibre = !!elegido.color && !COLORES.some(c => c.color && c.color.toLowerCase() === elegido.color.toLowerCase());
      const lb = fondo.querySelector('.ms-perso-libre');
      lb.classList.toggle('activo', esLibre);
      if (esLibre) lb.style.setProperty('--c', elegido.color);
      fondo.querySelectorAll('.ms-perso-op').forEach(b => b.setAttribute('aria-checked', String(elegido[b.dataset.grupo] === b.dataset.valor)));
    };
    const brincar = () => { if (!quieto) mascota.animate([{ transform: 'none' }, { transform: 'translateY(-14px) scale(1.04, .96)', offset: .4 }, { transform: 'none' }], { duration: 380, easing: 'ease-out' }); };
    fondo.querySelectorAll('.ms-perso-color[data-i]').forEach(b => b.addEventListener('click', () => { elegido.color = COLORES[Number(b.dataset.i)].color; marcar(); brincar(); }));
    fondo.querySelectorAll('.ms-perso-op').forEach(b => b.addEventListener('click', () => { elegido[b.dataset.grupo] = b.dataset.valor; marcar(); brincar(); }));
    libre.addEventListener('input', () => { elegido.color = libre.value; marcar(); });
    libre.addEventListener('change', brincar);
    const cerrar = () => { fondo.classList.remove('visible'); setTimeout(() => fondo.remove(), 220); document.removeEventListener('keydown', tecla); };
    const tecla = (e) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', tecla);
    fondo.addEventListener('mousedown', (e) => { if (e.target === fondo) cerrar(); });
    fondo.querySelector('.ms-perso-cerrar').onclick = cerrar;
    fondo.querySelector('[data-perso="cancelar"]').onclick = cerrar;
    fondo.querySelector('[data-perso="guardar"]').onclick = async () => {
      cerrar();
      // Solo lo que cambió en esta ventana (así no se pisa con algo viejo guardado en el equipo)
      const nuevo = { color: elegido.color || null, estrella: elegido.estrella, ropa: elegido.ropa, gafas: elegido.gafas };
      const cambios = Object.fromEntries(Object.entries(nuevo).filter(([k, v]) => v !== inicial[k]));
      if (Object.keys(cambios).length) await guardarPref(cambios);
      if (encendido()) setTimeout(() => M.decir('¡Me encanta cómo me veo!', { duracion: 3500 }), 250);
      else avisoOriginal('Apariencia guardada.');
    };
    marcar();
    fondo.querySelector('.ms-perso-color[aria-checked="true"], .ms-perso-libre').focus();
  }

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
      const oculto = enLogin() || !encendido();
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
    refrescarPantalla = revisar;
    // Al entrar se cargan las preferencias de ese usuario; al salir, la mascota vuelve a su color de siempre
    let dentro = null;
    const cambioPantalla = () => {
      const ahora = !enLogin();
      if (ahora !== dentro) {
        dentro = ahora;
        if (ahora) cargarPref();
        else { pref = { ...PREF_BASE }; aplicarPref(); }
      }
      revisar();
    };
    new MutationObserver(cambioPantalla).observe(login, { attributes: true, attributeFilter: ['class'] });
    prepararBotonesEncabezado();
    cambioPantalla();
    vigilarDebajo();
    acompanarVentanas();
    prepararSalida();
    confirmarGuardados();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(vigilarPantalla, 0));
  else vigilarPantalla();
})();
