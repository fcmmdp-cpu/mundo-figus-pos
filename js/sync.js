// sync.js — Cola local de operaciones + envío idempotente a Google Apps Script.
// Ninguna falla de red debe bloquear la venta: la venta siempre se guarda
// local primero. La sincronización en sí es exclusivamente MANUAL: este
// módulo nunca la dispara por su cuenta (ver nota al final del archivo).

const Sync = (() => {
  let sincronizando = false;
  const listeners = [];

  function onEstadoCambia(fn) { listeners.push(fn); }
  function avisar() { listeners.forEach((fn) => fn()); }
  function estaSincronizando() { return sincronizando; }

  // Encola la operación y listo. NO intenta sincronizar automáticamente:
  // a partir de esta versión, la única forma de enviar algo a Google
  // Sheets es tocar "SINCRONIZAR AHORA" en Configuración y confirmar la
  // planilla de destino. La operación queda en syncQueue hasta entonces.
  async function encolar(op) {
    await DB.put('syncQueue', op);
    avisar();
  }

  async function pendientesCount() {
    const items = await DB.getAll('syncQueue');
    return items.length;
  }

  async function getGasUrl() {
    return DB.getConfig('gasUrl', '');
  }

  // Identifica, en el momento, a qué planilla apunta el servidor (ver
  // infoDestino_ en Code.gs). Es el chequeo de seguridad previo a
  // sincronizar o actualizar catálogo: nunca escribe nada, y una falla acá
  // (sin Internet, URL mal configurada, Script Properties sin
  // SPREADSHEET_ID, etc.) se reporta como { ok: false } para que quien
  // llama bloquee la operación en vez de asumir cualquier destino.
  async function obtenerInfoDestino() {
    try {
      const url = await getGasUrl();
      if (!url) return { ok: false, error: 'No hay URL de Google Apps Script configurada.' };
      const res = await fetch(`${url}?action=infoDestino`);
      if (!res.ok) return { ok: false, error: 'HTTP ' + res.status };
      const json = await res.json();
      if (!json.ok || !json.data) return { ok: false, error: (json && json.error) || 'Respuesta inválida del servidor.' };
      return { ok: true, nombre: json.data.nombre, id: json.data.id };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
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

  // IMPORTANTE — sincronización exclusivamente manual (a pedido explícito
  // del usuario): este módulo ya NO dispara intentarSincronizar() por su
  // cuenta bajo ninguna circunstancia. No hay listener de 'online', no hay
  // reintento periódico, y encolar() tampoco la llama. La única vía es que
  // la UI (app.js, botón "SINCRONIZAR AHORA") la invoque directamente,
  // después de que el usuario confirme la planilla de destino. Las
  // operaciones pendientes simplemente se acumulan en syncQueue hasta ese
  // momento — el funcionamiento offline no cambia en nada.

  return {
    encolar, pendientesCount, intentarSincronizar, onEstadoCambia,
    getGasUrl, estaSincronizando, obtenerInfoDestino,
  };
})();

window.Sync = Sync;
