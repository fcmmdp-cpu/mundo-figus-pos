// app.js — Controlador de UI. Orquesta las pantallas usando los módulos de lógica.

const App = (() => {
  const CATEGORIAS = ['Figuritas', 'Álbumes', 'Naipes', 'Extensiones', 'Otros', 'Combos'];
  let categoriaActual = 'Figuritas';
  let coleccionActual = null;
  let textoBusqueda = '';

  function $(id) { return document.getElementById(id); }
  function fmt(n) {
    return '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
  }

  // ---------- Registro de Service Worker ----------
  function registrarSW() {
    if ('serviceWorker' in navigator) {
      // Ruta y scope absolutos, sin ambigüedad: la app vive en el
      // subdirectorio /mundo-figus-pos/ de GitHub Pages.
      navigator.serviceWorker.register('/mundo-figus-pos/service-worker.js', {
        scope: '/mundo-figus-pos/',
      }).catch(() => {});
    }
  }

  // ---------- Categorías / Productos ----------
  function renderCategorias() {
    const cont = $('categorias');
    cont.innerHTML = '';
    CATEGORIAS.forEach((cat) => {
      const b = document.createElement('button');
      b.textContent = cat;
      if (cat === categoriaActual) b.classList.add('activa');
      b.onclick = () => { categoriaActual = cat; coleccionActual = null; textoBusqueda = ''; $('buscador').value = ''; renderCategorias(); renderProductos(); };
      cont.appendChild(b);
    });
  }

  async function renderProductos() {
    const grid = $('gridProductos');
    grid.innerHTML = '';
    const chipsCont = $('filtroColeccion');

    let items = [];
    let esCombo = categoriaActual === 'Combos';

    if (esCombo) {
      items = await Catalog.combosDeCaja();
    } else {
      items = await Catalog.productosDeCaja(categoriaActual);
    }

    if (textoBusqueda) {
      const t = textoBusqueda.toLowerCase();
      items = items.filter((i) => (esCombo ? i.Nombre : i.Articulo).toLowerCase().includes(t) ||
        (i.Coleccion || '').toLowerCase().includes(t));
    }

    // Chips de colección (solo si hay más de una entre los items visibles).
    const colecciones = [...new Set(items.map((i) => i.Coleccion).filter(Boolean))];
    if (colecciones.length > 1) {
      chipsCont.classList.remove('hidden');
      chipsCont.innerHTML = '';
      const btnTodas = document.createElement('button');
      btnTodas.textContent = 'Todas';
      if (!coleccionActual) btnTodas.classList.add('activa');
      btnTodas.onclick = () => { coleccionActual = null; renderProductos(); };
      chipsCont.appendChild(btnTodas);
      colecciones.forEach((c) => {
        const b = document.createElement('button');
        b.textContent = c;
        if (c === coleccionActual) b.classList.add('activa');
        b.onclick = () => { coleccionActual = c; renderProductos(); };
        chipsCont.appendChild(b);
      });
      if (coleccionActual) items = items.filter((i) => i.Coleccion === coleccionActual);
    } else {
      chipsCont.classList.add('hidden');
    }

    items.forEach((item) => {
      const card = document.createElement('button');
      card.className = 'producto-card' + (esCombo ? ' combo' : '');
      const nombre = esCombo ? item.Nombre : item.Articulo;
      const precio = esCombo ? item.PrecioVenta : item.PVenta;
      card.innerHTML = `<div class="nombre">${nombre}</div><div class="precio">${fmt(precio)}</div>`;
      card.onclick = () => {
        Cart.agregarUnidad(item, esCombo ? 'Combo' : 'Articulo');
        renderCarrito();
      };
      grid.appendChild(card);
    });
  }

  // ---------- Carrito ----------
  function renderCarrito() {
    const cont = $('lineasCarrito');
    cont.innerHTML = '';
    const lineas = Cart.getLineas();

    lineas.forEach((l) => {
      const row = document.createElement('div');
      row.className = 'linea-carrito';
      row.innerHTML = `
        <div class="datos">
          <div class="nombre">${l.nombre}</div>
          <div class="precio-unit">${fmt(l.precioUnitario)} c/u</div>
        </div>
        <div class="cant-controles">
          <button class="menos">−</button>
          <input type="number" inputmode="numeric" class="input-cant" value="${l.cantidad}">
          <button class="mas">+</button>
        </div>
        <div class="subtotal-linea">${fmt(l.precioUnitario * l.cantidad)}</div>
        <button class="btn-eliminar">✕</button>
      `;
      row.querySelector('.menos').onclick = () => cambiarCantidad(l, l.cantidad - 1);
      row.querySelector('.mas').onclick = () => cambiarCantidad(l, l.cantidad + 1);
      row.querySelector('.btn-eliminar').onclick = () => { Cart.eliminarLinea(l.tipo, l.id); renderCarrito(); };
      const input = row.querySelector('.input-cant');
      input.onfocus = () => input.select();
      input.onchange = () => {
        const v = parseInt(input.value, 10);
        cambiarCantidad(l, isNaN(v) ? l.cantidad : v);
      };
      cont.appendChild(row);
    });

    const total = Cart.totalCobrar();
    const descuento = Cart.descuentoAplicado();
    $('totalCarrito').textContent = fmt(total);
    $('btnCobrar').disabled = Cart.estaVacio();

    const descInfo = $('descuentoInfo');
    if (descuento > 0) {
      descInfo.classList.remove('hidden');
      descInfo.textContent = `Subtotal ${fmt(Cart.subtotal())} · Descuento ${fmt(descuento)}`;
    } else {
      descInfo.classList.add('hidden');
    }
  }

  async function cambiarCantidad(linea, nuevaCantidad) {
    if (nuevaCantidad <= 0) {
      Cart.eliminarLinea(linea.tipo, linea.id);
      renderCarrito();
      return;
    }
    const check = await Stock.validarDisponibilidad(linea.tipo, linea.id, nuevaCantidad);
    if (!check.ok) {
      abrirModal('modalStock');
      renderCarrito(); // revertir visualmente al valor válido
      return;
    }
    Cart.setCantidad(linea.tipo, linea.id, nuevaCantidad);
    renderCarrito();
  }

  // ---------- Modales genéricos ----------
  function abrirModal(id) { $(id).classList.remove('hidden'); }
  function cerrarModal(id) { $(id).classList.add('hidden'); }

  // Reemplaza alert(): en una PWA instalada en modo standalone, los diálogos
  // nativos del navegador (alert/confirm/prompt) pueden no mostrarse.
  function mostrarMensaje(texto, ms = 1800) {
    $('modalMensajeTexto').textContent = texto;
    abrirModal('modalMensaje');
    setTimeout(() => cerrarModal('modalMensaje'), ms);
  }

  function wireCierreModales() {
    document.querySelectorAll('[data-close]').forEach((btn) => {
      btn.onclick = () => cerrarModal(btn.dataset.close);
    });
  }

  // ---------- Cobro ----------
  function wireCobro() {
    $('btnCobrar').onclick = () => {
      $('cobroTotal').textContent = fmt(Cart.totalCobrar());
      abrirModal('modalCobro');
    };

    document.querySelectorAll('.btn-pago').forEach((btn) => {
      btn.onclick = async () => {
        const tipo = btn.dataset.pago;
        cerrarModal('modalCobro');
        if (tipo === 'Mixto') {
          $('mixtoTotal').textContent = fmt(Cart.totalCobrar());
          $('mixtoEfectivo').value = '';
          $('mixtoTransferencia').value = '';
          abrirModal('modalMixto');
          return;
        }
        await procesarCobro(tipo);
      };
    });

    $('mixtoEfectivo').oninput = () => {
      const total = Cart.totalCobrar();
      const efvo = parseFloat($('mixtoEfectivo').value) || 0;
      $('mixtoTransferencia').value = Math.max(0, total - efvo);
    };

    $('btnConfirmarMixto').onclick = async () => {
      const total = Cart.totalCobrar();
      const efvo = parseFloat($('mixtoEfectivo').value) || 0;
      const transf = parseFloat($('mixtoTransferencia').value) || 0;
      if (Math.round((efvo + transf) * 100) !== Math.round(total * 100)) {
        alert('Efectivo + Transferencia debe ser igual al total.');
        return;
      }
      cerrarModal('modalMixto');
      await procesarCobro('Mixto', efvo, transf);
    };
  }

  async function procesarCobro(tipoPago, montoEfectivo, montoTransferencia) {
    const lineas = Cart.getLineas();
    const resultado = await Sales.confirmarVenta({
      lineas,
      subtotal: Cart.subtotal(),
      descuento: Cart.descuentoAplicado(),
      totalCobrado: Cart.totalCobrar(),
      tipoPago,
      montoEfectivo,
      montoTransferencia,
    });

    if (!resultado.ok) {
      abrirModal('modalStock');
      return;
    }

    Cart.vaciar();
    renderCarrito();
    renderProductos();
    abrirModal('modalConfirmacion');
    setTimeout(() => cerrarModal('modalConfirmacion'), 1100);
    actualizarBadgeSync();
  }

  // ---------- MÁS: descuento / modificar precio / vaciar ----------
  function wireMas() {
    $('btnMas').onclick = () => abrirModal('modalMas');

    $('btnDescuento').onclick = () => {
      cerrarModal('modalMas');
      $('descSubtotal').textContent = fmt(Cart.subtotal());
      $('inputTotalFinal').value = '';
      abrirModal('modalDescuento');
    };
    $('btnConfirmarDescuento').onclick = () => {
      const v = parseFloat($('inputTotalFinal').value);
      if (!isNaN(v) && v >= 0) {
        Cart.aplicarTotalFinal(v);
        renderCarrito();
      }
      cerrarModal('modalDescuento');
    };

    $('btnModPrecio').onclick = () => {
      cerrarModal('modalMas');
      renderListaPrecios();
      abrirModal('modalPrecioLinea');
    };

    $('btnVaciar').onclick = () => {
      cerrarModal('modalMas');
      if (confirm('¿Vaciar el pedido actual?')) {
        Cart.vaciar();
        renderCarrito();
      }
    };
  }

  function renderListaPrecios() {
    const cont = $('listaLineasPrecio');
    cont.innerHTML = '';
    Cart.getLineas().forEach((l) => {
      const row = document.createElement('div');
      row.className = 'linea-precio-row';
      row.innerHTML = `<span style="flex:1">${l.nombre}</span><input type="number" inputmode="decimal" value="${l.precioUnitario}">`;
      row.querySelector('input').onchange = (e) => {
        const v = parseFloat(e.target.value);
        if (!isNaN(v) && v >= 0) {
          Cart.modificarPrecioLinea(l.tipo, l.id, v);
          renderCarrito();
        }
      };
      cont.appendChild(row);
    });
  }

  // ---------- En espera ----------
  function wireEspera() {
    $('btnEnEspera').onclick = () => {
      if (Cart.estaVacio()) return;
      $('inputEtiquetaEspera').value = '';
      abrirModal('modalGuardarEspera');
    };
    $('btnConfirmarEspera').onclick = async () => {
      await Espera.guardar(Cart.exportarEstado(), $('inputEtiquetaEspera').value);
      Cart.vaciar();
      renderCarrito();
      cerrarModal('modalGuardarEspera');
      actualizarBadgeEspera();
    };

    $('[data-action="espera"]');
    document.querySelector('[data-action="espera"]').onclick = async () => {
      await renderListaEspera();
      abrirModal('modalEspera');
    };
  }

  async function renderListaEspera() {
    const cont = $('listaEspera');
    const items = await Espera.listar();
    cont.innerHTML = items.length ? '' : '<p>No hay pedidos en espera.</p>';
    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'fila-espera';
      const cantLineas = item.estado.lineas.length;
      row.innerHTML = `<span>${item.etiqueta} — ${cantLineas} producto(s)</span>
        <span><button class="recuperar">Recuperar</button><button class="eliminar">✕</button></span>`;
      row.querySelector('.recuperar').onclick = async () => {
        if (!Cart.estaVacio() && !confirm('Esto reemplaza el pedido actual. ¿Continuar?')) return;
        const recuperado = await Espera.recuperar(item.id);
        Cart.cargarEstado(recuperado.estado);
        renderCarrito();
        cerrarModal('modalEspera');
        actualizarBadgeEspera();
      };
      row.querySelector('.eliminar').onclick = async () => {
        await Espera.eliminar(item.id);
        renderListaEspera();
        actualizarBadgeEspera();
      };
      cont.appendChild(row);
    });
  }

  async function actualizarBadgeEspera() {
    const items = await Espera.listar();
    const badge = $('badgeEspera');
    if (items.length > 0) {
      badge.textContent = items.length;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  // ---------- Historial ----------
  function wireHistorial() {
    document.querySelector('[data-action="historial"]').onclick = async () => {
      $('buscadorHistorial').value = '';
      await renderHistorial();
      abrirModal('modalHistorial');
    };
    $('buscadorHistorial').oninput = () => renderHistorial();
  }

  async function renderHistorial() {
    const texto = $('buscadorHistorial').value;
    const ventas = await Reports.buscarHistorial({ texto });
    const cont = $('listaHistorial');
    cont.innerHTML = ventas.length ? '' : '<p>Sin resultados.</p>';
    ventas.forEach((v) => {
      const row = document.createElement('div');
      row.className = 'item-historial' + (v.Estado === 'Anulada' ? ' anulada' : '');
      row.innerHTML = `<span>${v.Fecha} ${v.Hora} — ${v.IDVenta}</span><span>${fmt(v.TotalCobrado)}</span>`;
      row.onclick = () => abrirDetalleVenta(v);
      cont.appendChild(row);
    });
  }

  function abrirDetalleVenta(v) {
    $('detalleVentaId').textContent = v.IDVenta;
    const body = $('detalleVentaBody');
    const lineasHtml = v.detalle.map((d) => `<div>${d.Cantidad} × ${d.Articulo} — ${fmt(d.SubtotalLinea)}</div>`).join('');
    body.innerHTML = `
      <p>${v.Fecha} ${v.Hora} · Estado: <strong>${v.Estado}</strong></p>
      ${lineasHtml}
      <p style="margin-top:10px">Total: <strong>${fmt(v.TotalCobrado)}</strong> (${v.TipoPago})</p>
    `;
    const btnAnular = $('btnAnularVenta');
    btnAnular.style.display = v.Estado === 'Anulada' ? 'none' : 'block';
    btnAnular.onclick = async () => {
      if (!confirm('¿Anular esta venta? Se repondrá el stock.')) return;
      await Sales.anularVenta(v.IDVenta);
      cerrarModal('modalDetalleVenta');
      renderHistorial();
      renderProductos();
      actualizarBadgeSync();
    };
    abrirModal('modalDetalleVenta');
  }

  // ---------- Resumen de jornada ----------
  function wireResumen() {
    document.querySelector('[data-action="resumen"]').onclick = async () => {
      $('fechaResumen').value = new Date().toISOString().slice(0, 10);
      await renderResumen();
      abrirModal('modalResumen');
    };
    $('fechaResumen').onchange = () => renderResumen();
  }

  async function renderResumen() {
    const fecha = $('fechaResumen').value;
    const r = await Reports.resumenJornada(fecha);
    $('resumenBody').innerHTML = `
      <div class="linea-precio-row"><span>Venta total</span><strong>${fmt(r.ventaTotal)}</strong></div>
      <div class="linea-precio-row"><span>Ganancia</span><strong>${fmt(r.ganancia)}</strong></div>
      <div class="linea-precio-row"><span>Tickets</span><strong>${r.tickets}</strong></div>
      <div class="linea-precio-row"><span>Ticket promedio</span><strong>${fmt(r.ticketPromedio)}</strong></div>
      <div class="linea-precio-row"><span>Efectivo</span><strong>${fmt(r.efectivo)}</strong></div>
      <div class="linea-precio-row"><span>Transferencia</span><strong>${fmt(r.transferencia)}</strong></div>
      <div class="linea-precio-row"><span>Ventas mixtas</span><strong>${r.ventasMixtas}</strong></div>
      <div class="linea-precio-row"><span>Descuentos</span><strong>${fmt(r.descuentos)}</strong></div>
      <div class="linea-precio-row"><span>Álbumes</span><strong>${r.albumes}</strong></div>
      <div class="linea-precio-row"><span>Figuritas</span><strong>${r.figuritas}</strong></div>
      <div class="linea-precio-row"><span>Naipes</span><strong>${r.naipes}</strong></div>
      <div class="linea-precio-row"><span>Extensiones</span><strong>${r.extensiones}</strong></div>
      <div class="linea-precio-row"><span>Combos</span><strong>${r.combos}</strong></div>
      <div class="linea-precio-row"><span>Efectivo según sistema</span><strong>${fmt(r.efectivoSegunSistema)}</strong></div>
    `;
  }

  // ---------- Configuración ----------
  function wireConfig() {
    document.querySelector('[data-action="config"]').onclick = async () => {
      $('inputGasUrl').value = await Sync.getGasUrl();
      await actualizarInfoConfig();
      abrirModal('modalConfig');
    };

    $('btnGuardarUrl').onclick = async () => {
      await DB.setConfig('gasUrl', $('inputGasUrl').value.trim());
      alert('URL guardada.');
    };

    $('btnActualizarCatalogo').onclick = async () => {
      try {
        const r = await Catalog.actualizarDesdeInternet();
        alert(`Catálogo actualizado: ${r.articulos} artículos, ${r.combos} combos.`);
        renderProductos();
        await actualizarInfoConfig();
      } catch (e) {
        alert('Error al actualizar catálogo: ' + e.message);
      }
    };

    $('btnSincronizarAhora').onclick = async () => {
      await Sync.intentarSincronizar();
      await actualizarInfoConfig();
      actualizarBadgeSync();
    };

    // Acción de mantenimiento, separada del flujo normal: borra SOLO
    // Historial (ventas) y la cola de sincronización de este dispositivo.
    // No toca articulos, combos, detalleCombos, espera ni config, y no
    // envía ninguna instrucción a Google Sheets.
    // Usa el modal propio de la app (no window.prompt/alert): en una PWA
    // instalada en modo standalone, esos diálogos nativos pueden no
    // mostrarse en absoluto, y la app seguía de largo sin borrar nada ni
    // avisar — esa era la causa real de que Historial no se vaciara.
    $('btnResetPruebas').onclick = async () => {
      const pendientes = await Sync.pendientesCount();
      const totalVentas = (await DB.getAll('ventas')).length;
      if (totalVentas === 0 && pendientes === 0) {
        mostrarMensaje('No hay ventas locales para borrar.');
        return;
      }
      abrirModal('modalConfirmarReset');
    };

    $('btnConfirmarResetPruebas').onclick = async () => {
      cerrarModal('modalConfirmarReset');
      await DB.clearStore('ventas');
      await DB.clearStore('syncQueue');
      renderCarrito();
      renderProductos();
      await actualizarInfoConfig();
      actualizarBadgeSync();
      mostrarMensaje('Ventas locales de prueba eliminadas correctamente.');
    };
  }

  function actualizarBotonSync() {
    const btn = $('btnSincronizarAhora');
    if (!btn) return;
    if (Sync.estaSincronizando()) {
      btn.disabled = true;
      btn.textContent = 'Sincronizando…';
    } else {
      btn.disabled = false;
      btn.textContent = 'SINCRONIZAR AHORA';
    }
  }

  async function actualizarInfoConfig() {
    const last = await DB.getConfig('lastCatalogSync');
    $('catalogoInfo').textContent = last ? `Última actualización: ${new Date(last).toLocaleString('es-AR')}` : 'Todavía no se actualizó el catálogo.';
    const pendientes = await Sync.pendientesCount();
    $('syncInfo').textContent = `Pendientes de sincronizar: ${pendientes}`;
  }

  // ---------- Indicador de sincronización ----------
  async function actualizarBadgeSync() {
    const pendientes = await Sync.pendientesCount();
    const ind = $('syncIndicator');
    if (Sync.estaSincronizando()) {
      ind.textContent = 'Sincronizando…';
    } else if (pendientes === 0) {
      ind.textContent = 'Sincronizado';
    } else {
      ind.textContent = `Pendientes: ${pendientes}`;
    }
    actualizarBotonSync();
  }

  // ---------- Búsqueda ----------
  function wireBusqueda() {
    $('buscador').oninput = () => { textoBusqueda = $('buscador').value; renderProductos(); };
  }

  // ---------- Init ----------
  async function init() {
    registrarSW();
    await DB.openDB();
    renderCategorias();
    await renderProductos();
    renderCarrito();
    wireCierreModales();
    wireCobro();
    wireMas();
    wireEspera();
    wireHistorial();
    wireResumen();
    wireConfig();
    wireBusqueda();
    await actualizarBadgeEspera();
    await actualizarBadgeSync();
    Sync.onEstadoCambia(actualizarBadgeSync);
    setInterval(actualizarBadgeSync, 5000);
    if (navigator.onLine) Sync.intentarSincronizar();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', App.init);
