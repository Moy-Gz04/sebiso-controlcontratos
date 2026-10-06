// =========================================================
// auth.js
// Middleware que verifica el token JWT en cada petición protegida.
// =========================================================

const jwt = require('jsonwebtoken');

function requiereAutenticacion(req, res, next) {
  const encabezado = req.headers.authorization;

  // Enlace temporal para abrir un archivo en otra pestaña: el navegador no
  // puede mandar el encabezado Authorization, así que el token viaja en la
  // URL. Solo se aceptan tokens de uso 'archivo' (duran 2 minutos) y en GET.
  if (!encabezado && req.method === 'GET' && req.query.acceso && /^\/\d+\/(contrato|documento-entrega)$/.test(req.path)) {
    try {
      const datos = jwt.verify(String(req.query.acceso), process.env.JWT_SECRET);
      if (datos.uso !== 'archivo') throw new Error('uso');
      req.usuario = datos;
      return next();
    } catch (error) {
      return res.status(401).json({ ok: false, mensaje: 'El enlace ya expiró; vuelve a abrir el archivo desde el sistema' });
    }
  }

  if (!encabezado || !encabezado.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, mensaje: 'Token no proporcionado' });
  }
  const token = encabezado.split(' ')[1];
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    if (req.usuario.uso === 'archivo') throw new Error('uso');
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, mensaje: 'Token inválido o expirado' });
  }
}

module.exports = { requiereAutenticacion };
