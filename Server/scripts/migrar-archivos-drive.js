// =========================================================
// migrar-archivos-drive.js
// Pasa a la carpeta de Drive los archivos que todavía están guardados
// dentro de la base (columna "datos") y deja en la base solo su ID.
// Uso (desde Server/):  node scripts/migrar-archivos-drive.js
// Requiere en .env: DATABASE_URL, APPS_SCRIPT_URL y APPS_SCRIPT_SECRETO.
// =========================================================

require('dotenv').config();
const db = require('../src/db');
const { subirADrive } = require('../src/drive');

(async () => {
  const { rows } = await db.query('SELECT id, pedido_id, tipo, nombre, mime FROM pedido_archivos WHERE drive_id IS NULL AND datos IS NOT NULL ORDER BY id');
  console.log(`Archivos por migrar: ${rows.length}`);
  for (const a of rows) {
    const { rows: b } = await db.query('SELECT datos FROM pedido_archivos WHERE id = $1', [a.id]);
    const datos = b[0].datos;
    const driveId = await subirADrive({
      nombre: `${a.tipo === 'entrega' ? 'Entrega' : 'Contrato'} ${a.pedido_id} - ${a.nombre}`,
      mime: a.mime, tamano: datos.length, cuerpo: datos
    });
    await db.query('UPDATE pedido_archivos SET drive_id = $1, datos = NULL WHERE id = $2', [driveId, a.id]);
    console.log(`  contrato ${a.pedido_id} (${a.tipo}) -> Drive OK`);
  }
  await db.query('VACUUM FULL pedido_archivos');   // libera el espacio en Neon
  const { rows: t } = await db.query('SELECT pg_size_pretty(pg_database_size(current_database())) AS tamano');
  console.log('Listo. Tamaño de la base ahora:', t[0].tamano);
  process.exit(0);
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
