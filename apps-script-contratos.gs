/* =============================================================
   SEBISO - Apps Script de Control de Contratos
   Se pega en: Extensiones > Apps Script (de un Sheet tuyo, o un
   proyecto nuevo en script.google.com)
   Copia versionada en el repo: apps-script-contratos.gs

   Que hace:
   - tokenDrive: le presta al servidor una llave temporal de Drive y le
     dice en que carpeta guardar. Con esa llave el servidor sube y
     descarga los PDF directo a Drive (por partes, sin limite de 30 MB).
     Protegida con la contrasena SECRETO_SERVIDOR
     (Configuracion del proyecto > Propiedades de la secuencia de comandos).
   - No crea ni comparte carpetas ni archivos: no se manda ningun correo.
   ============================================================= */

/* Carpeta de Drive donde se guardan los contratos y documentos de entrega.
   Creala a mano en tu Drive y pega aqui su ID (lo que va despues de
   /folders/ en la URL). */
var FOLDER_ID_CONTRATOS = 'PEGA_AQUI_EL_ID_DE_LA_CARPETA';

/* ===== Punto de entrada: recibe POST desde el servidor ===== */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    if (data.action === 'tokenDrive') return tokenDrive(data);
    return respuesta({ ok: false, error: 'Accion no valida.' });
  } catch (err) {
    return respuesta({ ok: false, error: String(err) });
  }
}

/* ===== Llave temporal de Drive para el servidor ===== */
function tokenDrive(data) {
  var secreto = PropertiesService.getScriptProperties().getProperty('SECRETO_SERVIDOR');
  if (!secreto || data.secreto !== secreto) {
    return respuesta({ ok: false, error: 'No autorizado.' });
  }
  DriveApp.getFolderById(FOLDER_ID_CONTRATOS); // valida la carpeta y asegura el permiso de Drive
  return respuesta({ ok: true, token: ScriptApp.getOAuthToken(), carpeta: FOLDER_ID_CONTRATOS, expiraEnSeg: 3000 });
}

function respuesta(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===== Pruebas desde el editor ===== */

/* Ejecutar > probarCarpeta: confirma que la carpeta existe y se puede escribir.
   La primera vez Google pide autorizar el acceso a Drive: aceptalo. */
function probarCarpeta() {
  var f = DriveApp.getFolderById(FOLDER_ID_CONTRATOS);
  DriveApp.createFile('prueba-borrame.txt', 'ok').moveTo(f).setTrashed(true);
  Logger.log('OK - carpeta "' + f.getName() + '" lista para guardar contratos');
}

/* Ejecutar > probarContrasena: revisa que SECRETO_SERVIDOR este guardada */
function probarContrasena() {
  var s = PropertiesService.getScriptProperties().getProperty('SECRETO_SERVIDOR');
  Logger.log(s ? 'OK - la contrasena SECRETO_SERVIDOR esta guardada (' + s.length + ' caracteres)' : 'FALTA - no hay SECRETO_SERVIDOR en las propiedades');
}
