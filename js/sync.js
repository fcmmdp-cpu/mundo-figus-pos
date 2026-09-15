// sync.js — Cola local de operaciones + envío idempotente a Google Apps Script.
// Ninguna falla de red debe bloquear la venta: esto corre siempre en segundo plano.

const Sync = (() => {
  let sincronizando = false;
  const listeners = [];

  function onEstadoCambia(fn) { listeners.push(fn); }
  function avisar() { listeners.forEach((fn) => fn()); }

  async function encolar(op) {
    await DB.put('syncQueue', op);
    avisar();
    if (navigator.onLine) intentarSincronizar();
  }

  async function pendientesCount() {
    const items = await DB.getAll('syncQueue');
    return items.length;
  }

  async function getGasUrl() {
    return DB.getConfig('gasUrl', '');
  }

  async function enviarOperacion(op) {
    const url = await getGasUrl();
    if (!url) throw new Error('No hay URL de Google Apps Script configurada.');

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // evita preflight CORS
      body: JSON.stringify({
        action: op.type === 'venta' ? 'pushVenta' : 'anularVenta',
        opId: op.opId,
        data: op.payload,
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Error desconocido en el servidor');
    return json;
  }

  async function intentarSincronizar() {
    if (sincronizando) return;
    sincronizando = true;
    try {
      const pendientes = await DB.getAll('syncQueue');
      // Se sincroniza en orden de creación para preservar consistencia.
      pendientes.sort((a, b) => a.createdAt - b.createdAt);
      for (const op of pendientes) {
        try {
          await enviarOperacion(op);
          await DB.del('syncQueue', op.opId);
          // Marcar la venta local como sincronizada.
          if (op.type === 'venta') {
            const venta = await DB.getByKey('ventas', op.payload.IDVenta);
            if (venta) { venta.syncStatus = 'sincronizada'; await DB.put('ventas', venta); }
          } else if (op.type === 'anulacion') {
            const venta = await DB.getByKey('ventas', op.payload.IDVenta);
            if (venta) { venta.syncStatus = 'sincronizada'; await DB.put('ventas', venta); }
          }
        } catch (err) {
          op.attempts = (op.attempts || 0) + 1;
          op.lastError = String(err.message || err);
          await DB.put('syncQueue', op);
          // Si falla una, se detiene el lote (probablemente sin conexión) pero no se pierde nada.
          break;
        }
      }
    } finally {
      sincronizando = false;
      avisar();
    }
  }

  window.addEventListener('online', () => intentarSincronizar());

  return { encolar, pendientesCount, intentarSincronizar, onEstadoCambia, getGasUrl };
})();

window.Sync = Sync;
