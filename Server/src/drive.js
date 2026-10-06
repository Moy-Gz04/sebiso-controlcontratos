// =========================================================
// drive.js
// Guarda y lee los archivos de los contratos en una carpeta de Google
// Drive. El Apps Script (apps-script-contratos.gs) presta una llave
// temporal y el ID de la carpeta; con eso se usa la API de Drive
// directo, por partes, sin cargar el archivo completo en memoria.
//
// Variables de entorno: APPS_SCRIPT_URL y APPS_SCRIPT_SECRETO.
// =========================================================

const { Readable } = require('stream');

let llave = null;   // { token, carpeta, vence }

function urlScript() {
  const m = String(process.env.APPS_SCRIPT_URL || '').match(/https?:\/\/\S+/);
  return m ? m[0].replace(/['"]+$/, '') : '';
}

function driveConfigurado() {
  return Boolean(urlScript() && process.env.APPS_SCRIPT_SECRETO);
}

async function obtenerLlave(forzar = false) {
  if (!forzar && llave && llave.vence > Date.now() + 60000) return llave;
  if (!driveConfigurado()) throw new Error('Drive no está configurado (APPS_SCRIPT_URL / APPS_SCRIPT_SECRETO)');
  const r = await fetch(urlScript(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'tokenDrive', secreto: process.env.APPS_SCRIPT_SECRETO }),
    redirect: 'follow'
  });
  const datos = await r.json();
  if (!datos.ok) throw new Error('Apps Script: ' + (datos.error || 'sin llave'));
  llave = { token: datos.token, carpeta: datos.carpeta, vence: Date.now() + Math.min(Number(datos.expiraEnSeg) || 3000, 3000) * 1000 };
  return llave;
}

// Sube un archivo a la carpeta. `cuerpo` puede ser un Buffer o un stream
// (la petición HTTP entrante); `tamano` en bytes es obligatorio.
async function subirADrive({ nombre, mime, tamano, cuerpo }) {
  const { token, carpeta } = await obtenerLlave();
  const inicio = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': mime,
      'X-Upload-Content-Length': String(tamano)
    },
    body: JSON.stringify({ name: nombre, parents: [carpeta] })
  });
  if (!inicio.ok) throw new Error('Drive (inicio): ' + inicio.status + ' ' + (await inicio.text()).slice(0, 200));
  const destino = inicio.headers.get('location');
  const envio = await fetch(destino, {
    method: 'PUT',
    headers: { 'Content-Type': mime, 'Content-Length': String(tamano) },
    body: Buffer.isBuffer(cuerpo) ? cuerpo : Readable.toWeb(cuerpo),
    duplex: 'half'
  });
  if (!envio.ok) throw new Error('Drive (envío): ' + envio.status + ' ' + (await envio.text()).slice(0, 200));
  return (await envio.json()).id;
}

// Manda el archivo de Drive al navegador, por partes.
async function enviarDesdeDrive(driveId, res) {
  let { token } = await obtenerLlave();
  let r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    ({ token } = await obtenerLlave(true));
    r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!r.ok) throw new Error('Drive (descarga): ' + r.status);
  const largo = r.headers.get('content-length');
  if (largo) res.setHeader('Content-Length', largo);
  await new Promise((ok, mal) => Readable.fromWeb(r.body).on('error', mal).pipe(res).on('finish', ok).on('error', mal));
}

// Manda a la papelera el archivo anterior al reemplazarlo (no se borra definitivo).
async function papeleraDrive(driveId) {
  try {
    const { token } = await obtenerLlave();
    await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?supportsAllDrives=true`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true })
    });
  } catch (e) { console.error('No se pudo mandar a la papelera', driveId, e.message); }
}

module.exports = { driveConfigurado, subirADrive, enviarDesdeDrive, papeleraDrive };
