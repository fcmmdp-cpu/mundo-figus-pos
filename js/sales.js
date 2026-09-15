// sales.js — Checkout, anulación, y armado de Ventas Nueva / Ventas Detalle.
// La venta se guarda PRIMERO en IndexedDB. Recién después se intenta sincronizar.

const Sales = (() => {
  function hoyFechaHora() {
    const d = new Date();
    const fecha = d.toISOString().slice(0, 10);
    const hora = d.toTimeString().slice(0, 5);
    return { fecha, hora, ts: d.getTime() };
  }

  // Costo unitario congelado de una línea, en el momento de la venta.
  async function costoUnitarioLinea(tipo, id) {
    if (tipo === 'Articulo') {
      const art = await DB.getByKey('articulos', id);
      return art ? Number(art.PCosto || 0) : 0;
    }
    const componentes = await Stock.componentesDeCombo(id);
    let costo = 0;
    for (const c of componentes) {
      const art = await DB.getByKey('articulos', c.IDArticulo);
      costo += (art ? Number(art.PCosto || 0) : 0) * Number(c.Cantidad);
    }
    return costo;
  }

  // Valida stock de TODAS las líneas antes de tocar nada.
  async function validarPedido(lineas) {
    for (const l of lineas) {
      const r = await Stock.validarDisponibilidad(l.tipo, l.id, l.cantidad);
      if (!r.ok) {
        return { ok: false, linea: l };
      }
    }
    return { ok: true };
  }

  // tipoPago: 'Efectivo' | 'Transferencia' | 'Mixto'
  // montoEfectivo / montoTransferencia solo requeridos si Mixto.
  async function confirmarVenta({ lineas, subtotal, descuento, totalCobrado, tipoPago, montoEfectivo, montoTransferencia }) {
    const check = await validarPedido(lineas);
    if (!check.ok) {
      return { ok: false, error: 'STOCK_INSUFICIENTE', linea: check.linea };
    }

    const idVenta = await IdGen.generarIdVenta();
    const { fecha, hora } = hoyFechaHora();

    // Costo total y distribución proporcional del descuento por línea.
    let costoTotal = 0;
    const detalle = [];
    for (const l of lineas) {
      const subtotalLinea = l.precioUnitario * l.cantidad;
      const proporcion = subtotal > 0 ? subtotalLinea / subtotal : 0;
      const descuentoLinea = Math.round(descuento * proporcion * 100) / 100;
      const costoUnit = await costoUnitarioLinea(l.tipo, l.id);
      const costoTotalLinea = costoUnit * l.cantidad;
      costoTotal += costoTotalLinea;
      const totalLineaCobrado = subtotalLinea - descuentoLinea;
      detalle.push({
        IDVenta: idVenta,
        Tipo: l.tipo === 'Articulo' ? 'Artículo' : 'Combo',
        IDProducto: l.id,
        Articulo: l.nombre,
        Cantidad: l.cantidad,
        PrecioUnitario: l.precioUnitario,
        SubtotalLinea: subtotalLinea,
        DescuentoLinea: descuentoLinea,
        CostoUnitario: costoUnit,
        CostoTotal: costoTotalLinea,
        GananciaLinea: totalLineaCobrado - costoTotalLinea,
      });
    }

    const ganancia = totalCobrado - costoTotal;

    const venta = {
      IDVenta: idVenta,
      Fecha: fecha,
      Hora: hora,
      Canal: 'Feria',
      Cliente: '',
      Localidad: '',
      Subtotal: subtotal,
      Descuento: descuento,
      TotalCobrado: totalCobrado,
      Efectivo: tipoPago === 'Efectivo' ? totalCobrado : tipoPago === 'Mixto' ? montoEfectivo : 0,
      Transferencia: tipoPago === 'Transferencia' ? totalCobrado : tipoPago === 'Mixto' ? montoTransferencia : 0,
      TipoPago: tipoPago,
      CostoTotal: costoTotal,
      Ganancia: ganancia,
      Estado: 'Confirmada',
      detalle,
      syncStatus: 'pendiente',
    };

    // 1) Guardar localmente PRIMERO.
    await DB.put('ventas', venta);

    // 2) Descontar stock local inmediatamente (sin esperar red).
    for (const l of lineas) {
      await Stock.ajustarStockLinea(l.tipo, l.id, l.cantidad, -1);
    }

    // 3) Encolar sincronización (idempotente por IDVenta).
    await Sync.encolar({
      opId: `PUSH-${idVenta}`,
      type: 'venta',
      payload: venta,
      createdAt: Date.now(),
      attempts: 0,
    });

    return { ok: true, venta };
  }

  async function anularVenta(idVenta) {
    const venta = await DB.getByKey('ventas', idVenta);
    if (!venta || venta.Estado === 'Anulada') return { ok: false };

    // Reponer stock físico de cada línea.
    for (const d of venta.detalle) {
      const tipo = d.Tipo === 'Combo' ? 'Combo' : 'Articulo';
      await Stock.ajustarStockLinea(tipo, d.IDProducto, d.Cantidad, +1);
    }

    venta.Estado = 'Anulada';
    venta.syncStatus = 'pendiente';
    await DB.put('ventas', venta);

    await Sync.encolar({
      opId: `ANULA-${idVenta}`,
      type: 'anulacion',
      payload: { IDVenta: idVenta },
      createdAt: Date.now(),
      attempts: 0,
    });

    return { ok: true, venta };
  }

  return { confirmarVenta, anularVenta, validarPedido };
})();

window.Sales = Sales;
