// =========================================================
// server.js
// Arranque del servidor.
//   GET  /api/salud                -> prueba de conexión a la BD
//   POST /api/login                -> autenticación real
//   /api/contratos/...             -> CRUD de contratos
//   /api/pedidos/...               -> CRUD de pedidos (seguimiento por pasos)
// =========================================================

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = require('./db');
const contratosRouter = require('./routes/contratos.routes');
const pedidosRouter = require('./routes/pedidos.routes');

const app = express();

const origenesPermitidos = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: origenesPermitidos.length > 0 ? origenesPermitidos : true
}));
app.use(express.json());

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

app.use('/api/contratos', contratosRouter);
app.use('/api/pedidos', pedidosRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});