// =========================================================
// app.js
// Punto de entrada: login/logout, navegación entre Contratos
// y Pedidos, y el cableado de eventos de las tarjetas del
// listado de Contratos. Pedidos tiene su propio wiring en
// pedidos-app.js.
// =========================================================

async function irAContratos() {
  mostrarPantalla('pantalla-contratos');
  marcarNavActivo('contratos');
  await renderListadoContratos();
}

function marcarNavActivo(seccion) {
  document.querySelectorAll('[data-nav]').forEach(item => {
    item.classList.toggle('activo', item.dataset.nav === seccion);
  });
}

document.querySelectorAll('[data-nav="contratos"]').forEach(item => item.addEventListener('click', irAContratos));
document.querySelectorAll('[data-nav="pedidos"]').forEach(item => item.addEventListener('click', irAPedidos));

// ---------- Login ----------

document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const password = document.getElementById('login-password').value;
  const error = document.getElementById('login-error');
  const boton = e.target.querySelector('button[type="submit"]');

  error.textContent = '';
  boton.disabled = true;
  boton.textContent = 'Ingresando…';
  try {
    await Store.login(usuario, password);
    document.querySelectorAll('.sesion-usuario strong').forEach(el => el.textContent = usuario);
    await irAContratos();
  } catch (err) {
    error.textContent = err.message;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Ingresar';
  }
});

function cerrarSesion() {
  Store.cerrarSesion();
  document.getElementById('form-login').reset();
  mostrarPantalla('pantalla-login');
}
document.querySelectorAll('[data-cerrar-sesion]').forEach(btn => btn.addEventListener('click', cerrarSesion));

// ---------- Eventos de las tarjetas del listado de Contratos ----------

