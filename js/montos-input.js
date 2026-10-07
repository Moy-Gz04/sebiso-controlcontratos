// =========================================================
// montos-input.js
// Los campos de dinero muestran comas de miles y punto decimal
// mientras se escribe (72000 → 72,000.00). Un <input type="number">
// no admite comas, así que se vuelven campos de texto con teclado
// decimal; al enviar el formulario se limpian (72,000.00 → 72000.00)
// para que el resto del código y el servidor reciban un número.
// Aplica a: monto, montoEjercido, montoEstimado (2 decimales) y
// cantidad (solo miles, respeta los decimales que se escriban).
// =========================================================

const CAMPOS_MONTO = ['monto', 'montoEjercido', 'montoEstimado'];
const CAMPOS_CANTIDAD = ['cantidad'];

// "72,000.50" → 72000.5   (NaN si está vacío o no es número)
function numMonto(v) {
  const limpio = String(v ?? '').replace(/[^\d.-]/g, '');
  return limpio === '' ? NaN : Number(limpio);
}

// Formatea el texto conservando lo que el usuario está escribiendo
function formatearTextoMonto(texto, conDecimalesFijos) {
  let s = String(texto ?? '').replace(/[^\d.]/g, '');
  const punto = s.indexOf('.');
  let entero = punto >= 0 ? s.slice(0, punto) : s;
  let dec = punto >= 0 ? s.slice(punto + 1).replace(/\./g, '') : null;
  entero = entero.replace(/^0+(?=\d)/, '');
  if (conDecimalesFijos && dec !== null) dec = dec.slice(0, 2);
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  if (dec === null) return miles;
  return (miles || '0') + '.' + dec;
}

function formatearMontoInput(el) {
  if (!el || !el.dataset.moneda) return;
  const fijo = el.dataset.moneda === '2';
  if (el.value === '') return;
  const n = numMonto(el.value);
  if (isNaN(n)) { el.value = ''; return; }
  el.value = fijo
    ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : formatearTextoMonto(String(n), false);
}

function prepararCampoMonto(el) {
  if (el.dataset.moneda) return;
  const base = String(el.name || '').split('.').pop();   // "cr.22.factura.monto" → "monto"
  const esDinero = CAMPOS_MONTO.includes(base);
  if (!esDinero && !CAMPOS_CANTIDAD.includes(base)) return;
  el.dataset.moneda = esDinero ? '2' : '1';
  // Los límites se conservan para validar al enviar
  if (el.min !== '') el.dataset.min = el.min;
  if (el.max !== '') el.dataset.max = el.max;
  el.removeAttribute('min'); el.removeAttribute('max'); el.removeAttribute('step');
  el.type = 'text';
  el.inputMode = 'decimal';
  el.autocomplete = 'off';
  el.classList.add('campo-monto');
  formatearMontoInput(el);

  el.addEventListener('input', () => {
    // Mantener el cursor en el mismo dígito después de reformatear
    const antes = el.value, pos = el.selectionStart ?? antes.length;
    const digitosAntes = antes.slice(0, pos).replace(/[^\d.]/g, '').length;
    const nuevo = formatearTextoMonto(antes, el.dataset.moneda === '2');
    if (nuevo === antes) return;
    el.value = nuevo;
    let cuenta = 0, i = 0;
    while (i < nuevo.length && cuenta < digitosAntes) { if (/[\d.]/.test(nuevo[i])) cuenta++; i++; }
    try { el.setSelectionRange(i, i); } catch (e) {}
  });
  el.addEventListener('blur', () => formatearMontoInput(el));
}

function prepararCamposMonto(raiz) {
  (raiz || document).querySelectorAll('input[type="number"]').forEach(prepararCampoMonto);
}

// Al enviar: validar mínimos/máximos y dejar el número limpio para el resto del código
document.addEventListener('submit', (e) => {
  const campos = e.target.querySelectorAll ? e.target.querySelectorAll('input[data-moneda]') : [];
  for (const el of campos) {
    if (el.value === '') continue;
    const n = numMonto(el.value);
    const min = el.dataset.min !== undefined ? Number(el.dataset.min) : null;
    const max = el.dataset.max !== undefined && el.dataset.max !== '' ? Number(el.dataset.max) : null;
    let error = isNaN(n) ? 'Escribe una cantidad válida.' : '';
    if (!error && min !== null && n < min - 1e-9) error = 'La cantidad debe ser de al menos ' + min.toLocaleString('en-US', { minimumFractionDigits: el.dataset.moneda === '2' ? 2 : 0 }) + '.';
    if (!error && max !== null && n > max + 1e-9) error = 'La cantidad no puede ser mayor a ' + max.toLocaleString('en-US', { minimumFractionDigits: el.dataset.moneda === '2' ? 2 : 0 }) + '.';
    if (error) {
      e.preventDefault(); e.stopImmediatePropagation();
      el.setCustomValidity(error); el.reportValidity();
      el.addEventListener('input', () => el.setCustomValidity(''), { once: true });
      return;
    }
    el.value = el.dataset.moneda === '2' ? n.toFixed(2) : String(n);
  }
}, true);

// Los formularios se pintan dinámicamente: preparar cada campo nuevo que aparezca
prepararCamposMonto(document);
new MutationObserver((cambios) => {
  for (const c of cambios) c.addedNodes.forEach(n => { if (n.nodeType === 1) prepararCamposMonto(n.matches && n.matches('input') ? n.parentNode : n); });
}).observe(document.body, { childList: true, subtree: true });
