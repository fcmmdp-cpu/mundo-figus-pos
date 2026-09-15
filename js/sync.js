// sync.js — Cola local de operaciones + envío idempotente a Google Apps Script.
// Ninguna falla de red debe bloquear la venta: esto corre siempre en segundo plano.

const Sync = (() => {
  let sincronizando = false;
  const listeners = [];
  let intervaloReintento = null;

  function onEstadoCambia(fn) { listeners.push(fn); }
  function avisar() { listeners.forEach((fn) => fn()); }
  function estaSincronizando() { return sincronizando; }

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

  // Cada operación de la cola se procesa de forma completamente
  // independiente: si una falla, NO corta el intento de las demás.
  // Una operación solo se borra de la cola / se marca "sincronizada"
  // cuando el servidor efectivamente la confirmó (json.ok === true
  // dentro de enviarOperacion). Si el servidor confirmó pero después
  // falla el guardado local de ese resultado, la operación se deja tal
  // cual en la cola: el próximo intento la reenvía (inofensivo, porque
  // el servidor es idempotente por ID Venta) y esta vez sí completa el
  // marcado local.
  // Verificación de respaldo contra el servidor. Se usa SOLO cuando el envío
  // de una operación falla: la falla puede ser puramente de comunicación
  // (corte de red justo al reconectar, o la redirección interna que hacen
  // los Web Apps de Apps Script al responder) mientras la escritura ya se
  // ejecutó del lado del servidor. Antes de resignarse a dejarla pendiente,
  // se confirma el estado real. Es de solo lectura: nunca escribe nada.
  async function verificarExistenciaRemota(idVenta) {
    try {
      const url = await getGasUrl();
      if (!url || !idVenta) return null;
      const res = await fetch(`${url}?action=checkVenta&id=${encodeURIComponent(idVenta)}`);
      if (!res.ok) return null;
      const json = await res.json();
      if (!json.ok) return null;
      return json.data; // { existe, estado }
    } catch (_) {
      return null;
    }
  }

  async function intentarSincronizar() {
    if (sincronizando) return;
    sincronizando = true;
    avisar();
    try {
      const pendientes = await DB.getAll('syncQueue');
      // Se sincroniza en orden de creación para preservar consistencia,
      // pero el orden no condiciona si una operación se llega a intentar.
      pendientes.sort((a, b) => a.createdAt - b.createdAt);

      for (const op of pendientes) {
        let confirmada = false;
        try {
          await enviarOperacion(op);
          confirmada = true;
        } catch (err) {
          op.attempts = (op.attempts || 0) + 1;
          op.lastError = String(err.message || err);

          const idVentaOp = op.payload && op.payload.IDVenta;
          const remoto = await verificarExistenciaRemota(idVentaOp);
          const yaAplicadaEnServidor = remoto && remoto.existe &&
            (op.type === 'venta' || remoto.estado === 'Anulada');

          if (yaAplicadaEnServidor) {
            confirmada = true; // el servidor confirma que ya está: se trata igual que un envío exitoso
          } else {
            try { await DB.put('syncQueue', op); } catch (_) { /* best-effort */ }
            continue; // realmente no está aplicada: se sigue con la siguiente de la cola igual
          }
        }

        if (confirmada) {
          try {
            await DB.del('syncQueue', op.opId);
            const venta = await DB.getByKey('ventas', op.payload.IDVenta);
            if (venta) { venta.syncStatus = 'sincronizada'; await DB.put('ventas', venta); }
          } catch (errLocal) {
            // Ya está confirmada del lado del servidor; queda pendiente
            // solo el registro local, que se completa en el próximo intento.
          }
        }
      }
    } finally {
      sincronizando = false;
      avisar();
    }
  }

  // Reintento al recuperar conexión (evento 'online' del navegador).
  window.addEventListener('online', () => intentarSincronizar());

  // Respaldo del evento 'online', que solo indica que la interfaz de red
  // subió, no que la conexión ya sea utilizable de punta a punta: si el
  // primer intento falla, este reintento periódico —moderado, no agresivo—
  // termina de sincronizar apenas la conexión esté realmente disponible.
  // No hace nada si no hay operaciones pendientes.
  function iniciarReintentoPeriodico() {
    if (intervaloReintento) return;
    intervaloReintento = setInterval(async () => {
      if (!navigator.onLine || sincronizando) return;
      const pendientes = await pendientesCount();
      if (pendientes > 0) intentarSincronizar();
    }, 25000);
  }

  iniciarReintentoPeriodico();

  return {
    encolar, pendientesCount, intentarSincronizar, onEstadoCambia,
    getGasUrl, estaSincronizando,
  };
})();

window.Sync = Sync;
