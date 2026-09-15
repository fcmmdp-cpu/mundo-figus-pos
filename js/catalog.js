// catalog.js — Descarga de Artículos / Combos / Detalle Combos desde Apps Script
// y actualización de la base local. Se usa con Internet, típicamente antes de la feria.

const Catalog = (() => {
  async function actualizarDesdeInternet() {
    const url = await Sync.getGasUrl();
    if (!url) throw new Error('Configurá primero la URL de Google Apps Script.');

    const res = await fetch(`${url}?action=getCatalog`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error al descargar catálogo');

    const { articulos, combos, detalleCombos } = json.data;

    await DB.clearStore('articulos');
    await DB.clearStore('combos');
    await DB.clearStore('detalleCombos');

    await DB.putAll('articulos', articulos.map((a) => ({
      ID: a.ID,
      Articulo: a.Articulo,
      Categoria: a.Categoria,
      Coleccion: a.Coleccion || '',
      PCosto: Number(a.PCosto || 0),
      PVenta: Number(a.PVenta || 0),
      Stock: Number(a.Stock || 0),
      Activo: a.Activo,
      MostrarEnCaja: a.MostrarEnCaja,
    })));

    await DB.putAll('combos', combos.map((c) => ({
      IDCombo: c.IDCombo,
      Nombre: c.Nombre,
      Coleccion: c.Coleccion || '',
      PrecioVenta: Number(c.PrecioVenta || 0),
      Activo: c.Activo,
      CostoCombo: Number(c.CostoCombo || 0),
    })));

    await DB.putAll('detalleCombos', detalleCombos.map((d) => ({
      IDCombo: d.IDCombo,
      IDArticulo: d.IDArticulo,
      Cantidad: Number(d.Cantidad || 0),
    })));

    await DB.setConfig('lastCatalogSync', new Date().toISOString());
    return { articulos: articulos.length, combos: combos.length };
  }

  // Productos visibles en la caja: Activo=Sí, Mostrar en caja=Sí, Stock>0.
  async function productosDeCaja(categoria) {
    const articulos = await DB.getAll('articulos');
    return articulos.filter((a) =>
      esSi(a.Activo) && esSi(a.MostrarEnCaja) && Number(a.Stock) > 0 &&
      (!categoria || a.Categoria === categoria));
  }

  async function combosDeCaja() {
    const combos = await DB.getAll('combos');
    const activos = combos.filter((c) => esSi(c.Activo));
    const conStock = [];
    for (const c of activos) {
      const disp = await Stock.stockDisponibleCombo(c.IDCombo);
      if (disp > 0) conStock.push(c);
    }
    return conStock;
  }

  function esSi(valor) {
    return String(valor || '').trim().toLowerCase() === 'sí' || String(valor || '').trim().toLowerCase() === 'si';
  }

  return { actualizarDesdeInternet, productosDeCaja, combosDeCaja };
})();

window.Catalog = Catalog;
