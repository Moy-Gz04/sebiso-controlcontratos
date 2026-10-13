/* =========================================================================
   Carga al despertar el sistema (igual que en Programas)
   El servidor (Render) se duerme cuando nadie lo usa y tarda en responder la
   primera vez. Este script:
   - Lo despierta en cuanto se abre la página (una petición silenciosa), para
     que mientras la persona escribe su usuario el servidor ya vaya arrancando.
   - Si una consulta o el inicio de sesión tardan más de un momento, muestra
     la mascota "trabajando", una barra que avanza sola (sin segundos) y
     mensajes que van cambiando, hasta que llega la respuesta.
   Configuración en la etiqueta <script>:
     data-api       parte de la URL del servidor (p. ej. "onrender.com")
     data-ping      URL a la que se hace la petición silenciosa al abrir
     data-estrella  ruta de la imagen de la estrella de Hidalgo
   No cubre los guardados: esos ya tienen su propia ventana de trabajo.
   ========================================================================= */
(function () {
  const tag = document.currentScript;
  const API = tag?.dataset.api || 'onrender.com';
  const PING = tag?.dataset.ping || '';
  const ESTRELLA = tag?.dataset.estrella || 'img/logo-hidalgo.png';
  const ESPERA = 700;   // ms antes de mostrar la carga (si responde rápido, no aparece)

  const css = document.createElement('style');
  css.textContent = `
  .cd-capa{position:fixed;inset:0;z-index:13000;display:grid;place-items:center;background:rgba(42,10,21,.42);backdrop-filter:blur(3px);opacity:0;transition:opacity .25s;font-family:'Montserrat',system-ui,sans-serif}
  .cd-capa.visible{opacity:1}
  .cd-card{display:flex;flex-direction:column;align-items:center;gap:10px;width:min(340px,calc(100vw - 32px));padding:24px 26px 22px;background:#FBF6EE;border-radius:22px;border:1px solid rgba(169,130,76,.5);box-shadow:0 20px 44px rgba(42,10,21,.35);text-align:center}
  .cd-ms{position:relative;width:96px;aspect-ratio:1024/935;animation:cdRespirar 2.4s ease-in-out infinite;transform-origin:50% 90%}
  .cd-cuerpo{position:absolute;left:12.7%;top:11.6%;width:74.6%;height:74.2%;border-radius:27% 27% 30% 30%/29% 29% 31% 31%;
    background:radial-gradient(ellipse 55% 40% at 30% 18%,#FFF9EC 0%,rgba(255,249,236,0) 70%),linear-gradient(180deg,#FBEFD6 0%,#F2DFB4 40%,#E6CB93 72%,#D4B472 100%);
    box-shadow:inset 0 -7px 12px rgba(168,128,60,.45),inset 0 4px 8px rgba(255,250,238,.95),0 0 0 1px rgba(188,149,92,.55),0 8px 18px rgba(60,10,25,.3)}
  .cd-ojo{position:absolute;top:37%;width:10.2%;height:20.2%;border-radius:50%;background:radial-gradient(ellipse 60% 55% at 45% 40%,#2a2a30 0%,#0d0d10 70%);animation:cdOjos 2.6s ease-in-out infinite}
  .cd-ojo.izq{left:32.5%}.cd-ojo.der{left:57.3%}
  .cd-estrella{position:absolute;left:4.5%;top:2.8%;width:40%;aspect-ratio:1;background:url('${ESTRELLA}') center/contain no-repeat;filter:drop-shadow(0 0 1px #FBEFE6) drop-shadow(1px 3px 3px rgba(0,0,0,.35));animation:cdGiro 3s ease-in-out infinite}
  .cd-titulo{font-weight:700;font-size:15px;color:#3D1420}
  .cd-barra{position:relative;width:100%;height:10px;border-radius:999px;background:#EFE6DA;box-shadow:inset 0 1px 2px rgba(61,20,32,.12);overflow:hidden}
  .cd-barra span{position:absolute;inset:0 auto 0 0;width:0;border-radius:inherit;background:linear-gradient(90deg,#5F2132,#8A2E45 60%,#A9824C);animation:cdAvance 40s cubic-bezier(.08,.75,.25,1) forwards}
  .cd-barra span::after{content:"";position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.45) 50%,transparent 80%);background-size:200% 100%;animation:cdBrillo 1.2s linear infinite}
  .cd-capa.listo .cd-barra span{width:100%!important;animation:none;transition:width .3s}
  .cd-msg{font-size:12.5px;color:#6B5563;min-height:1.4em}
  .cd-msg.entra{animation:cdEntra .35s ease-out}
  @keyframes cdRespirar{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px) scale(1.02,.98)}}
  @keyframes cdOjos{0%,40%,100%{transform:translateX(0)}50%,85%{transform:translateX(3px)}92%{transform:scaleY(.15)}}
  @keyframes cdGiro{0%,100%{transform:rotate(-6deg)}50%{transform:rotate(8deg)}}
  @keyframes cdAvance{0%{width:4%}100%{width:94%}}
  @keyframes cdBrillo{from{background-position:200% 0}to{background-position:-200% 0}}
  @keyframes cdEntra{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){.cd-ms,.cd-ojo,.cd-estrella,.cd-barra span::after{animation:none}.cd-barra span{animation-duration:1ms;width:70%}}`;
  document.head.appendChild(css);

  const MENSAJES = {
    entrar: ['Despertando el servidor…', 'El sistema estaba en reposo, ya casi responde…', 'Preparando tu sesión…', 'Un momento más…'],
    datos: ['Reuniendo la información…', 'Acomodando los registros…', 'Casi listo…'],
  };
  let capa = null, pendientes = 0, mostrarT = null, rotarT = null;

  function abrir(tipo) {
    if (capa) return;
    const msgs = MENSAJES[tipo];
    capa = document.createElement('div');
    capa.className = 'cd-capa';
    capa.setAttribute('role', 'status');
    capa.setAttribute('aria-live', 'polite');
    capa.innerHTML = `<div class="cd-card">
      <div class="cd-ms" aria-hidden="true"><div class="cd-cuerpo"><span class="cd-ojo izq"></span><span class="cd-ojo der"></span></div><div class="cd-estrella"></div></div>
      <div class="cd-titulo">${tipo === 'entrar' ? 'Entrando al sistema…' : 'Cargando…'}</div>
      <div class="cd-barra"><span></span></div>
      <div class="cd-msg">${msgs[0]}</div></div>`;
    document.body.appendChild(capa);
    requestAnimationFrame(() => capa && capa.classList.add('visible'));
    let i = 0;
    const msg = capa.querySelector('.cd-msg');
    rotarT = setInterval(() => { i = (i + 1) % msgs.length; msg.classList.remove('entra'); void msg.offsetWidth; msg.textContent = msgs[i]; msg.classList.add('entra'); }, 2800);
  }
  function cerrar() {
    clearTimeout(mostrarT); mostrarT = null;
    if (!capa) return;
    clearInterval(rotarT);
    const c = capa; capa = null;
    c.classList.add('listo');
    setTimeout(() => { c.classList.remove('visible'); setTimeout(() => c.remove(), 260); }, 280);
  }

  const original = window.fetch.bind(window);
  window.fetch = async function (url, opts = {}) {
    const u = String(url && url.url ? url.url : url);
    const metodo = String(opts.method || (url && url.method) || 'GET').toUpperCase();
    const esLogin = /login|auth/i.test(u);
    if (!u.includes(API) || (metodo !== 'GET' && !esLogin)) return original(url, opts);
    pendientes++;
    if (!mostrarT && !capa) mostrarT = setTimeout(() => { mostrarT = null; if (pendientes) abrir(esLogin ? 'entrar' : 'datos'); }, ESPERA);
    try { return await original(url, opts); }
    finally { if (--pendientes === 0) setTimeout(() => { if (pendientes === 0) cerrar(); }, 300); }
  };

  // Despierta al servidor en cuanto se abre la página (sin mostrar nada)
  if (PING) original(PING, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
})();