function adjuntarEventosListado() {
  const contenedor = document.getElementById('lista-contratos');

  contenedor.querySelectorAll('[data-toggle-tarjeta]').forEach(header => {
    header.addEventListener('click', () => {
      const id = Number(header.dataset.toggleTarjeta);
      if (tarjetasExpandidas.has(id)) tarjetasExpandidas.delete(id);
      else tarjetasExpandidas.add(id);
      renderListadoContratos();
    });
  });

  contenedor.querySelectorAll('[data-editar-generales]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.editarGenerales);
      let contratos;
      try { contratos = await Store.listarContratos(); } catch (err) { mostrarAviso(err.message, true); return; }
      const c = contratos.find(x => x.id === id);
      const form = document.getElementById('form-editar-generales');
      form.dataset.contratoId = id;
      const dg = c.datosGenerales;
      form.reset();

      const modal = document.getElementById('modal-editar-generales');
      modal.querySelector('h2').textContent = dg ? 'Editar datos generales' : 'Registrar datos generales';
      modal.querySelector('.modal-subtitulo').textContent = dg
        ? 'Actualiza la información general del contrato.'
        : 'Captura la información general de este contrato.';

      if (dg) {
        form.noContrato.value = dg.noContrato;
        form.noRequisicion.value = dg.noRequisicion;
        form.fecha.value = dg.fecha;
        form.proveedor.value = dg.proveedor;
        form.descripcion.value = dg.descripcion;
        form.modoFacturacion.value = dg.modoFacturacion;
        form.tieneAnticipo.value = dg.tieneAnticipo ? 'si' : 'no';
        form.montoAnticipo.value = dg.montoAnticipo || '';
        form.numPeriodos.value = dg.numPeriodos || '';
      }
      actualizarVisibilidadCampos(form);
      abrirModal('modal-editar-generales');
    });
  });

  contenedor.querySelectorAll('[data-registrar-oficio]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.registrarOficio);
      const form = document.getElementById('form-modal-oficio');
      form.reset();
      form.dataset.contratoId = id;
      abrirModal('modal-registrar-oficio');
    });
  });

  contenedor.querySelectorAll('[data-eliminar-contrato]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.eliminarContrato);
      pedirConfirmacion({
        titulo: 'Eliminar contrato',
        mensaje: '¿Quieres eliminar este contrato por completo? Esta acción no se puede deshacer.',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await Store.eliminarContrato(id);
            tarjetasExpandidas.delete(id);
            await renderListadoContratos();
            mostrarAviso('Contrato eliminado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });

  contenedor.querySelectorAll('[data-eliminar-oficio]').forEach(btn => {
    btn.addEventListener('click', () => {
      const contratoId = Number(btn.dataset.contratoId);
      const oficioId = Number(btn.dataset.eliminarOficio);
      pedirConfirmacion({
        titulo: 'Eliminar oficio',
        mensaje: '¿Quieres eliminar este oficio? El monto total del contrato se recalculará.',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await Store.eliminarOficio(contratoId, oficioId);
            await renderListadoContratos();
            mostrarAviso('Oficio eliminado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });

  contenedor.querySelectorAll('[data-toggle-periodo]').forEach(header => {
    header.addEventListener('click', () => {
      const body = document.getElementById(`periodo-body-${header.dataset.togglePeriodo}`);
      body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });
  });

  contenedor.querySelectorAll('.form-factura').forEach(form => {
    form.addEventListener('click', (e) => e.stopPropagation());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contratoId = Number(form.dataset.contratoId);
      const periodo = {
        tipo: form.dataset.periodoTipo,
        index: Number(form.dataset.periodoIndex),
        label: form.dataset.periodoLabel
      };
      try {
        await Store.registrarFactura(contratoId, periodo, {
          noFactura: form.noFactura.value.trim(),
          fecha: form.fecha.value,
          monto: form.monto.value
        });
        await renderListadoContratos();
        mostrarAviso('Factura guardada.');
      } catch (err) { mostrarAviso(err.message, true); }
    });
  });

  contenedor.querySelectorAll('[data-eliminar-factura]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const contratoId = Number(btn.dataset.contratoId);
      const facturaId = Number(btn.dataset.eliminarFactura);
      pedirConfirmacion({
        titulo: 'Eliminar factura',
        mensaje: '¿Quieres eliminar esta factura?',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await Store.eliminarFactura(contratoId, facturaId);
            await renderListadoContratos();
            mostrarAviso('Factura eliminada.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });

  contenedor.querySelectorAll('[data-toggle-pago]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const contenedorPago = document.getElementById(`pago-form-${btn.dataset.togglePago}`);
      contenedorPago.style.display = contenedorPago.style.display === 'none' ? 'block' : 'none';
    });
  });

  contenedor.querySelectorAll('.form-fecha-pago').forEach(form => {
    form.addEventListener('click', (e) => e.stopPropagation());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const contratoId = Number(form.dataset.contratoId);
      const facturaId = Number(form.dataset.facturaId);
      try {
        await Store.registrarFechaPago(contratoId, facturaId, form.fechaPago.value);
        await renderListadoContratos();
        mostrarAviso('Fecha de pago registrada.');
      } catch (err) { mostrarAviso(err.message, true); }
    });
  });

  contenedor.querySelectorAll('[data-completar]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.completar);
      pedirConfirmacion({
        titulo: 'Cerrar proceso',
        mensaje: '¿Quieres marcar este contrato como proceso completado? Ya no podrás editarlo como un contrato en curso.',
        textoConfirmar: 'Sí, marcar como completado',
        peligro: false,
        accion: async () => {
          try {
            await Store.marcarCompletado(id);
            await renderListadoContratos();
            mostrarAviso('Contrato marcado como completado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });
}

// ---------- Inicio ----------

if (Store.haySesionGuardada()) {
  document.querySelectorAll('.sesion-usuario strong').forEach(el => el.textContent = Store.usuarioActual() || '—');
  irAContratos();
} else {
  mostrarPantalla('pantalla-login');
}