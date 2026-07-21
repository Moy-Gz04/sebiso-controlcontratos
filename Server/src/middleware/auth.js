// =========================================================
// auth.js
// Middleware que verifica el token JWT en cada petición
// protegida. Se usa como: router.use(requiereAutenticacion);
// =========================================================

const jwt = require('jsonwebtoken');

function requiereAutenticacion(req, res, next) {
  const encabezado = req.headers.authorization;
  if (!encabezado || !encabezado.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, mensaje: 'Token no proporcionado' });
  }
  const token = encabezado.split(' ')[1];
  try {
    req.usuario = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    return res.status(401).json({ ok: false, mensaje: 'Token inválido o expirado' });
  }
}

module.exports = { requiereAutenticacion };