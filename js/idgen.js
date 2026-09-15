// idgen.js — IDs únicos e inmutables, robustos sin conexión.
// Nunca se basan en número de fila. Incluyen un ID de dispositivo para evitar
// colisiones entre dos tablets vendiendo al mismo tiempo.

async function getDeviceId() {
  let id = await DB.getConfig('deviceId');
  if (!id) {
    id = 'DEV' + Math.random().toString(36).slice(2, 6).toUpperCase();
    await DB.setConfig('deviceId', id);
  }
  return id;
}

function randomSuffix(len = 4) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres ambiguos
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

async function generarIdVenta() {
  const deviceId = await getDeviceId();
  return `VTA-${deviceId}-${Date.now()}-${randomSuffix()}`;
}

window.IdGen = { generarIdVenta, getDeviceId };
