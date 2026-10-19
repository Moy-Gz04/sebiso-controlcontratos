// =========================================================
// config.js
// ÚNICO archivo que tienes que editar antes de subir el
// frontend a Netlify: pon aquí la URL real de tu backend
// desplegado en Render (sin "/" al final).
// =========================================================

const API_BASE_URL = 'https://sebiso-controlcontratos.onrender.com/api';

// Catálogo de unidades presupuestales (UP): número -> nombre oficial
const CATALOGO_UP = {
  "01": "SECRETARÍA DE BIENESTAR E INCLUSIÓN SOCIAL",
  "04": "DIRECCIÓN GENERAL DE FOMENTO ARTESANAL",
  "05": "SUBSECRETARÍA DE INCLUSIÓN Y DESARROLLO",
  "06": "DIRECCIÓN GENERAL DE OPERACIÓN Y LOGÍSTICA DE PROGRAMAS",
  "07": "DIRECCIÓN GENERAL DE ATENCIÓN AL MIGRANTE",
  "08": "DIRECCIÓN GENERAL DE ASISTENCIA, ATENCIÓN Y PROTECCIÓN",
  "12": "DIRECCIÓN GENERAL DE PROSPECTIVA PLANEACIÓN Y EVALUACIÓN DE LOS PROGRAMAS SOCIALES",
  "13": "SUBSECRETARÍA DE PARTICIPACIÓN SOCIAL Y FOMENTO ARTESANAL",
  "14": "DIRECCIÓN GENERAL DE INCLUSIÓN PARA LAS PERSONAS CON DISCAPACIDAD",
  "15": "SUBSECRETARÍA DE DESARROLLO SOCIAL Y HUMANO",
  "16": "DIRECCIÓN GENERAL DE SERVIDORES DEL PUEBLO"
};
const opcionesUP = (sel = '') => '<option value="">Sin asignar</option>' + Object.entries(CATALOGO_UP).map(([n, nombre]) => `<option value="${n}"${n === sel ? ' selected' : ''}>${n} · ${nombre}</option>`).join('');

// Nombre de UP en minúsculas con inicial mayúscula (sin capitalizar de, del, la, y, e…)
const nombreUPBonito = (n) => String((typeof CATALOGO_UP !== 'undefined' && CATALOGO_UP[n]) || '').toLowerCase().split(' ').map((w, i) => (i > 0 && ['de', 'del', 'la', 'las', 'los', 'y', 'e', 'en', 'para', 'al'].includes(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
