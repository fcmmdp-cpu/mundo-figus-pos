// espera.js — Guardar/recuperar carritos sin cobrar. No es una venta:
// no descuenta stock ni se sincroniza con Google Sheets.

const Espera = (() => {
  async function guardar(estadoCarrito, etiqueta) {
    const registro = {
      etiqueta: etiqueta || `Pedido ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`,
      estado: estadoCarrito,
      creado: Date.now(),
    };
    return DB.put('espera', registro);
  }

  async function listar() {
    const items = await DB.getAll('espera');
    return items.sort((a, b) => b.creado - a.creado);
  }

  async function recuperar(id) {
    const item = await DB.getByKey('espera', id);
    if (item) await DB.del('espera', id);
    return item;
  }

  async function eliminar(id) {
    return DB.del('espera', id);
  }

  return { guardar, listar, recuperar, eliminar };
})();

window.Espera = Espera;
