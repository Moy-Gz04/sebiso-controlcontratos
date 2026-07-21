// =========================================================
// server.js
// Arranque del servidor.
//   GET  /api/salud                -> prueba de conexión a la BD
//   POST /api/login                -> autenticación real
//   /api/contratos/...             -> CRUD completo (ver contratos.routes.js)
// =========================================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./db');
const contratosRouter = require('./routes/contratos.routes');

const app = express();

// CORS_ORIGIN en .env: dominios separados por coma que pueden llamar a esta API.
// Ej: https://tu-sitio.netlify.app,http://localhost:5500
// Si se deja vacío, se permite cualquier origen (útil solo para pruebas).
const origenesPermitidos = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: origenesPermitidos.length > 0 ? origenesPermitidos : true
}));
app.use(express.json());

// ---------- Salud / prueba de conexión ----------

app.get('/api/salud', async (req, res) => {
  try {
    const resultado = await db.query('SELECT NOW() AS hora_servidor');
    res.json({
      ok: true,
      mensaje: 'Conexión a la base de datos exitosa',
      horaServidor: resultado.rows[0].hora_servidor
    });
  } catch (error) {
    console.error('Error al conectar con la base de datos:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudo conectar a la base de datos' });
  }
});

// ---------- Login ----------

app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;

  if (!usuario || !password) {
    return res.status(400).json({ ok: false, mensaje: 'Usuario y contraseña son requeridos' });
  }

  try {
    const resultado = await db.query(
      'SELECT id, usuario, password_hash FROM usuarios WHERE usuario = $1',
      [usuario]
    );

    if (resultado.rows.length === 0) {
      return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    const usuarioDB = resultado.rows[0];
    const coincide = await bcrypt.compare(password, usuarioDB.password_hash);

    if (!coincide) {
      return res.status(401).json({ ok: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    const token = jwt.sign(
      { id: usuarioDB.id, usuario: usuarioDB.usuario },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({ ok: true, token, usuario: usuarioDB.usuario });
  } catch (error) {
    console.error('Error en /api/login:', error);
    res.status(500).json({ ok: false, mensaje: 'Error del servidor' });
  }
});

// ---------- Contratos / oficios / facturas ----------

app.use('/api/contratos', contratosRouter);

// ---------- Arranque ----------

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});