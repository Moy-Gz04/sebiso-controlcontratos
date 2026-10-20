// =========================================================
// selector-estilizado.js
// Convierte un <select> en un desplegable con el estilo de la app.
// El <select> original sigue siendo la fuente de verdad (valor, eventos
// "change", opciones): este componente solo lo muestra de otra forma y,
// al elegir, le asigna el valor y le dispara "change".
//
// Cada <option> puede traer datos para verse mejor:
//   data-num     → insignia con el número (p. ej. la UP)
//   data-nombre  → texto principal
//   data-n       → conteo, a la derecha
//   data-icono   → clase de icono (Tabler) cuando no hay insignia
// Sin esos datos se usa el texto de la opción.
// =========================================================

function estilizarSelect(sel) {
  if (!sel || sel.dataset.estilizado) return;
  sel.dataset.estilizado = '1';

  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cont = document.createElement('div');
  cont.className = 'sel-est';
  if (sel.className) cont.classList.add(...sel.className.split(/\s+/).filter(Boolean).map(c => 'sel-est--' + c));
  sel.parentNode.insertBefore(cont, sel);
  cont.appendChild(sel);
  sel.classList.add('sel-est-nativo');
  sel.setAttribute('tabindex', '-1');
  sel.setAttribute('aria-hidden', 'true');

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'sel-est-boton';
  boton.setAttribute('aria-haspopup', 'listbox');
  boton.setAttribute('aria-expanded', 'false');
  const etiqueta = sel.getAttribute('aria-label');
  if (etiqueta) boton.setAttribute('aria-label', etiqueta);
  cont.insertBefore(boton, sel);

  let panel = null;
  let indice = -1;

  const contenidoOpcion = (o, enBoton) => {
    const num = o.dataset.num, nombre = o.dataset.nombre, n = o.dataset.n, icono = o.dataset.icono;
    if (!nombre && !num) return `<span class="sel-est-nombre">${esc(o.textContent)}</span>`;
    const insignia = num
      ? `<span class="sel-est-num">${esc(num)}</span>`
      : `<span class="sel-est-ico"><i class="ti ${esc(icono || 'ti-layout-grid')}"></i></span>`;
    const conteo = n !== undefined && n !== '' ? `<span class="sel-est-n">${esc(n)}</span>` : '';
    return `${insignia}<span class="sel-est-nombre">${esc(nombre || o.textContent)}</span>${enBoton ? '' : conteo}${enBoton ? conteo : ''}`;
  };

  const pintarBoton = () => {
    const o = sel.options[sel.selectedIndex] || sel.options[0];
    boton.innerHTML = (o ? contenidoOpcion(o, true) : '') + '<i class="ti ti-chevron-down sel-est-flecha" aria-hidden="true"></i>';
    cont.classList.toggle('sel-est--activo', !!sel.value);
  };

  const cerrar = (devolverFoco = false) => {
    if (!panel) return;
    panel.remove(); panel = null;
    boton.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', fuera, true);
    window.removeEventListener('resize', cerrarSinFoco);
    window.removeEventListener('scroll', cerrarSinFoco, true);
    if (devolverFoco) boton.focus();
  };
  const cerrarSinFoco = (e) => { if (e && panel && panel.contains(e.target)) return; cerrar(false); };
  const fuera = (e) => { if (panel && !panel.contains(e.target) && !boton.contains(e.target)) cerrar(false); };

  const elegir = (i) => {
    const o = sel.options[i];
    if (!o) return;
    const cambio = sel.selectedIndex !== i;
    sel.selectedIndex = i;
    pintarBoton();
    cerrar(true);
    if (cambio) sel.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const resaltar = (i) => {
    if (!panel) return;
    const items = [...panel.querySelectorAll('[role="option"]')];
    if (!items.length) return;
    indice = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, k) => el.classList.toggle('sel-est-resaltada', k === indice));
    items[indice].scrollIntoView({ block: 'nearest' });
    boton.setAttribute('aria-activedescendant', items[indice].id);
  };

  const abrir = () => {
    if (panel) return;
    panel = document.createElement('div');
    panel.className = 'sel-est-panel';
    panel.setAttribute('role', 'listbox');
    panel.innerHTML = [...sel.options].map((o, i) => `
      <div class="sel-est-opcion${i === sel.selectedIndex ? ' sel-est-elegida' : ''}" role="option" id="sel-est-${Math.random().toString(36).slice(2, 8)}" aria-selected="${i === sel.selectedIndex}" data-i="${i}">
        ${contenidoOpcion(o, false)}<i class="ti ti-check sel-est-check" aria-hidden="true"></i>
      </div>`).join('');
    document.body.appendChild(panel);

    // Posición: debajo del botón (o arriba si abajo no cabe); nunca más ancho que la pantalla
    const r = boton.getBoundingClientRect();
    const ancho = Math.min(Math.max(r.width, 340), window.innerWidth - 24);
    const izq = Math.max(12, Math.min(r.left, window.innerWidth - ancho - 12));
    panel.style.width = ancho + 'px';
    panel.style.left = izq + 'px';
    const alto = Math.min(panel.scrollHeight, 340);
    const abajo = window.innerHeight - r.bottom - 12, arriba = r.top - 12;
    if (abajo >= alto || abajo >= arriba) { panel.style.top = (r.bottom + 6) + 'px'; panel.style.maxHeight = Math.max(160, abajo - 6) + 'px'; }
    else { panel.style.bottom = (window.innerHeight - r.top + 6) + 'px'; panel.style.maxHeight = Math.max(160, arriba - 6) + 'px'; }

    boton.setAttribute('aria-expanded', 'true');
    panel.addEventListener('click', (e) => { const el = e.target.closest('[role="option"]'); if (el) elegir(Number(el.dataset.i)); });
    panel.addEventListener('mousemove', (e) => { const el = e.target.closest('[role="option"]'); if (el) resaltar([...panel.children].indexOf(el)); });
    document.addEventListener('pointerdown', fuera, true);
    window.addEventListener('resize', cerrarSinFoco);
    window.addEventListener('scroll', cerrarSinFoco, true);
    resaltar(sel.selectedIndex);
  };

  boton.addEventListener('click', () => (panel ? cerrar(true) : abrir()));
  boton.addEventListener('keydown', (e) => {
    const k = e.key;
    if (!panel) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); abrir(); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); resaltar(indice + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); resaltar(indice - 1); }
    else if (k === 'Home') { e.preventDefault(); resaltar(0); }
    else if (k === 'End') { e.preventDefault(); resaltar(sel.options.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); elegir(indice); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); }
    else if (k === 'Tab') cerrar(false);
  });

  // Si el código vuelve a llenar las opciones o cambia el valor, se refleja
  new MutationObserver(() => { pintarBoton(); if (panel) cerrar(false); }).observe(sel, { childList: true, attributes: true, attributeFilter: ['disabled'] });
  sel.addEventListener('change', pintarBoton);
  const valor = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { get() { return valor.get.call(this); }, set(v) { valor.set.call(this, v); pintarBoton(); } });
  pintarBoton();
}
