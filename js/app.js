// =========================================================
// app.js
// Punto de entrada: login/logout, navegación entre Contratos
// y Pedidos, y el cableado de eventos de las tarjetas del
// listado de Contratos. Pedidos tiene su propio wiring en
// pedidos-app.js.
// =========================================================

// El menú tiene una sola sección, "Contratos" (el flujo que antes se llamaba Pedidos)
document.querySelectorAll('[data-nav="pedidos"]').forEach(item => item.addEventListener('click', () => irAPedidos()));

// Encabezado superior: nombre de usuario, icono del avatar y fecha de hoy
function pintarSesion(usuario) {
  const nombre = usuario || '—';
  document.querySelectorAll('.sesion-usuario strong').forEach(el => el.textContent = nombre);
  document.querySelectorAll('[data-avatar]').forEach(el => { el.innerHTML = '<i class="ti ti-user" aria-hidden="true"></i>'; });
  const hoy = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  document.querySelectorAll('[data-fecha-hoy]').forEach(el => el.textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1));
}

// ---------- Login ----------

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;
  const error = document.getElementById('login-error');
  const boton = e.target.querySelector('button[type="submit"]');

  error.textContent = '';
  if (!usuario || !password) { error.textContent = 'Completa todos los campos.'; return; }
  // Recordarme: guarda el usuario para la próxima vez y mantiene la sesión abierta
  recordarSesion = document.getElementById('chk-recordar').checked;
  if (recordarSesion) localStorage.setItem('contratos_usuario_recordado', usuario);
  else localStorage.removeItem('contratos_usuario_recordado');
  boton.disabled = true;
  boton.classList.add('cargando');
  try {
    await Store.login(usuario, password);
    pintarSesion(usuario);
    await irAPedidos();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    boton.disabled = false;
    boton.classList.remove('cargando');
  }
});

// Ver / ocultar contraseña y "Recordarme" (solo el usuario, nunca la contraseña)
document.getElementById('btn-ver-pass').addEventListener('click', () => {
  const campo = document.getElementById('login-password');
  const oculto = campo.type === 'password';
  campo.type = oculto ? 'text' : 'password';
  document.getElementById('ico-ojo').className = oculto ? 'ti ti-eye-off' : 'ti ti-eye';
});
['login-usuario', 'login-password'].forEach(id =>
  document.getElementById(id).addEventListener('input', () => { document.getElementById('login-error').textContent = ''; }));
function prepararLogin() {
  const recordado = localStorage.getItem('contratos_usuario_recordado');
  document.getElementById('login-usuario').value = recordado || '';
  document.getElementById('chk-recordar').checked = !!recordado;
}
prepararLogin();

function cerrarSesion() {
  Store.cerrarSesion();
  document.getElementById('form-login').reset();
  prepararLogin();
  mostrarPantalla('pantalla-login');
}
document.querySelectorAll('[data-cerrar-sesion]').forEach(btn => btn.addEventListener('click', cerrarSesion));

// ---------- Inicio ----------

// Se arranca cuando ya cargaron todos los scripts: irAPedidos() vive en
// pedidos-app.js, que se carga despues de este archivo.
document.addEventListener('DOMContentLoaded', () => {
  if (Store.haySesionGuardada()) {
    pintarSesion(Store.usuarioActual());
    irAPedidos();
  } else {
    mostrarPantalla('pantalla-login');
  }
});