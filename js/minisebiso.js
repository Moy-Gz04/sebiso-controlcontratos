// =========================================================
// minisebiso.js
// MiniSEBISO (la mascota del login): sus ojos siguen al ratón o al dedo,
// con un tope para que no se salgan de la cara; si el puntero sale de la
// ventana vuelve a mirar de frente.
// =========================================================

(function () {
  const ojos = document.querySelectorAll('.minisebiso .ms-ojo-mov');
  if (!ojos.length) return;
  const centrar = () => ojos.forEach(o => { o.style.setProperty('--dx', '0px'); o.style.setProperty('--dy', '0px'); });
  window.addEventListener('pointermove', (e) => {
    ojos.forEach(o => {
      const r = o.getBoundingClientRect();
      if (!r.width) return;
      const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const fuerza = Math.min(1, dist / 220);
      o.style.setProperty('--dx', (dx / dist * r.width * .55 * fuerza).toFixed(1) + 'px');
      o.style.setProperty('--dy', (dy / dist * r.height * .32 * fuerza).toFixed(1) + 'px');
    });
  });
  document.documentElement.addEventListener('mouseleave', centrar);
})();
