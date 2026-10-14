// =========================================================
// tablero-contratos.js
// Botón con ícono de gráfica a la izquierda del de soporte: abre una
// ventana con el tablero de contratos (mismo diseño que el tablero de
// oficios de Correspondencia):
//   - tarjetas: total de contratos, cuántos hay en cada etapa y el monto vigente;
//   - dona con la proporción de contratos por etapa;
//   - barras de montos (autorizado, facturado, pagado, por facturar) de todos
//     los contratos o del que se elija.
// Los datos son los mismos que ya cargó la página (pedidosCache).
// =========================================================
(function () {
  if (window.__tableroContratos) return;
  window.__tableroContratos = true;

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (n) => Number(n || 0).toLocaleString('es-MX');
  const dinero = (n) => Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

  // Colores por estatus (mismo orden en tarjetas, dona, barras y leyenda)
  const ESTADOS = [
    { k: 'pedido_creado',     t: 'Contrato',        c: '#7B61C9', c2: '#A08BE8' },
    { k: 'oficio_autorizado', t: 'Autorización',    c: '#2C8FC9', c2: '#62B6E6' },
    { k: 'adecuacion',        t: 'Adecuación',      c: '#5B6BD6', c2: '#8E9AF0' },
    { k: 'factura_recibida',  t: 'Facturas',        c: '#E39A2D', c2: '#F5C26B' },
    { k: 'en_contabilidad',   t: 'Contabilidad',    c: '#14A39A', c2: '#4CD1C6' },
    { k: 'en_pago',           t: 'En pago',         c: '#D1405E', c2: '#EE7F95' },
    { k: 'pagado',            t: 'Pagado',          c: '#2E9D5B', c2: '#5FCB8A' },
  ];
  const OTROS = { t: 'Otros', c: '#CDBFB0' };
  const quieto = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const css = document.createElement('style');
  css.textContent = `
    .tab-icono{ display:inline-grid; place-items:center; width:42px; height:42px; padding:0; margin:0 8px 0 0; border-radius:50%;
      border:1.5px solid rgba(188,149,92,.55); background:#fff; color:#3D1420; cursor:pointer;
      box-shadow:0 2px 8px rgba(61,20,32,.12); transition:transform .15s ease, box-shadow .2s ease; }
    .tab-icono svg{ width:21px; height:21px; }
    .tab-icono:hover{ transform:translateY(-1px); box-shadow:0 4px 14px rgba(61,20,32,.2); }
    .tab-icono:focus-visible{ outline:2px solid #D8B866; outline-offset:2px; }

    .tab-fondo{ position:fixed; inset:0; z-index:12500; display:grid; place-items:center; padding:20px;
      background:rgba(42,10,21,.42); backdrop-filter:blur(3px); animation:tabFondo .2s ease-out; }
    @keyframes tabFondo{ from{ opacity:0; } to{ opacity:1; } }
    .tab-ventana{ width:min(1080px, 100%); max-height:calc(100vh - 40px); overflow-y:auto; box-sizing:border-box;
      background:#FFFDF9; border:1px solid #E4D6C8; border-radius:24px; box-shadow:0 30px 70px rgba(42,10,21,.35);
      font-family:'Montserrat',sans-serif; color:#3D1420; animation:tabEntra .24s cubic-bezier(.2,.9,.3,1.1); }
    @keyframes tabEntra{ from{ opacity:0; transform:translateY(14px) scale(.98);} to{ opacity:1; transform:none; } }
    .tab-cab{ position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:16px;
      padding:22px 30px 18px; background:linear-gradient(180deg,#FFFFFF,#FBF6EE); border-bottom:1px solid #E4D6C8; }
    .tab-cab::after{ content:''; position:absolute; left:0; right:0; bottom:-1px; height:3px;
      background:linear-gradient(90deg,#5F2132 0 30%,#A9824C 30% 70%,#5F2132 70% 100%); }
    .tab-tit{ font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color:#7C5D31; }
    .tab-area{ font-size:22px; font-weight:800; color:#3D1420; margin-top:2px; letter-spacing:-.01em; }
    .tab-acc{ display:flex; gap:8px; }
    .tab-btn{ display:inline-grid; place-items:center; width:38px; height:38px; margin:0; padding:0; border-radius:50%; cursor:pointer;
      border:1px solid #E4D6C8; background:#fff; color:#5F2132; font-size:18px; }
    .tab-btn:hover{ background:#F6EEDD; }
    .tab-cuerpo{ padding:24px 30px 30px; display:flex; flex-direction:column; gap:24px; }

    .tab-kpis{ display:grid; grid-template-columns:1.3fr repeat(4,1fr); gap:14px; }
    .tab-kpi{ position:relative; padding:16px 18px; border-radius:16px; overflow:hidden; border:1px solid color-mix(in srgb, var(--c) 22%, #fff);
      background:linear-gradient(145deg, color-mix(in srgb, var(--c) 9%, #fff) 0%, #fff 70%);
      box-shadow:0 2px 8px color-mix(in srgb, var(--c) 10%, transparent); transition:transform .2s ease, box-shadow .2s ease;
      opacity:0; transform:translateY(10px); animation:tabSube .5s cubic-bezier(.2,.9,.3,1) forwards; animation-delay:calc(var(--i) * 60ms); }
    .tab-kpi:hover{ transform:translateY(-3px); box-shadow:0 10px 22px color-mix(in srgb, var(--c) 22%, transparent); }
    @keyframes tabSube{ to{ opacity:1; transform:none; } }
    .tab-kpi::before{ content:''; position:absolute; left:0; top:0; bottom:0; width:5px; background:linear-gradient(180deg, var(--c2), var(--c)); }
    .tab-kpi::after{ content:''; position:absolute; right:-28px; top:-28px; width:90px; height:90px; border-radius:50%; background:radial-gradient(circle, color-mix(in srgb, var(--c) 16%, transparent), transparent 70%); }
    .tab-kpi i{ display:inline-grid; place-items:center; width:34px; height:34px; border-radius:10px; font-size:19px; color:#fff; background:linear-gradient(135deg, var(--c2), var(--c)); box-shadow:0 4px 10px color-mix(in srgb, var(--c) 35%, transparent); }
    .tab-kpi span{ display:block; margin-top:0; font-size:12px; font-weight:600; color:#6B5563; }
    .tab-kpi b{ display:block; margin-top:2px; font-size:30px; font-weight:800; color:#3D1420; font-variant-numeric:tabular-nums; line-height:1.1; }
    .tab-kpi small{ font-size:12px; font-weight:700; color:var(--c); }
    .tab-kpi.total{ grid-row:span 2; display:flex; flex-direction:column; justify-content:center; border-color:transparent; color:#fff;
      background:radial-gradient(circle at 85% 15%, rgba(233,200,115,.35), transparent 45%), linear-gradient(135deg,#7A2A40,#3D1420); }
    .tab-kpi.total::before, .tab-kpi.total::after{ display:none; }
    .tab-kpi.total i{ background:rgba(255,255,255,.14); color:#E9C873; box-shadow:none; width:44px; height:44px; font-size:24px; }
    .tab-kpi.total span{ color:rgba(255,255,255,.85); font-size:13px; } .tab-kpi.total b{ color:#fff; font-size:46px; }
    .tab-kpi.total small{ color:#E9C873; }

    .tab-graficas{ display:grid; grid-template-columns:minmax(260px,340px) 1fr; gap:20px; align-items:stretch; }
    .tab-tarjeta{ padding:20px 22px; border-radius:18px; background:#fff; border:1px solid #EFE4D6; min-width:0; }
    .tab-tarjeta h3{ margin:0 0 14px; font-size:14px; font-weight:700; color:#3D1420; }
    .tab-tarjeta h3 small{ font-weight:500; color:#9A8A90; font-size:12px; margin-left:6px; }
    .tab-dona{ display:flex; flex-direction:column; align-items:center; gap:16px; }
    .tab-dona svg{ width:200px; height:200px; }
    .tab-dona .seg{ transition:opacity .15s, stroke-dasharray 1s cubic-bezier(.2,.9,.3,1); }
    .tab-dona svg:hover .seg{ opacity:.45; } .tab-dona svg .seg:hover{ opacity:1; }
    .tab-leyenda{ display:grid; grid-template-columns:1fr; gap:6px; width:100%; }
    .tab-leyenda div{ display:flex; align-items:center; gap:8px; font-size:12.5px; color:#3D1420; }
    .tab-leyenda i{ width:12px; height:12px; border-radius:4px; background:var(--c); flex-shrink:0; }
    .tab-leyenda b{ margin-left:auto; font-variant-numeric:tabular-nums; }
    .tab-leyenda em{ font-style:normal; color:#9A8A90; font-size:11.5px; width:42px; text-align:right; }

    .tab-barras{ display:flex; flex-direction:column; gap:12px; }
    .tab-fila{ display:grid; grid-template-columns:minmax(120px,190px) 1fr 52px; align-items:center; gap:12px; }
    .tab-fila .nom{ font-size:12.5px; font-weight:600; color:#3D1420; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tab-fila .pista{ display:flex; height:18px; border-radius:999px; background:#F3ECE4; overflow:hidden; }
    .tab-fila .pista i{ display:block; height:100%; width:0; background:linear-gradient(90deg, var(--c), var(--c2, var(--c))); transition:width .9s cubic-bezier(.2,.9,.3,1), filter .15s; }
    .tab-fila .pista i:hover{ filter:brightness(1.12); }
    .tab-fila .tot{ font-size:13px; font-weight:800; text-align:right; font-variant-numeric:tabular-nums; }
    .tab-ley-h{ display:flex; flex-wrap:wrap; gap:14px; margin-top:16px; padding-top:12px; border-top:1px solid #F3ECE4; }
    .tab-ley-h div{ display:flex; align-items:center; gap:6px; font-size:11.5px; color:#6B5563; }
    .tab-ley-h i{ width:10px; height:10px; border-radius:3px; background:var(--c); }

    .tab-col{ display:flex; align-items:flex-end; justify-content:space-around; gap:18px; height:260px; padding:10px 6px 0; border-bottom:2px solid #EFE4D6; }
    .tab-col div{ flex:1; max-width:90px; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:6px; }
    .tab-col b{ font-size:15px; font-weight:800; font-variant-numeric:tabular-nums; }
    .tab-col i{ display:block; width:100%; height:0; border-radius:10px 10px 0 0; background:linear-gradient(180deg, var(--c2, var(--c)), var(--c)); min-height:3px; transition:height .9s cubic-bezier(.2,.9,.3,1); }
    .tab-col-et{ display:flex; justify-content:space-around; gap:18px; padding:8px 6px 0; }
    .tab-col-et span{ flex:1; max-width:90px; text-align:center; font-size:11.5px; font-weight:600; color:#6B5563; }

    .tab-areas-sel{ display:grid; grid-template-columns:repeat(auto-fill, minmax(165px, 1fr)); gap:8px; margin:-4px 0 18px; }
    .tab-chip{ display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%; min-width:0; margin:0; padding:8px 12px; border-radius:12px; cursor:pointer; text-align:left;
      border:1px solid #E4D6C8; background:#fff; color:#4A0A1D; font:600 12px 'Montserrat',sans-serif; transition:background .15s, transform .12s, box-shadow .15s; }
    .tab-chip b{ flex-shrink:0; font-weight:800; color:#A9824C; font-variant-numeric:tabular-nums; }
    .tab-chip span{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tab-chip:hover{ background:#F6EEDD; transform:translateY(-1px); }
    .tab-chip.activo{ background:linear-gradient(135deg,#5F2132,#3D1420); color:#fff; border-color:transparent; box-shadow:0 4px 12px rgba(61,20,32,.25); }
    .tab-chip.activo b{ color:#E9C873; }
    .tab-chip:focus-visible{ outline:2px solid #D8B866; outline-offset:2px; }
    .tab-kpi.monto{ --c:#A9824C; --c2:#D8B866; }
    .tab-kpi.monto b{ font-size:19px; }
    .tab-ventana{ width:min(720px,100%) !important; }
    .tab-busca{ display:flex; align-items:center; gap:10px; margin:-2px 0 14px; }
    .tab-busca label{ font-size:11px; font-weight:700; color:#7C5D31; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
    .tab-busca-caja{ position:relative; flex:1; min-width:0; }
    .tab-busca-caja input{ width:100%; box-sizing:border-box; margin:0; padding:9px 38px 9px 12px; border-radius:10px; border:1px solid #E4D6C8; background:#fff; color:#3D1420; font:600 12.5px 'Montserrat',sans-serif; }
    .tab-busca-caja input:focus{ outline:none; border-color:#A9824C; box-shadow:0 0 0 3px rgba(169,130,76,.22); }
    .tab-busca-flecha{ position:absolute; right:4px; top:50%; transform:translateY(-50%); width:30px; height:30px; margin:0; padding:0; border:0; border-radius:8px; background:transparent; color:#7C5D31; font-size:14px; cursor:pointer; box-shadow:none; }
    .tab-busca-flecha:hover{ background:#F6EEE3; }
    .tab-busca-lista{ position:absolute; z-index:5; left:0; right:0; top:calc(100% + 6px); max-height:240px; overflow-y:auto; margin:0; padding:6px; list-style:none; background:#fff; border:1px solid #E4D6C8; border-radius:12px; box-shadow:0 14px 30px rgba(61,20,32,.16); }
    .tab-busca-lista li{ padding:8px 10px; border-radius:8px; font:600 12.5px 'Montserrat',sans-serif; color:#3D1420; cursor:pointer; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tab-busca-lista li:hover{ background:#F6EEE3; }
    .tab-busca-lista li.sel{ background:#5F2132; color:#fff; }
    .tab-busca-lista li.vacio{ color:#9A8A90; cursor:default; font-weight:500; }
    .tab-sel{ display:flex; align-items:center; gap:8px; margin:-2px 0 12px; }
    .tab-sel label{ font-size:11px; font-weight:700; color:#7C5D31; letter-spacing:.06em; text-transform:uppercase; white-space:nowrap; }
    .tab-sel select{ flex:1; min-width:0; padding:7px 10px; border-radius:10px; border:1px solid #E4D6C8; background:#fff; color:#3D1420; font:600 12.5px 'Montserrat',sans-serif; cursor:pointer; }
    .tab-sel select:focus{ outline:none; border-color:#A9824C; box-shadow:0 0 0 3px rgba(169,130,76,.22); }
    .tab-col b.din{ font-size:11.5px; }
    .tab-msg{ padding:60px 20px; text-align:center; color:#6B5563; font-size:14px; }
    @media (max-width:900px){ .tab-kpis{ grid-template-columns:repeat(2,1fr); } .tab-kpi.total{ grid-column:1 / -1; grid-row:auto; } .tab-graficas{ grid-template-columns:1fr; } }
    @media (max-width:560px){ .tab-cab, .tab-cuerpo{ padding-left:18px; padding-right:18px; } .tab-fila{ grid-template-columns:96px 1fr 44px; } }
    @media (prefers-reduced-motion:reduce){ .tab-fondo, .tab-ventana, .tab-kpi{ animation:none; opacity:1; transform:none; } .tab-fila .pista i, .tab-col i, .tab-dona .seg{ transition:none; } }    /* Versión compacta: todo cabe en la ventana sin barra de desplazamiento */
    .tab-ventana{ width:min(1040px,100%); max-height:calc(100vh - 32px); border-radius:20px; }
    .tab-cab{ padding:14px 22px 12px; }
    .tab-tit{ font-size:10px; } .tab-area{ font-size:18px; }
    .tab-btn{ width:32px; height:32px; font-size:16px; }
    .tab-cuerpo{ padding:14px 22px 18px; gap:14px; }
    .tab-kpis{ gap:10px; }
    .tab-kpi{ padding:10px 14px; border-radius:13px; }
    .tab-kpi span{ font-size:11px; }
    .tab-kpi b{ font-size:22px; }
    .tab-kpi small{ font-size:10.5px; }
    .tab-kpi.total span{ font-size:12px; } .tab-kpi.total b{ font-size:36px; }
    .tab-graficas{ grid-template-columns:minmax(230px,280px) 1fr; gap:14px; }
    .tab-tarjeta{ padding:14px 16px; border-radius:15px; }
    .tab-tarjeta h3{ margin:0 0 10px; font-size:13px; } .tab-tarjeta h3 small{ font-size:11px; }
    .tab-dona{ gap:10px; } .tab-dona svg{ width:140px; height:140px; }
    .tab-leyenda{ gap:3px; } .tab-leyenda div{ font-size:11.5px; } .tab-leyenda i{ width:10px; height:10px; }
    .tab-areas-sel{ grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:6px; margin:-2px 0 10px; }
    .tab-chip{ padding:5px 10px; border-radius:10px; font-size:11px; }
    .tab-col{ height:160px; gap:12px; padding-top:30px; }
    .tab-col b{ font-size:12.5px; }
    .tab-col-pct{ font-style:normal; font-size:10.5px; font-weight:700; color:#9A8A90; margin-top:-4px; font-variant-numeric:tabular-nums; }
    .tab-col-et{ gap:12px; padding-top:6px; } .tab-col-et span{ font-size:10.5px; }
    @media (max-height:720px){ .tab-col{ height:120px; } .tab-dona svg{ width:120px; height:120px; } .tab-kpi b{ font-size:19px; } }
`;

  document.head.appendChild(css);

  /* Dona en SVG: un arco por estatus (y «otros» en gris) */
  function dona(t) {
    const partes = ESTADOS.map(e => ({ v: t[e.k], c: e.c, t: e.t }));
    const otros = t.total - partes.reduce((s, p) => s + p.v, 0);
    if (otros > 0) partes.push({ v: otros, c: OTROS.c, t: OTROS.t });
    const R = 80, C = 2 * Math.PI * R;
    let acum = 0;
    const arcos = partes.filter(p => p.v > 0).map(p => {
      const largo = p.v / t.total * C, sep = partes.filter(x => x.v > 0).length > 1 ? 2 : 0;
      const a = `<circle class="seg" cx="100" cy="100" r="${R}" fill="none" stroke="${p.c}" stroke-width="30"
        stroke-dasharray="0 ${C}" data-largo="${Math.max(largo - sep, 0)}" data-c="${C}" stroke-dashoffset="${-acum}" transform="rotate(-90 100 100)"><title>${esc(p.t)}: ${num(p.v)}</title></circle>`;
      acum += largo; return a;
    }).join('');
    return `<svg viewBox="0 0 200 200" role="img" aria-label="Proporción de contratos por etapa">
      <circle cx="100" cy="100" r="${R}" fill="none" stroke="#F3ECE4" stroke-width="30"/>${arcos}
      <text x="100" y="96" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="30" font-weight="800" fill="#3D1420">${num(t.total)}</text>
      <text x="100" y="118" text-anchor="middle" font-family="Montserrat,sans-serif" font-size="11" font-weight="600" fill="#9A8A90">contratos</text>
    </svg>`;
  }

  function pintar(cuerpo, d) {
    const t = d.totales;
    // Porcentajes con 2 decimales que suman exactamente 100.00 (método del mayor residuo:
    // se reparten las centésimas que faltan a los que más se redondearon hacia abajo)
    const exactos = (() => {
      const vals = ESTADOS.map(e => t[e.k]);
      const resto = t.total - vals.reduce((a, b) => a + b, 0);
      if (resto > 0) vals.push(resto);
      if (!t.total) return new Map();
      const crudos = vals.map(v => v / t.total * 10000);
      const base = crudos.map(Math.floor);
      let faltan = 10000 - base.reduce((a, b) => a + b, 0);
      crudos.map((c, i) => [c - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (faltan > 0) { base[i]++; faltan--; } });
      const m = new Map();
      vals.forEach((v, i) => m.set(i, base[i] / 100));
      return m;
    })();
    const pct = (n, i) => (exactos.get(i) ?? 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const otros = t.total - ESTADOS.reduce((s, e) => s + t[e.k], 0);
    const leyenda = [...ESTADOS.map(e => ({ t: e.t, c: e.c, c2: e.c2, v: t[e.k] })), ...(otros > 0 ? [{ t: OTROS.t, c: OTROS.c, v: otros }] : [])];

    // Derecha: gráfica de barras por estatus. C.A. elige el área (o todas); cada área ve la suya
    // Porcentajes exactos (2 decimales que suman 100.00) de una lista de cantidades
    const repartir = (lista, total) => {
      if (!total) return lista.map(() => 0);
      const crudos = lista.map(v => v / total * 10000), base = crudos.map(Math.floor);
      let faltan = 10000 - base.reduce((a, b) => a + b, 0);
      crudos.map((c, i) => [c - base[i], i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (faltan > 0) { base[i]++; faltan--; } });
      return base.map(v => v / 100);
    };
    const fmtPct = (p) => p.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
    const MONTOS = [
      { k: 'autorizado', t: 'Autorizado',   c: '#5F2132', c2: '#9A3C55' },
      { k: 'facturado',  t: 'Facturado',    c: '#E39A2D', c2: '#F5C26B' },
      { k: 'pagado',     t: 'Pagado',       c: '#2E9D5B', c2: '#5FCB8A' },
      { k: 'porFacturar',t: 'Por facturar', c: '#2C8FC9', c2: '#62B6E6' },
    ];
    const barras = (m) => {
      const max = Math.max(...MONTOS.map(x => m[x.k]), 1);
      return `<div class="tab-col">${MONTOS.map(x => `<div><b class="din" data-n="${m[x.k]}" data-m="1">$0</b><em class="tab-col-pct">${x.k === 'autorizado' ? 'base (100%)' : m.autorizado ? fmtPct(Math.round(m[x.k] / m.autorizado * 10000) / 100) : ''}</em><i style="--c:${x.c}; --c2:${x.c2}" data-h="${m[x.k] / max * 85}%" title="${esc(x.t)}: ${dinero(m[x.k])}"></i></div>`).join('')}</div>
        <div class="tab-col-et">${MONTOS.map(x => `<span>${esc(x.t)}</span>`).join('')}</div>`;
    };
    const opciones = [{ i: '', nombre: `Todos los contratos (${num(t.total)})` }].concat(d.contratos.map((c, i) => ({ i: String(i), nombre: c.nombre })));
    cuerpo.innerHTML = `<div class="tab-tarjeta"><h3>Montos<small>porcentajes respecto al autorizado</small></h3>
        <div class="tab-busca">
          <label for="tab-contrato">Contrato</label>
          <div class="tab-busca-caja">
            <input id="tab-contrato" type="text" autocomplete="off" placeholder="Buscar por número, proveedor o producto…" value="${esc(opciones[0].nombre)}">
            <button type="button" class="tab-busca-flecha" aria-label="Ver contratos">▾</button>
            <ul class="tab-busca-lista" role="listbox" hidden></ul>
          </div>
        </div>
        <div class="tab-area-graf">${barras(d.montos)}</div></div>`;
    animar(cuerpo);
    const input = cuerpo.querySelector('#tab-contrato'), lista = cuerpo.querySelector('.tab-busca-lista');
    let elegido = '';
    const norm = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const mostrar = (filtro) => {
      const q = norm(filtro || '');
      const hay = opciones.filter(o => !q || norm(o.nombre).includes(q));
      lista.innerHTML = hay.length ? hay.map(o => `<li role="option" data-i="${o.i}" class="${o.i === elegido ? 'sel' : ''}">${esc(o.nombre)}</li>`).join('') : '<li class="vacio">Sin coincidencias</li>';
      lista.hidden = false;
    };
    const elegir = (idx) => {
      elegido = idx;
      input.value = opciones.find(o => o.i === idx).nombre;
      lista.hidden = true;
      const graf = cuerpo.querySelector('.tab-area-graf');
      graf.innerHTML = barras(idx === '' ? d.montos : d.contratos[Number(idx)].montos);
      animar(graf);
    };
    input.addEventListener('focus', () => { input.select(); mostrar(''); });
    input.addEventListener('input', () => mostrar(input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const p = lista.querySelector('li[data-i]'); if (p) elegir(p.dataset.i); e.preventDefault(); }
      if (e.key === 'Escape') { lista.hidden = true; input.value = opciones.find(o => o.i === elegido).nombre; e.stopPropagation(); }
    });
    cuerpo.querySelector('.tab-busca-flecha').addEventListener('click', () => { if (lista.hidden) { input.focus(); } else lista.hidden = true; });
    lista.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-i]'); if (li) { e.preventDefault(); elegir(li.dataset.i); } });
    input.addEventListener('blur', () => setTimeout(() => { lista.hidden = true; input.value = opciones.find(o => o.i === elegido).nombre; }, 120));
  }

  /* Animaciones: cifras que cuentan, dona que se dibuja y barras que crecen */
  function animar(cuerpo) {
    const fin = () => {
      cuerpo.querySelectorAll('[data-n]').forEach(b => b.textContent = b.dataset.m ? dinero(b.dataset.n) : num(b.dataset.n));
      cuerpo.querySelectorAll('.seg').forEach(c => c.setAttribute('stroke-dasharray', `${c.dataset.largo} ${c.dataset.c}`));
      cuerpo.querySelectorAll('[data-w]').forEach(i => i.style.width = i.dataset.w);
      cuerpo.querySelectorAll('[data-h]').forEach(i => i.style.height = i.dataset.h);
    };
    if (quieto) return fin();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cuerpo.querySelectorAll('.seg').forEach(c => c.setAttribute('stroke-dasharray', `${c.dataset.largo} ${c.dataset.c}`));
      cuerpo.querySelectorAll('.tab-fila').forEach((f, k) => f.querySelectorAll('[data-w]').forEach(i => { i.style.transitionDelay = (k * 70) + 'ms'; i.style.width = i.dataset.w; }));
      cuerpo.querySelectorAll('[data-h]').forEach((i, k) => { i.style.transitionDelay = (k * 80) + 'ms'; i.style.height = i.dataset.h; });
    }));
    const inicio = performance.now(), dur = 1100;
    const cifras = [...cuerpo.querySelectorAll('[data-n]')];
    const paso = (ahora) => {
      const p = Math.min(1, (ahora - inicio) / dur), suave = 1 - Math.pow(1 - p, 3);
      cifras.forEach(b => { const v = Math.round(Number(b.dataset.n) * suave); b.textContent = b.dataset.m ? dinero(v) : num(v); });
      if (p < 1) requestAnimationFrame(paso);
    };
    requestAnimationFrame(paso);
  }

  let fondo = null;
  function cerrar() { if (!fondo) return; fondo.remove(); fondo = null; document.removeEventListener('keydown', teclas); document.querySelector('.tab-icono')?.focus(); }
  function teclas(e) { if (e.key === 'Escape') cerrar(); }
  function resumir(p) {
    const m = montosDelContrato(p);
    return { autorizado: Number(m.vigente || 0), facturado: Number(m.facturado || 0), pagado: Number(m.pagado || 0), porFacturar: Number(m.porFacturar ?? Math.max(0, (m.vigente || 0) - (m.facturado || 0))) };
  }
  async function cargar(recargar = false) {
    const cuerpo = fondo.querySelector('.tab-cuerpo');
    cuerpo.innerHTML = '<div class="tab-msg">Cargando el tablero…</div>';
    try {
      let lista = typeof pedidosCache !== 'undefined' ? pedidosCache : [];
      if ((recargar || !lista.length) && typeof StorePedidos !== 'undefined') lista = await StorePedidos.listar();
      if (!fondo) return;
      const totales = { total: lista.length };
      ESTADOS.forEach(e => totales[e.k] = lista.filter(p => p.estatus === e.k).length);
      const contratos = lista.map(p => ({ nombre: (p.noContrato ? 'No. ' + p.noContrato + ' · ' : '') + (p.proveedor || p.producto || 'Contrato ' + p.id), montos: resumir(p) }))
        .sort((a, b) => b.montos.autorizado - a.montos.autorizado);
      const montos = contratos.reduce((s, c) => { Object.keys(s).forEach(k => s[k] += c.montos[k]); return s; }, { autorizado: 0, facturado: 0, pagado: 0, porFacturar: 0 });
      fondo.querySelector('.tab-area').textContent = 'Todos los contratos';
      pintar(cuerpo, { totales, contratos, montos });
    } catch (e) {
      if (fondo) cuerpo.innerHTML = `<div class="tab-msg">${esc(e.message)}</div>`;
    }
  }
  function abrir() {
    if (fondo) return;
    fondo = document.createElement('div');
    fondo.className = 'tab-fondo';
    fondo.innerHTML = `
      <div class="tab-ventana" role="dialog" aria-modal="true" aria-label="Tablero de contratos">
        <div class="tab-cab">
          <div><div class="tab-tit">Tablero de contratos</div><div class="tab-area">…</div></div>
          <div class="tab-acc">
            <button type="button" class="tab-btn tab-actualizar" title="Actualizar" aria-label="Actualizar"><i class="ti ti-refresh"></i></button>
            <button type="button" class="tab-btn tab-cerrar" title="Cerrar" aria-label="Cerrar"><i class="ti ti-x"></i></button>
          </div>
        </div>
        <div class="tab-cuerpo"></div>
      </div>`;
    document.body.appendChild(fondo);
    fondo.addEventListener('pointerdown', (e) => { if (e.target === fondo) cerrar(); });
    fondo.querySelector('.tab-cerrar').onclick = cerrar;
    fondo.querySelector('.tab-actualizar').onclick = () => cargar(true);
    document.addEventListener('keydown', teclas);
    fondo.querySelector('.tab-cerrar').focus();
    cargar();
  }

  function preparar() {
    const salir = document.querySelector('.navbar-top-right [data-cerrar-sesion]');
    if (!salir || document.querySelector('.tab-icono')) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab-icono';
    b.setAttribute('aria-label', 'Tablero de contratos'); b.title = 'Tablero de contratos';
    b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round">
      <path d="M5.5 19V13M10.5 19V8.5M15.5 19V11M20.5 19V5" stroke-width="2.6"/><path d="M3 21.2h20" stroke-width="1.3" opacity=".45"/></svg>`;
    // A la izquierda del botón de asistencia (o de «Cerrar sesión» si no está)
    const ancla = document.querySelector('.nav-asis-caja') || salir;
    ancla.parentNode.insertBefore(b, ancla);
    b.addEventListener('click', abrir);
  }

  // El botón del asistente se agrega después; se espera a que exista para quedar a su izquierda
  let intentos = 0;
  const intentar = () => { if (document.querySelector('.nav-asis-caja') || intentos > 20) preparar(); else { intentos++; setTimeout(intentar, 150); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', intentar); else intentar();
})();
