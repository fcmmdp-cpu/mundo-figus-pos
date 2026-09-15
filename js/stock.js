// stock.js — Disponibilidad de artículos y combos, y su descuento/reposición local.
// El stock NUNCA se muestra en la caja; solo se usa para validar y descontar.

// Devuelve las líneas de componentes {IDArticulo, Cantidad} de un combo.
async function componentesDeCombo(idCombo) {
  return DB.getByIndex('detalleCombos', 'byCombo', idCombo);
}

// Stock disponible de un combo = MIN( floor(stock_componente / cantidad_requerida) )
async function stockDisponibleCombo(idCombo) {
  const componentes = await componentesDeCombo(idCombo);
  if (!componentes.length) return 0;
  let disponible = Infinity;
  for (const c of componentes) {
    const art = await DB.getByKey('articulos', c.IDArticulo);
    const stockArt = art ? Number(art.Stock || 0) : 0;
    const posible = Math.floor(stockArt / Number(c.Cantidad || 1));
    disponible = Math.min(disponible, posible);
  }
  return disponible === Infinity ? 0 : disponible;
}

// Valida si se puede vender `cantidad` unidades de una línea (artículo o combo).
// Devuelve { ok: bool, motivo }
async function validarDisponibilidad(tipo, id, cantidad) {
  if (tipo === 'Articulo') {
    const art = await DB.getByKey('articulos', id);
    const stock = art ? Number(art.Stock || 0) : 0;
    return { ok: stock >= cantidad, disponible: stock };
  } else {
    const disponible = await stockDisponibleCombo(id);
    return { ok: disponible >= cantidad, disponible };
  }
}

// Descuenta stock local físico. Para combos, expande por sus componentes.
// signo = -1 para descontar (venta), +1 para reponer (anulación).
async function ajustarStockLinea(tipo, id, cantidad, signo) {
  if (tipo === 'Articulo') {
    const art = await DB.getByKey('articulos', id);
    if (!art) return;
    art.Stock = Number(art.Stock || 0) + signo * cantidad;
    await DB.put('articulos', art);
  } else {
    const componentes = await componentesDeCombo(id);
    for (const c of componentes) {
      const art = await DB.getByKey('articulos', c.IDArticulo);
      if (!art) continue;
      art.Stock = Number(art.Stock || 0) + signo * (Number(c.Cantidad) * cantidad);
      await DB.put('articulos', art);
    }
  }
}

window.Stock = {
  componentesDeCombo, stockDisponibleCombo, validarDisponibilidad, ajustarStockLinea,
};
