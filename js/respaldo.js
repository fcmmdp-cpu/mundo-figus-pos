// respaldo.js — "Exportar respaldo de ventas".
//
// SOLO LECTURA. Lee el store `ventas` con DB.getAll (una transacción readonly),
// arma un JSON en memoria y lo entrega como descarga del navegador.
//   - No escribe en IndexedDB, no toca la cola de sincronización, no usa la red
//     ni el módulo Sync, no borra nada.
//   - Es independiente de app.js: se engancha solo al botón de Configuración.
//     Si este archivo faltara o fallara, el resto de la caja no se entera.
//
// Formato del archivo (versión 1):
//   { formato, version, exportadoEn, origenDB, resumen, huella, ventas: [ ...ventas completas... ] }
// Cada venta se exporta TAL CUAL está en IndexedDB (incluye `detalle`, `Estado`,
// `syncStatus`, costos y ganancias). `huella` es un SHA-256 de JSON.stringify(ventas):
// permite detectar un archivo dañado o editado a mano antes de importarlo.

const Respaldo = (() => {
  const FORMATO = 'mundo-figus-respaldo-ventas';
  const VERSION = 1;

  const pad = (n) => String(n).padStart(2, '0');

  // ---------- Huella de integridad ----------
  async function huella(texto) {
    try {
      if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
        return 'sha256:' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
      }
    } catch (e) { /* cae al respaldo simple */ }
    // Fallback (contextos sin crypto.subtle): FNV-1a de 32 bits sobre las unidades UTF-16.
    let h = 0x811c9dc5;
    for (let i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'fnv1a:' + h.toString(16).padStart(8, '0') + ':' + texto.length;
  }

  // ---------- Resumen del contenido (para mostrarlo y para chequear al importar) ----------
  function resumir(ventas) {
    const r = {
      totalVentas: ventas.length,
      confirmadas: 0, anuladas: 0,
      sincronizadas: 0, pendientes: 0,
      lineasDetalle: 0,
      totalCobradoConfirmadas: 0,
      fechaDesde: null, fechaHasta: null,
    };
    for (const v of ventas) {
      if (v.Estado === 'Anulada') r.anuladas += 1; else r.confirmadas += 1;
      if (v.syncStatus === 'sincronizada') r.sincronizadas += 1; else r.pendientes += 1;
      r.lineasDetalle += Array.isArray(v.detalle) ? v.detalle.length : 0;
      if (v.Estado !== 'Anulada') r.totalCobradoConfirmadas += Number(v.TotalCobrado) || 0;
      if (typeof v.Fecha === 'string') {
        if (r.fechaDesde === null || v.Fecha < r.fechaDesde) r.fechaDesde = v.Fecha;
        if (r.fechaHasta === null || v.Fecha > r.fechaHasta) r.fechaHasta = v.Fecha;
      }
    }
    r.totalCobradoConfirmadas = Math.round(r.totalCobradoConfirmadas * 100) / 100;
    return r;
  }

  // ---------- Armado del respaldo (función pura + huella) ----------
  async function armar(ventas, { ahora = new Date(), origenDB = null } = {}) {
    // Orden estable (por Timestamp y luego IDVenta) para que dos exportaciones
    // del mismo contenido generen exactamente el mismo archivo.
    const lista = ventas.slice().sort((a, b) => {
      const ta = Number(a.Timestamp) || 0, tb = Number(b.Timestamp) || 0;
      if (ta !== tb) return ta - tb;
      return String(a.IDVenta) < String(b.IDVenta) ? -1 : String(a.IDVenta) > String(b.IDVenta) ? 1 : 0;
    });
    return {
      formato: FORMATO,
      version: VERSION,
      exportadoEn: ahora.toISOString(),
      origenDB,
      resumen: resumir(lista),
      huella: await huella(JSON.stringify(lista)),
      ventas: lista,
    };
  }

  function nombreArchivo(d = new Date()) {
    return `respaldo-ventas-mundofigus-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  }

  // ---------- Descarga ----------
  function descargar(texto, nombre) {
    const blob = new Blob([texto], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  // ---------- Exportar: lectura única de `ventas` ----------
  async function exportar() {
    const ventas = await DB.getAll('ventas'); // transacción readonly
    if (!ventas.length) return { ok: false, motivo: 'vacio' };
    const respaldo = await armar(ventas, { origenDB: typeof DB_NAME === 'string' ? DB_NAME : null });
    const nombre = nombreArchivo();
    const texto = JSON.stringify(respaldo);
    descargar(texto, nombre);
    return { ok: true, nombre, bytes: texto.length, resumen: respaldo.resumen };
  }

  // ---------- Pantalla ----------
  function init() {
    const btn = document.getElementById('btnExportarRespaldo');
    const info = document.getElementById('respaldoInfo');
    if (!btn || !info) return;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      info.textContent = 'Preparando respaldo…';
      try {
        const r = await exportar();
        if (!r.ok) {
          info.textContent = 'No hay ventas guardadas en este dispositivo: no se generó ningún archivo.';
        } else {
          const s = r.resumen;
          info.textContent = `Respaldo descargado: ${r.nombre}. ${s.totalVentas} ventas ` +
            `(${s.confirmadas} confirmadas, ${s.anuladas} anuladas, ${s.pendientes} sin sincronizar), ` +
            `${s.fechaDesde} a ${s.fechaHasta}. Buscalo en la carpeta Descargas.`;
        }
      } catch (e) {
        console.error('Respaldo:', e);
        info.textContent = 'No se pudo generar el respaldo. Tus ventas no se modificaron. Detalle: ' + (e && e.message ? e.message : e);
      } finally {
        try { info.scrollIntoView({ block: 'nearest' }); } catch (e) { /* sin scroll */ }
        btn.disabled = false;
      }
    });
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => {
      try { init(); } catch (e) { console.error('Respaldo (init):', e); }
    });
  }

  const API = { FORMATO, VERSION, huella, resumir, armar, nombreArchivo, exportar };
  if (typeof window !== 'undefined') window.Respaldo = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  return API;
})();
