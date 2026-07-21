// =========================================================
// db.js
// Pool de conexión a NeonDB (Postgres). Se reutiliza en
// todos los módulos con: const db = require('./db');
// =========================================================

const { Pool, types } = require('pg');
require('dotenv').config();

// Por defecto, node-postgres convierte las columnas DATE en objetos
// Date de JS (a medianoche UTC), lo que puede "correrse" un día según
// la zona horaria del servidor. Como en todo el sistema las fechas se
// manejan como texto 'YYYY-MM-DD', se desactiva esa conversión.
types.setTypeParser(1082, (valor) => valor);

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el archivo .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // requerido por Neon
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = {
  query: (texto, parametros) => pool.query(texto, parametros),
  pool
};