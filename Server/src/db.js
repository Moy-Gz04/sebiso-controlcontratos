// =========================================================
// db.js
// Pool de conexión a NeonDB (Postgres).
// =========================================================

const { Pool, types } = require('pg');
require('dotenv').config();

// DATE -> string 'YYYY-MM-DD', sin conversión de timezone.
types.setTypeParser(1082, (valor) => valor);

if (!process.env.DATABASE_URL) {
  console.error('Falta DATABASE_URL en el archivo .env');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de PostgreSQL:', err);
});

module.exports = {
  query: (texto, parametros) => pool.query(texto, parametros),
  pool
};