// =========================================================
// arrastrar-archivos.js
// Cualquier zona para subir archivos (contrato, documentos de cada paso,
// chips de contrarrecibo, botones "Subir"/"Reemplazar") acepta que se
// arrastre el archivo encima. Se pasa al <input type="file"> de la zona y
// se dispara su evento "change", así que sigue el mismo camino que al
// elegirlo con el explorador.
// =========================================================

(function () {
  const ZONAS = '.zona-archivo, .chip-doc--subir, .doc-boton, .doc-subir';
  const zonaDe = (el) => {
    const z = el && el.closest ? el.closest(ZONAS) : null;
    return z && z.querySelector('input[type="file"]') ? z : null;
  };
  const traeArchivos = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  let activa = null;
  const marcar = (z) => {
    if (activa === z) return;
    if (activa) activa.classList.remove('arrastrando');
    activa = z;
    if (z) z.classList.add('arrastrando');
  };

  document.addEventListener('dragover', (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();   // sin esto el navegador abriría el archivo
    const z = zonaDe(e.target);
    e.dataTransfer.dropEffect = z ? 'copy' : 'none';
    marcar(z);
  });
  document.addEventListener('dragleave', (e) => {
    if (activa && !activa.contains(e.relatedTarget)) marcar(null);
  });
  document.addEventListener('drop', (e) => {
    if (!traeArchivos(e)) return;
    e.preventDefault();
    const z = zonaDe(e.target);
    marcar(null);
    if (!z) return;
    const input = z.querySelector('input[type="file"]');
    const archivo = e.dataTransfer.files[0];
    if (!archivo) return;
    const dt = new DataTransfer();
    dt.items.add(archivo);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
})();
