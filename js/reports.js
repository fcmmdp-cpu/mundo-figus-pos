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

    // Detalle para reposición: cantidad física total consumida por artículo
    // durante la jornada (combos desarmados en sus componentes reales según
    // Detalle Combos, sumados a las ventas individuales del mismo artículo).
    // Usa exclusivamente `ventas` (local, ya filtrado por Confirmada arriba),
    // nunca Google Sheets ni otros canales.
    const reposicionPorArticulo = new Map(); // ID Artículo -> { nombre, cantidad }

    function sumarReposicion(idArticulo, cantidad) {
      if (!idArticulo || !cantidad) return;
      const actual = reposicionPorArticulo.get(idArticulo);
      if (actual) {
        actual.cantidad += cantidad;
      } else {
        reposicionPorArticulo.set(idArticulo, { idArticulo, nombre: null, cantidad });
      }
    }

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
            const cantidadFisica = Number(c.Cantidad) * Number(d.Cantidad);
            sumarPorCategoria(resumen, categoriaDeLinea(art), cantidadFisica);
            sumarReposicion(c.IDArticulo, cantidadFisica);
          }
        } else {
          const art = await DB.getByKey('articulos', d.IDProducto);
          sumarPorCategoria(resumen, categoriaDeLinea(art), d.Cantidad);
          sumarReposicion(d.IDProducto, Number(d.Cantidad));
        }
      }
    }

    // Resolver nombres y ordenar alfabéticamente. Un artículo que ya no
    // exista en el catálogo local (borrado/descontinuado) igual se lista,
    // con su ID como referencia, para no perder de vista esa reposición.
    for (const entry of reposicionPorArticulo.values()) {
      const art = await DB.getByKey('articulos', entry.idArticulo);
      entry.nombre = art ? art.Articulo : `(${entry.idArticulo})`;
    }
    resumen.detalleReposicion = Array.from(reposicionPorArticulo.values())
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));

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

  // Timestamp real para ordenar. Las ventas nuevas ya lo traen (epoch ms,
  // hora local). Las ventas viejas sin este campo (previas a esta corrección)
  // se preservan tal cual están guardadas — no se migran ni se reescriben —
  // y solo para efectos de orden se reconstruye un timestamp aproximado
  // interpretando su Fecha+Hora ya guardadas como hora local.
  function timestampDeVenta(v) {
    if (typeof v.Timestamp === 'number') return v.Timestamp;
    const [y, m, d] = (v.Fecha || '1970-01-01').split('-').map(Number);
    const [hh, mm] = (v.Hora || '00:00').split(':').map(Number);
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0).getTime();
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
    // Orden por timestamp real descendente (más reciente primero), no por
    // texto: comparar "Fecha+Hora" como string rompía justo en el cambio de
    // día, porque una venta de las 23:xx y otra de las 00:xx del día
    // siguiente terminaban bajo la misma Fecha con "23:50" > "00:02".
    return ventas.sort((a, b) => timestampDeVenta(b) - timestampDeVenta(a));
  }

  return { resumenJornada, buscarHistorial, ventasDelDia, timestampDeVenta };
})();

window.Reports = Reports;
