// stats.js — Estadísticas de ventas de la caja. SOLO LECTURA.
//
// Reglas de este módulo:
//  - Lee únicamente el store local `ventas` (IndexedDB) y solo cuando la
//    sección Estadísticas se abre (ver stats-ui.js). No escribe nada, no toca
//    syncQueue, no llama a Sync ni a la red: funciona 100% offline.
//  - Todos los indicadores comerciales usan SOLO ventas con Estado
//    "Confirmada". Las anuladas se informan aparte y nunca suman.
//  - No depende del catálogo actual: nombres, cantidades, precios y costos
//    salen de la propia venta (el detalle guarda una copia de cada línea), así
//    que actualizar el catálogo no altera estadísticas de jornadas anteriores.
//  - Las funciones de cálculo son puras (reciben arrays, devuelven datos), lo
//    que permite probarlas fuera del navegador.

const Stats = (() => {
  function num(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : 0;
  }

  function esConfirmada(v) { return !!v && v.Estado === 'Confirmada'; }

  // Minutos desde la medianoche, en hora LOCAL. `Hora` ya se guarda en hora
  // local ("HH:MM"); si faltara, se usa el Timestamp (epoch ms).
  function minutoDelDia(v) {
    const m = /^(\d{1,2}):(\d{2})/.exec(v.Hora || '');
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    if (typeof v.Timestamp === 'number') {
      const d = new Date(v.Timestamp);
      return d.getHours() * 60 + d.getMinutes();
    }
    return null;
  }

  function ordenCronologico(a, b) {
    return String(a.Fecha || '').localeCompare(String(b.Fecha || '')) ||
      ((minutoDelDia(a) || 0) - (minutoDelDia(b) || 0)) ||
      (num(a.Timestamp) - num(b.Timestamp));
  }

  // 'YYYY-MM-DD' de HOY en hora local (no UTC).
  function fechaLocalHoy() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // 'dom 22/11' (corta) o 'domingo 22/11/2026' (larga). Se arma con
  // componentes locales para no desfasar el día por zona horaria.
  function etiquetaFecha(fecha, larga) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha || '');
    if (!m) return String(fecha || '');
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    const dia = d.toLocaleDateString('es-AR', { weekday: larga ? 'long' : 'short' }).replace('.', '');
    return larga ? `${dia} ${m[3]}/${m[2]}/${m[1]}` : `${dia} ${m[3]}/${m[2]}`;
  }

  function particionar(todas) {
    const confirmadas = [];
    const anuladas = [];
    for (const v of todas) {
      if (esConfirmada(v)) confirmadas.push(v);
      else if (v && v.Estado === 'Anulada') anuladas.push(v);
    }
    confirmadas.sort(ordenCronologico);
    return { confirmadas, anuladas };
  }

  function filtrarPorFecha(ventas, fecha) {
    return fecha ? ventas.filter((v) => v.Fecha === fecha) : ventas;
  }

  // Jornadas (fechas) con al menos una venta confirmada, de la más vieja a la más nueva.
  function jornadas(confirmadas) {
    const mapa = new Map();
    for (const v of confirmadas) {
      const j = mapa.get(v.Fecha) || { fecha: v.Fecha, tickets: 0, facturacion: 0 };
      j.tickets += 1;
      j.facturacion += num(v.TotalCobrado);
      mapa.set(v.Fecha, j);
    }
    return Array.from(mapa.values()).sort((a, b) => a.fecha.localeCompare(b.fecha));
  }

  function mediana(valores) {
    if (!valores.length) return 0;
    const s = valores.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  }

  // Indicadores generales de un conjunto de ventas CONFIRMADAS.
  // `unidades` = unidades vendidas tal como se cobraron (un combo cuenta 1
  // unidad de combo; no se desarma, para no depender del catálogo actual).
  function kpis(ventas) {
    let facturacion = 0, ganancia = 0, costo = 0, descuentos = 0;
    let efectivo = 0, transferencia = 0, unidades = 0, unidadesCombos = 0, maximo = 0;
    const totales = [];
    for (const v of ventas) {
      const t = num(v.TotalCobrado);
      totales.push(t);
      facturacion += t;
      ganancia += num(v.Ganancia);
      costo += num(v.CostoTotal);
      descuentos += num(v.Descuento);
      efectivo += num(v.Efectivo);
      transferencia += num(v.Transferencia);
      if (t > maximo) maximo = t;
      for (const d of (v.detalle || [])) {
        const q = num(d.Cantidad);
        unidades += q;
        if (d.Tipo === 'Combo') unidadesCombos += q;
      }
    }
    const tickets = ventas.length;
    return {
      tickets,
      facturacion,
      ganancia,
      costo,
      margen: facturacion > 0 ? (ganancia / facturacion) * 100 : 0,
      ticketPromedio: tickets > 0 ? facturacion / tickets : 0,
      ticketMediana: mediana(totales),
      ticketMaximo: maximo,
      unidades,
      unidadesCombos,
      unidadesPorTicket: tickets > 0 ? unidades / tickets : 0,
      descuentos,
      efectivo,
      transferencia,
    };
  }

  // 24 casilleros (0..23) con facturación, ganancia y tickets por hora local.
  function porHora(ventas) {
    const horas = Array.from({ length: 24 }, (_, h) => ({
      hora: h, facturacion: 0, ganancia: 0, tickets: 0, unidades: 0, ticketPromedio: 0,
    }));
    for (const v of ventas) {
      const min = minutoDelDia(v);
      if (min === null) continue;
      const h = horas[Math.min(23, Math.floor(min / 60))];
      h.facturacion += num(v.TotalCobrado);
      h.ganancia += num(v.Ganancia);
      h.tickets += 1;
      for (const d of (v.detalle || [])) h.unidades += num(d.Cantidad);
    }
    horas.forEach((h) => { h.ticketPromedio = h.tickets > 0 ? h.facturacion / h.tickets : 0; });
    return horas;
  }

  // Rango de horas con datos [primera, última], o null si no hay.
  function rangoHoras(horas) {
    let min = null, max = null;
    horas.forEach((h) => {
      if (h.tickets > 0) { if (min === null) min = h.hora; max = h.hora; }
    });
    return min === null ? null : { min, max };
  }

  // Acumulado a lo largo del día. metrica: 'facturacion' | 'ganancia'.
  // Devuelve un punto por venta: { x: minutos desde medianoche, y: acumulado }.
  function acumulado(ventasDeUnDia, metrica) {
    const orden = ventasDeUnDia.slice().sort(ordenCronologico);
    let acc = 0;
    const puntos = [];
    for (const v of orden) {
      const min = minutoDelDia(v);
      if (min === null) continue;
      acc += metrica === 'ganancia' ? num(v.Ganancia) : num(v.TotalCobrado);
      puntos.push({ x: min, y: acc });
    }
    return puntos;
  }

  // Un resumen por jornada, en orden cronológico.
  function porJornada(confirmadas) {
    return jornadas(confirmadas).map((j) => ({
      fecha: j.fecha,
      ...kpis(filtrarPorFecha(confirmadas, j.fecha)),
    }));
  }

  function variacion(a, b) {
    return b === 0 ? null : ((a - b) / b) * 100;
  }

  // Compara dos jornadas. `delta` = variación % de A respecto de B (null si B es 0).
  function comparar(confirmadas, fechaA, fechaB) {
    const a = kpis(filtrarPorFecha(confirmadas, fechaA));
    const b = kpis(filtrarPorFecha(confirmadas, fechaB));
    const delta = {};
    ['facturacion', 'ganancia', 'tickets', 'ticketPromedio', 'unidades', 'descuentos'].forEach((k) => {
      delta[k] = variacion(a[k], b[k]);
    });
    delta.margen = a.margen - b.margen; // diferencia en puntos porcentuales
    return { a, b, delta };
  }

  // Ranking de productos a partir de las líneas de detalle de cada venta.
  // metrica: 'unidades' | 'facturacion' (neta de descuentos) | 'ganancia'.
  // tipo: 'todos' | 'articulo' | 'combo'.
  function topProductos(ventas, { metrica = 'unidades', tipo = 'todos', limite = 10 } = {}) {
    const mapa = new Map();
    for (const v of ventas) {
      for (const d of (v.detalle || [])) {
        const esCombo = d.Tipo === 'Combo';
        if (tipo === 'combo' && !esCombo) continue;
        if (tipo === 'articulo' && esCombo) continue;
        const key = `${esCombo ? 'C' : 'A'}|${d.IDProducto}`;
        const p = mapa.get(key) || {
          key, esCombo, id: d.IDProducto, nombre: d.Articulo || String(d.IDProducto),
          unidades: 0, facturacion: 0, ganancia: 0,
        };
        p.unidades += num(d.Cantidad);
        p.facturacion += num(d.SubtotalLinea) - num(d.DescuentoLinea);
        p.ganancia += num(d.GananciaLinea);
        mapa.set(key, p);
      }
    }
    const lista = Array.from(mapa.values()).sort((x, y) =>
      (y[metrica] - x[metrica]) || x.nombre.localeCompare(y.nombre, 'es', { sensitivity: 'base' }));
    return { items: lista.slice(0, limite), totalDistintos: lista.length };
  }

  // Distribución de importes de ticket en rangos de ancho "redondo".
  function distribucionTickets(ventas) {
    const totales = ventas.map((v) => num(v.TotalCobrado));
    if (!totales.length) return { paso: 0, rangos: [] };
    const maximo = Math.max(...totales);
    const candidatos = [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000, 250000, 500000, 1000000];
    let paso = candidatos[candidatos.length - 1];
    for (const c of candidatos) {
      if (Math.floor(maximo / c) + 1 <= 10) { paso = c; break; }
    }
    const cantidad = Math.floor(maximo / paso) + 1;
    const rangos = Array.from({ length: cantidad }, (_, i) => ({ desde: i * paso, hasta: (i + 1) * paso, cantidad: 0 }));
    totales.forEach((t) => { rangos[Math.floor(t / paso)].cantidad += 1; });
    return { paso, rangos };
  }

  function anuladasInfo(anuladas, fecha) {
    const lista = filtrarPorFecha(anuladas, fecha);
    return { cantidad: lista.length, monto: lista.reduce((acc, v) => acc + num(v.TotalCobrado), 0) };
  }

  // Estado del historial local (para mostrar qué cubren las estadísticas).
  function historialInfo(todas) {
    let primera = null, ultima = null, sinSincronizar = 0;
    for (const v of todas) {
      if (v.Fecha) {
        if (primera === null || v.Fecha < primera) primera = v.Fecha;
        if (ultima === null || v.Fecha > ultima) ultima = v.Fecha;
      }
      if (v.syncStatus !== 'sincronizada') sinSincronizar += 1;
    }
    return { total: todas.length, primeraFecha: primera, ultimaFecha: ultima, sinSincronizar };
  }

  // ÚNICA lectura de IndexedDB: el store `ventas`, completo, una sola vez.
  async function cargar() {
    const todas = await DB.getAll('ventas');
    const { confirmadas, anuladas } = particionar(todas);
    return { todas, confirmadas, anuladas, historial: historialInfo(todas) };
  }

  return {
    cargar, particionar, filtrarPorFecha, jornadas, kpis, porHora, rangoHoras, acumulado,
    porJornada, comparar, topProductos, distribucionTickets, anuladasInfo, historialInfo,
    minutoDelDia, fechaLocalHoy, etiquetaFecha, mediana,
  };
})();

if (typeof window !== 'undefined') window.Stats = Stats;
if (typeof module !== 'undefined' && module.exports) module.exports = Stats;
