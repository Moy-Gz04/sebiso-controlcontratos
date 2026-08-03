// =========================================================
// pedidos-app.js
// Cableado de eventos de las tarjetas de Pedidos: expandir,
// editar datos, eliminar, avanzar cada paso del proceso, y
// los oficios de ampliación/cancelación.
// =========================================================

async function irAPedidos() {
  mostrarPantalla('pantalla-pedidos');
  await renderListadoPedidos();
}

function adjuntarEventosPedidos() {
  const contenedor = document.getElementById('lista-pedidos');

  contenedor.querySelectorAll('[data-toggle-pedido]').forEach(header => {
    header.addEventListener('click', () => {
      const id = Number(header.dataset.togglePedido);
      if (tarjetasPedidoExpandidas.has(id)) tarjetasPedidoExpandidas.delete(id);
      else tarjetasPedidoExpandidas.add(id);
      aplicarFiltrosPedidos();
    });
  });

  contenedor.querySelectorAll('[data-editar-pedido]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.editarPedido);
      const p = pedidosCache.find(x => x.id === id);
      const form = document.getElementById('form-editar-pedido');
      form.dataset.pedidoId = id;
      form.producto.value = p.producto;
      form.cantidad.value = p.cantidad;
      form.unidadMedida.value = p.unidadMedida || '';
      form.proveedor.value = p.proveedor || '';
      form.areaSolicitante.value = p.areaSolicitante || '';
      form.descripcion.value = p.descripcion || '';
      form.montoEstimado.value = p.montoEstimado || '';
      form.fechaSolicitud.value = p.fechaSolicitud;
      abrirModal('modal-editar-pedido');
    });
  });

  contenedor.querySelectorAll('[data-eliminar-pedido]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.eliminarPedido);
      pedirConfirmacion({
        titulo: 'Eliminar pedido',
        mensaje: '¿Quieres eliminar este pedido por completo? Esta acción no se puede deshacer.',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await StorePedidos.eliminar(id);
            tarjetasPedidoExpandidas.delete(id);
            await renderListadoPedidos();
            mostrarAviso('Pedido eliminado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });

  // Formularios de cada paso (entrega, oficio de adecuación, factura,
  // contabilidad, inicio de pago, pagado) — todos comparten esta clase
  // y usan data-accion para saber a qué endpoint llamar.
  contenedor.querySelectorAll('.form-paso-pedido').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = Number(form.dataset.pedidoId);
      const accion = form.dataset.accion;
      try {
        switch (accion) {
          case 'entrega':
            await StorePedidos.registrarEntrega(id, form.fechaEntrega.value);
            break;
          case 'oficio-adecuacion':
            await StorePedidos.registrarOficioAdecuacion(id, {
              folio: form.folio.value.trim(),
              monto: form.monto.value,
              fecha: form.fecha.value
            });
            break;
          case 'factura':
            await StorePedidos.registrarFactura(id, {
              noFactura: form.noFactura.value.trim(),
              monto: form.monto.value,
              fecha: form.fecha.value
            });
            break;
          case 'contabilidad':
            await StorePedidos.registrarContabilidad(id, form.fechaContabilidad.value);
            break;
          case 'inicio-pago':
            await StorePedidos.registrarInicioPago(id, form.fechaInicioPago.value);
            break;
          case 'pagado':
            await StorePedidos.registrarPagado(id, form.fechaPagado.value);
            break;
        }
        tarjetasPedidoExpandidas.add(id);
        await renderListadoPedidos();
        mostrarAviso('Paso registrado.');
      } catch (err) { mostrarAviso(err.message, true); }
    });
  });

  // Agregar oficio de ampliación/cancelación
  contenedor.querySelectorAll('.form-oficio-pedido').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = Number(form.dataset.pedidoId);
      try {
        await StorePedidos.agregarOficio(id, {
          tipo: form.tipo.value,
          folio: form.folio.value.trim(),
          monto: form.monto.value,
          fecha: form.fecha.value
        });
        tarjetasPedidoExpandidas.add(id);
        await renderListadoPedidos();
        mostrarAviso('Oficio agregado.');
      } catch (err) { mostrarAviso(err.message, true); }
    });
  });

  // Eliminar oficio de ampliación/cancelación
  contenedor.querySelectorAll('[data-eliminar-oficio-pedido]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pedidoId = Number(btn.dataset.pedidoId);
      const oficioId = Number(btn.dataset.eliminarOficioPedido);
      pedirConfirmacion({
        titulo: 'Eliminar oficio',
        mensaje: '¿Quieres eliminar este oficio? El monto disponible se recalculará.',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await StorePedidos.eliminarOficio(pedidoId, oficioId);
            tarjetasPedidoExpandidas.add(pedidoId);
            await renderListadoPedidos();
            mostrarAviso('Oficio eliminado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });
}