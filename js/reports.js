// reports.js — Resumen de jornada (por día calendario) e Historial de ventas.
// Las ventas Anuladas quedan totalmente excluidas de los totales.

const Reports = (() => {
  function categoriaDeLinea(art) {
    return art ? art.Categoria : null;
  }

  async function ventasDelDia(fecha) {
    const todas = await DB.getByIndex('ventas', 'byFecha', fecha);
    return todas;
  }

  async function resumenJornada(fecha) {
    const ventas = (await ventasDelDia(fecha)).filter((v) => v.Estado === 'Confirmada');

    const resumen = {
      fecha,
      ventaTotal: 0,
      ganancia: 0,
      tickets: ventas.length,
      efectivo: 0,
      transferencia: 0,
      ventasMixtas: 0,
      descuentos: 0,
      albumes: 0,
      figuritas: 0,
      naipes: 0,
      extensiones: 0,
      combos: 0,
    };

    for (const v of ventas) {
      resumen.ventaTotal += Number(v.TotalCobrado || 0);
      resumen.ganancia += Number(v.Ganancia || 0);
      resumen.efectivo += Number(v.Efectivo || 0);
      resumen.transferencia += Number(v.Transferencia || 0);
      resumen.descuentos += Number(v.Descuento || 0);
      if (v.TipoPago === 'Mixto') resumen.ventasMixtas += 1;

      for (const d of v.detalle) {
        if (d.Tipo === 'Combo') {
          resumen.combos += d.Cantidad;
          const componentes = await Stock.componentesDeCombo(d.IDProducto);
          for (const c of componentes) {
            const art = await DB.getByKey('articulos', c.IDArticulo);
            sumarPorCategoria(resumen, categoriaDeLinea(art), c.Cantidad * d.Cantidad);
          }
        } else {
          const art = await DB.getByKey('articulos', d.IDProducto);
          sumarPorCategoria(resumen, categoriaDeLinea(art), d.Cantidad);
        }
      }
    }

    resumen.ticketPromedio = resumen.tickets > 0 ? resumen.ventaTotal / resumen.tickets : 0;
    resumen.efectivoSegunSistema = resumen.efectivo;
    return resumen;
  }

  function sumarPorCategoria(resumen, categoria, cantidad) {
    switch (categoria) {
      case 'Álbumes': resumen.albumes += cantidad; break;
      case 'Figuritas': resumen.figuritas += cantidad; break;
      case 'Naipes': resumen.naipes += cantidad; break;
      case 'Extensiones': resumen.extensiones += cantidad; break;
      default: break;
    }
  }

  async function buscarHistorial({ fecha, texto } = {}) {
    let ventas = await DB.getAll('ventas');
    if (fecha) ventas = ventas.filter((v) => v.Fecha === fecha);
    if (texto) {
      const t = texto.toLowerCase();
      ventas = ventas.filter((v) =>
        v.IDVenta.toLowerCase().includes(t) ||
        String(v.TotalCobrado).includes(t) ||
        v.detalle.some((d) => d.Articulo.toLowerCase().includes(t)));
    }
    return ventas.sort((a, b) => (b.Fecha + b.Hora).localeCompare(a.Fecha + a.Hora));
  }

  return { resumenJornada, buscarHistorial, ventasDelDia };
})();

window.Reports = Reports;
