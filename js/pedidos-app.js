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
      // aplicarFiltros() limpia la marca; se pone después para animar solo esta tarjeta
      if (tarjetasPedidoExpandidas.has(id)) {
        const cuerpo = document.getElementById(`cuerpo-pedido-${id}`);
        if (cuerpo) cuerpo.classList.add('recien-abierta');
      }
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
      formatearMontoInput(form.montoEstimado);
      formatearMontoInput(form.cantidad);
      form.fechaSolicitud.value = p.fechaSolicitud;
      abrirModal('modal-editar-pedido');
    });
  });

  // Documentos (contrato, oficio de autorización, contrarrecibo, entrega): ver y subir / reemplazar
  contenedor.querySelectorAll('[data-ver-doc]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try { await StorePedidos.abrirDocumento(Number(btn.dataset.pedidoId), btn.dataset.verDoc); }
      catch (err) { mostrarAviso(err.message, true); }
    });
  });
  contenedor.querySelectorAll('[data-subir-doc]').forEach(input => {
    input.addEventListener('change', async () => {
      const archivo = input.files[0];
      if (!archivo) return;
      const id = Number(input.dataset.pedidoId);
      try {
        mostrarAviso('Subiendo documento…');
        await StorePedidos.subirDocumento(id, input.dataset.subirDoc, archivo);
        tarjetasPedidoExpandidas.add(id);
        await renderListadoPedidos();
        mostrarAviso('Documento guardado.');
      } catch (err) { mostrarAviso(err.message, true); }
    });
  });
  // Muestra el nombre del archivo elegido dentro del formulario del paso
  contenedor.querySelectorAll('.form-paso-pedido input[name="documento"]').forEach(input => {
    input.addEventListener('change', () => {
      const etiqueta = input.closest('.zona-archivo').querySelector('[data-nombre-archivo]');
      etiqueta.textContent = input.files[0] ? input.files[0].name : etiqueta.dataset.textoOriginal;
    });
  });

  // Reducción: muestra al momento cuánto se reduce y en cuánto queda
  contenedor.querySelectorAll('input[name="montoEjercido"]').forEach(input => {
    const salida = input.closest('form').querySelector('[data-calculo-reduccion]');
    const calcular = () => {
      const aut = Number(input.dataset.autorizado), ej = numMonto(input.value);
      if (!input.value || isNaN(ej)) { salida.textContent = ''; return; }
      if (ej > aut) { salida.textContent = 'No puede ser mayor al autorizado (' + fmtMoneda.format(aut) + ').'; salida.classList.add('error'); return; }
      const fac = Number(input.dataset.facturado || 0);
      if (ej < fac) { salida.textContent = 'No puede ser menor a lo ya amparado en contrarrecibos (' + fmtMoneda.format(fac) + ').'; salida.classList.add('error'); return; }
      salida.classList.remove('error');
      salida.textContent = 'Reducción: ' + fmtMoneda.format(aut - ej) + ' · el contrato queda en ' + fmtMoneda.format(ej);
    };
    input.addEventListener('input', calcular);
  });

  // Omitir un paso opcional
  contenedor.querySelectorAll('[data-omitir-paso]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.pedidoId);
      pedirConfirmacion({
        titulo: 'Omitir paso',
        mensaje: '¿Este contrato no lleva este paso? Se marcará como omitido y avanzará al siguiente.',
        textoConfirmar: 'Sí, omitir',
        accion: async () => {
          try {
            await StorePedidos.omitirPaso(id, btn.dataset.omitirPaso);
            tarjetasPedidoExpandidas.add(id);
            await renderListadoPedidos();
            mostrarAviso('Paso omitido.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });

  contenedor.querySelectorAll('[data-eliminar-pedido]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.eliminarPedido);
      pedirConfirmacion({
        titulo: 'Eliminar contrato',
        mensaje: '¿Quieres eliminar este contrato por completo? Esta acción no se puede deshacer.',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await StorePedidos.eliminar(id);
            tarjetasPedidoExpandidas.delete(id);
            await renderListadoPedidos();
            mostrarAviso('Contrato eliminado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
    });
  });

  // Formularios de cada paso: data-accion es la ruta del paso en el servidor;
  // los campos se mandan por su "name". Si el paso trae documento, se sube después.
  contenedor.querySelectorAll('.form-paso-pedido').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = Number(form.dataset.pedidoId);
      const boton = form.querySelector('button[type="submit"]');
      const cuerpo = {};
      form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
        if (el.type !== 'file') cuerpo[el.name] = el.value.trim();
      });
      const doc = form.documento && form.documento.files[0];
      try {
        if (doc && doc.size > MAX_CONTRATO_MB * 1024 * 1024) throw new Error(`El documento pesa más de ${MAX_CONTRATO_MB} MB.`);
        boton.disabled = true;
        let rutaDoc = form.dataset.doc;
        if (form.dataset.accion === 'contrarecibo-nuevo') {
          // Los contrarrecibos se agregan a una lista; su documento lleva su número interno
          const r = await StorePedidos.agregarContrarecibo(id, cuerpo);
          rutaDoc = 'documento-contrarecibo-' + r.facturaId;
        } else {
          await StorePedidos.registrarPaso(id, form.dataset.accion, cuerpo);
        }
        let aviso = form.dataset.accion === 'contrarecibo-nuevo' ? 'Contrarrecibo registrado.' : 'Paso registrado.', error = false;
        if (doc && rutaDoc) {
          try { await StorePedidos.subirDocumento(id, rutaDoc, doc); aviso = aviso.replace('.', ' con su documento.'); }
          catch (err) { aviso = 'Paso registrado, pero el documento no se subió: ' + err.message + ' Súbelo desde el detalle.'; error = true; }
        }
        tarjetasPedidoExpandidas.add(id);
        await renderListadoPedidos();
        mostrarAviso(aviso, error);
      } catch (err) {
        boton.disabled = false;
        mostrarAviso(err.message, true);
      }
    });
  });

  // Recordar si "Cantidades del contrato" está desplegada (al recargar la lista se conserva)
  contenedor.querySelectorAll('.detalle-montos').forEach(d => {
    d.addEventListener('toggle', () => {
      const id = Number(d.dataset.montosId);
      if (d.open) tarjetasMontosAbiertas.add(id); else tarjetasMontosAbiertas.delete(id);
    });
  });

  contenedor.querySelectorAll('.detalle-oficios').forEach(d => {
    d.addEventListener('toggle', () => {
      const id = Number(d.dataset.oficiosId);
      if (d.open) tarjetasOficiosAbiertos.add(id); else tarjetasOficiosAbiertos.delete(id);
    });
  });

  // Abrir / cerrar el formulario de un avance de contrarrecibo
  contenedor.querySelectorAll('[data-abrir-cr]').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.dataset.abrirCr);
      if (!panel) return;
      contenedor.querySelectorAll('.fi-oficio').forEach(o => { if (o !== panel) o.hidden = true; });
      panel.hidden = !panel.hidden;
      if (!panel.hidden) { const c = panel.querySelector('input:not([type="hidden"]):not([type="file"])'); if (c) c.focus(); }
    });
  });
  contenedor.querySelectorAll('.form-avance-cr input[name="documento"]').forEach(input => {
    input.addEventListener('change', () => {
      const et = input.closest('.zona-archivo').querySelector('[data-nombre-archivo]');
      et.textContent = input.files[0] ? input.files[0].name : et.dataset.textoOriginal;
    });
  });

  // Avance de cada contrarrecibo: factura, entrega, contabilidad, proceso de pago, pagado
  // (y corrección del contrarrecibo o del oficio de contabilidad). Si trae documento, se sube después.
  const AVISO_CR = {
    factura: 'Factura registrada', entrega: 'Entrega registrada', contabilidad: 'Turnado a contabilidad',
    'inicio-pago': 'Proceso de pago iniciado', pagado: 'Pago registrado',
    contrarecibo: 'Contrarrecibo actualizado', 'oficio-contabilidad': 'Oficio de contabilidad guardado'
  };
  contenedor.querySelectorAll('.form-avance-cr').forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = Number(form.dataset.pedidoId), fid = Number(form.dataset.fid), ruta = form.dataset.ruta;
      const boton = form.querySelector('button[type="submit"]');
      const cuerpo = {};
      form.querySelectorAll('input[name], select[name], textarea[name]').forEach(el => {
        if (el.type !== 'file') cuerpo[el.name] = el.value.trim();
      });
      const doc = form.documento && form.documento.files[0];
      try {
        if (doc && doc.size > MAX_CONTRATO_MB * 1024 * 1024) throw new Error('El documento pesa más de ' + MAX_CONTRATO_MB + ' MB.');
        boton.disabled = true;
        await StorePedidos.avanzarContrarecibo(id, fid, ruta, cuerpo);
        let aviso = (AVISO_CR[ruta] || 'Contrarrecibo actualizado') + '.', error = false;
        if (doc && form.dataset.doc) {
          try { await StorePedidos.subirDocumento(id, form.dataset.doc + '-' + fid, doc); aviso = aviso.replace('.', ' con su documento.'); }
          catch (err) { aviso = 'Se registró, pero el documento no se subió: ' + err.message + ' Súbelo desde el contrarrecibo.'; error = true; }
        }
        tarjetasPedidoExpandidas.add(id);
        await renderListadoPedidos();
        mostrarAviso(aviso, error);
      } catch (err) { boton.disabled = false; mostrarAviso(err.message, true); }
    });
  });

  // Eliminar un contrarrecibo capturado por error
  contenedor.querySelectorAll('[data-eliminar-factura]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = Number(btn.dataset.pedidoId);
      pedirConfirmacion({
        titulo: 'Eliminar contrarrecibo',
        mensaje: '¿Eliminar este contrarrecibo con su factura y sus documentos? Los montos del contrato se recalculan.',
        textoConfirmar: 'Sí, eliminar',
        peligro: true,
        accion: async () => {
          try {
            await StorePedidos.eliminarContrarecibo(id, Number(btn.dataset.eliminarFactura));
            tarjetasPedidoExpandidas.add(id);
            await renderListadoPedidos();
            mostrarAviso('Contrarrecibo eliminado.');
          } catch (err) { mostrarAviso(err.message, true); }
        }
      });
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