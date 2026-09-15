// cart.js — Pedido actual en pantalla. No persiste como venta hasta el cobro.

const Cart = (() => {
  let lineas = []; // {tipo, id, nombre, precioUnitario, precioMaestro, cantidad}
  let descuentoGeneral = 0; // pesos, aplicado sobre el subtotal
  let totalFinalManual = null; // si se ingresó "Total final" directamente

  function subtotal() {
    return lineas.reduce((acc, l) => acc + l.precioUnitario * l.cantidad, 0);
  }

  function totalCobrar() {
    if (totalFinalManual !== null) return totalFinalManual;
    return Math.max(0, subtotal() - descuentoGeneral);
  }

  function descuentoAplicado() {
    if (totalFinalManual !== null) return Math.max(0, subtotal() - totalFinalManual);
    return descuentoGeneral;
  }

  function buscarLinea(tipo, id) {
    return lineas.find((l) => l.tipo === tipo && l.id === id);
  }

  function agregarUnidad(item, tipo) {
    let linea = buscarLinea(tipo, item.ID || item.IDCombo);
    const precio = tipo === 'Articulo' ? item.PVenta : item.PrecioVenta;
    const nombre = tipo === 'Articulo' ? item.Articulo : item.Nombre;
    const id = tipo === 'Articulo' ? item.ID : item.IDCombo;
    if (linea) {
      linea.cantidad += 1;
    } else {
      linea = { tipo, id, nombre, precioUnitario: precio, precioMaestro: precio, cantidad: 1 };
      lineas.push(linea);
    }
    limpiarDescuentoManualSiCorresponde();
    return linea;
  }

  function setCantidad(tipo, id, cantidad) {
    const linea = buscarLinea(tipo, id);
    if (!linea) return;
    if (cantidad <= 0) {
      eliminarLinea(tipo, id);
      return;
    }
    linea.cantidad = cantidad;
    limpiarDescuentoManualSiCorresponde();
  }

  function eliminarLinea(tipo, id) {
    lineas = lineas.filter((l) => !(l.tipo === tipo && l.id === id));
    limpiarDescuentoManualSiCorresponde();
  }

  function modificarPrecioLinea(tipo, id, nuevoPrecio) {
    const linea = buscarLinea(tipo, id);
    if (!linea) return;
    linea.precioUnitario = nuevoPrecio;
    limpiarDescuentoManualSiCorresponde();
  }

  function aplicarTotalFinal(valor) {
    totalFinalManual = valor;
    descuentoGeneral = 0;
  }

  function aplicarDescuentoGeneral(valor) {
    descuentoGeneral = valor;
    totalFinalManual = null;
  }

  function limpiarDescuentoManualSiCorresponde() {
    // Si cambia la composición del pedido después de fijar un total manual,
    // se mantiene el monto de descuento fijo en pesos, no el total, para no
    // generar totales inconsistentes silenciosamente.
    if (totalFinalManual !== null) {
      descuentoGeneral = Math.max(0, subtotal() - totalFinalManual);
      totalFinalManual = null;
    }
  }

  function vaciar() {
    lineas = [];
    descuentoGeneral = 0;
    totalFinalManual = null;
  }

  function cargarEstado(estado) {
    lineas = estado.lineas || [];
    descuentoGeneral = estado.descuentoGeneral || 0;
    totalFinalManual = estado.totalFinalManual ?? null;
  }

  function exportarEstado() {
    return {
      lineas: JSON.parse(JSON.stringify(lineas)),
      descuentoGeneral,
      totalFinalManual,
    };
  }

  function estaVacio() {
    return lineas.length === 0;
  }

  function getLineas() {
    return lineas;
  }

  return {
    agregarUnidad, setCantidad, eliminarLinea, modificarPrecioLinea,
    aplicarTotalFinal, aplicarDescuentoGeneral, vaciar,
    cargarEstado, exportarEstado, estaVacio, getLineas,
    subtotal, totalCobrar, descuentoAplicado,
  };
})();

window.Cart = Cart;
