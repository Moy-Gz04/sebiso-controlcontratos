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
app.use(express.json({ limit: '2mb' }));   // los archivos ya no van en JSON: viajan directo a Drive

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

// ---------- Preferencias de cada usuario (por ahora, las del asistente: encendido y color) ----------
const { requiereAutenticacion } = require('./middleware/auth');
const tablaPreferencias = db.query(`CREATE TABLE IF NOT EXISTS usuario_preferencias (
  usuario_id INTEGER PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
  asistente JSONB NOT NULL DEFAULT '{}'::jsonb,
  actualizado TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`).catch(err => console.error('No se pudo preparar usuario_preferencias:', err.message));

app.get('/api/preferencias', requiereAutenticacion, async (req, res) => {
  try {
    await tablaPreferencias;
    const { rows } = await db.query('SELECT asistente FROM usuario_preferencias WHERE usuario_id = $1', [req.usuario.id]);
    res.json({ ok: true, asistente: rows[0] ? rows[0].asistente : {} });
  } catch (error) {
    console.error('Error en GET /api/preferencias:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudieron leer tus preferencias' });
  }
});

app.put('/api/preferencias', requiereAutenticacion, async (req, res) => {
  const a = (req.body && req.body.asistente) || {};
  const asistente = {};
  if (a.activo !== undefined) asistente.activo = !!a.activo;
  if (a.color !== undefined) {
    if (a.color !== null && a.color !== 'galaxia' && !/^#[0-9a-f]{6}$/i.test(String(a.color))) return res.status(400).json({ ok: false, mensaje: 'El color no es válido' });
    asistente.color = a.color;
  }
  if (a.estrella !== undefined) {
    if (!['guinda', 'dorada'].includes(a.estrella)) return res.status(400).json({ ok: false, mensaje: 'La estrella no es válida' });
    asistente.estrella = a.estrella;
  }
  if (a.gafas !== undefined) {
    if (!['ninguno', 'redondos', 'cuadrados', 'sol', 'corazon', 'gato', 'dorados'].includes(a.gafas)) return res.status(400).json({ ok: false, mensaje: 'Los lentes no son válidos' });
    asistente.gafas = a.gafas;
  }
  if (a.ropa !== undefined) {
    if (!['ninguna', 'mono', 'corbata', 'bufanda', 'saco'].includes(a.ropa)) return res.status(400).json({ ok: false, mensaje: 'La ropa no es válida' });
    asistente.ropa = a.ropa;
  }
  try {
    await tablaPreferencias;
    const { rows } = await db.query(`
      INSERT INTO usuario_preferencias (usuario_id, asistente) VALUES ($1, $2)
      ON CONFLICT (usuario_id) DO UPDATE SET asistente = usuario_preferencias.asistente || EXCLUDED.asistente, actualizado = NOW()
      RETURNING asistente`, [req.usuario.id, JSON.stringify(asistente)]);
    res.json({ ok: true, asistente: rows[0].asistente });
  } catch (error) {
    console.error('Error en PUT /api/preferencias:', error);
    res.status(500).json({ ok: false, mensaje: 'No se pudieron guardar tus preferencias' });
  }
});

app.use('/api/contratos', contratosRouter);
app.use('/api/pedidos', pedidosRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});