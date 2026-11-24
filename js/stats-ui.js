// stats-ui.js — Pantalla "Estadísticas".
//
// Es independiente de app.js a propósito: se engancha sola al botón del menú
// y, si algo fallara acá, el resto de la caja (ventas, catálogo, sincronización)
// ni se entera. Solo lee: las ventas se leen UNA vez al abrir la sección
// (Stats.cargar), los cambios de jornada/pestaña se recalculan sobre esa lectura
// en memoria, y al cerrar se descarta todo. Nunca escribe en IndexedDB y no usa
// la red ni el módulo Sync.

const StatsUI = (() => {
  const $ = (id) => document.getElementById(id);
  const MAX_JORNADAS_BARRAS = 16;

  const TABS = [
    { id: 'hora', label: 'Ventas por hora' },
    { id: 'evo', label: 'Evolución' },
    { id: 'comp', label: 'Comparar jornadas' },
    { id: 'prod', label: 'Productos' },
    { id: 'ticket', label: 'Ticket promedio' },
  ];

  let datos = null;       // lectura única de `ventas`, descartada al cerrar
  let jornadasAsc = [];   // [{fecha, tickets, facturacion}] cronológico
  let estado = null;

  // ---------- Formatos ----------
  const pesos = (n) => Charts.pesos(n);
  const n1 = (n) => (Math.round(n * 10) / 10).toLocaleString('es-AR', { maximumFractionDigits: 1 });
  const entero = (n) => Math.round(n).toLocaleString('es-AR');
  const pct = (n) => n1(n) + ' %';
  const etiqueta = (f) => Stats.etiquetaFecha(f, true);

  // ---------- Pequeños constructores de DOM (todo con textContent) ----------
  function nodo(tag, clase, texto) {
    const e = document.createElement(tag);
    if (clase) e.className = clase;
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function chips(opciones, valor, alElegir) {
    const cont = nodo('div', 'stats-chips');
    opciones.forEach((o) => {
      const b = nodo('button', 'stats-chip' + (o.id === valor ? ' activo' : ''), o.label);
      b.type = 'button';
      b.addEventListener('click', () => alElegir(o.id));
      cont.appendChild(b);
    });
    return cont;
  }

  function seccion(titulo, nota) {
    const s = nodo('section', 'stats-seccion');
    s.appendChild(nodo('h3', null, titulo));
    if (nota) s.appendChild(nodo('p', 'stats-nota', nota));
    return s;
  }

  // ---------- Estado inicial ----------
  function estadoInicial() {
    const desc = jornadasAsc.slice().reverse();
    const hoy = Stats.fechaLocalHoy();
    const inicial = desc.find((j) => j.fecha === hoy) || desc[0];
    const a = inicial ? inicial.fecha : null;
    const idxA = desc.findIndex((j) => j.fecha === a);
    const b = desc[idxA + 1] ? desc[idxA + 1].fecha : (desc[idxA - 1] ? desc[idxA - 1].fecha : null);
    return {
      jornada: a || 'todas',
      tab: 'hora',
      metricaHora: 'facturacion', promedio: false,
      metricaEvo: 'facturacion',
      metricaComp: 'facturacion',
      metricaProd: 'unidades', tipoProd: 'todos',
      compA: a, compB: b,
    };
  }

  const ventasScope = () =>
    Stats.filtrarPorFecha(datos.confirmadas, estado.jornada === 'todas' ? null : estado.jornada);

  // ---------- Encabezado: selector de jornada ----------
  function renderSelector() {
    const sel = $('statsJornada');
    sel.textContent = '';
    const optTodas = nodo('option', null, `Todas las jornadas (${jornadasAsc.length})`);
    optTodas.value = 'todas';
    sel.appendChild(optTodas);
    jornadasAsc.slice().reverse().forEach((j) => {
      const o = nodo('option', null, `${etiqueta(j.fecha)} · ${j.tickets} tickets`);
      o.value = j.fecha;
      sel.appendChild(o);
    });
    sel.value = estado.jornada;
    const idx = jornadasAsc.findIndex((j) => j.fecha === estado.jornada);
    $('statsPrev').disabled = idx <= 0;
    $('statsNext').disabled = idx === -1 || idx >= jornadasAsc.length - 1;
  }

  function elegirJornada(valor) {
    estado.jornada = valor;
    render();
  }

  // ---------- KPIs ----------
  function tile(etiquetaTxt, valor, sub) {
    const t = nodo('div', 'stats-tile');
    t.appendChild(nodo('div', 'stats-tile-et', etiquetaTxt));
    t.appendChild(nodo('div', 'stats-tile-val', valor));
    if (sub) t.appendChild(nodo('div', 'stats-tile-sub', sub));
    return t;
  }

  function renderKpis() {
    const k = Stats.kpis(ventasScope());
    const cont = $('statsKpis');
    cont.textContent = '';
    cont.appendChild(tile('Facturación', pesos(k.facturacion), `Descuentos ${pesos(k.descuentos)}`));
    cont.appendChild(tile('Ganancia', pesos(k.ganancia), `Costo ${pesos(k.costo)}`));
    cont.appendChild(tile('Margen', pct(k.margen), 'sobre facturación'));
    cont.appendChild(tile('Tickets', entero(k.tickets), `${n1(k.unidadesPorTicket)} u. por ticket`));
    cont.appendChild(tile('Ticket promedio', pesos(k.ticketPromedio), `Mediana ${pesos(k.ticketMediana)}`));
    cont.appendChild(tile('Unidades vendidas', entero(k.unidades), `${entero(k.unidadesCombos)} son combos`));
  }

  // ---------- Pestañas ----------
  function renderTabs() {
    const cont = $('statsTabs');
    cont.textContent = '';
    TABS.forEach((t) => {
      const b = nodo('button', 'stats-tab' + (t.id === estado.tab ? ' activo' : ''), t.label);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', t.id === estado.tab ? 'true' : 'false');
      b.addEventListener('click', () => { estado.tab = t.id; renderTabs(); renderPanel(); });
      cont.appendChild(b);
    });
  }

  // ---------- Pie: anuladas e historial ----------
  async function renderPie() {
    const pie = $('statsPie');
    pie.textContent = '';
    const k = Stats.kpis(ventasScope());
    const an = Stats.anuladasInfo(datos.anuladas, estado.jornada === 'todas' ? null : estado.jornada);
    const h = datos.historial;
    pie.appendChild(nodo('div', null,
      `Cobrado: efectivo ${pesos(k.efectivo)} · transferencia ${pesos(k.transferencia)}. ` +
      `Ventas anuladas (excluidas de todos los indicadores): ${an.cantidad} por ${pesos(an.monto)}.`));
    const rango = h.primeraFecha
      ? ` Abarca desde ${etiqueta(h.primeraFecha)} hasta ${etiqueta(h.ultimaFecha)}.` : '';
    const linea = nodo('div', null,
      `Historial guardado en esta tablet: ${entero(h.total)} ventas.${rango} ` +
      `Sin sincronizar: ${entero(h.sinSincronizar)}. Las estadísticas se calculan solo con estas ventas.`);
    pie.appendChild(linea);
    try {
      if (navigator.storage && navigator.storage.persisted) {
        const p = await navigator.storage.persisted();
        if (datos) pie.appendChild(nodo('div', null, `Almacenamiento protegido contra limpieza automática: ${p ? 'sí' : 'no'}.`));
      }
    } catch (_) { /* informativo; si falla, se omite */ }
  }

  // ---------- Pestaña: ventas por hora ----------
  const METRICAS_VALOR = [
    { id: 'facturacion', label: 'Facturación' },
    { id: 'ganancia', label: 'Ganancia' },
    { id: 'tickets', label: 'Tickets' },
  ];

  function renderHora(panel) {
    const sec = seccion('Ventas por hora',
      estado.jornada === 'todas'
        ? 'Suma de todas las jornadas (o promedio por jornada, a elección).'
        : `Jornada: ${etiqueta(estado.jornada)}.`);
    sec.appendChild(chips(METRICAS_VALOR, estado.metricaHora, (id) => { estado.metricaHora = id; renderPanel(); }));
    if (estado.jornada === 'todas' && jornadasAsc.length > 1) {
      sec.appendChild(chips(
        [{ id: 'total', label: 'Total' }, { id: 'promedio', label: 'Promedio por jornada' }],
        estado.promedio ? 'promedio' : 'total',
        (id) => { estado.promedio = id === 'promedio'; renderPanel(); }));
    }
    const grafico = nodo('div');
    const horas = Stats.porHora(ventasScope());
    const rango = Stats.rangoHoras(horas);
    if (!rango) {
      Charts.vacio(grafico, 'No hay ventas en esta selección.');
    } else {
      const dividir = estado.jornada === 'todas' && estado.promedio ? jornadasAsc.length : 1;
      const visibles = horas.slice(rango.min, rango.max + 1);
      const m = estado.metricaHora;
      const valor = (h) => h[m] / dividir;
      const pico = visibles.reduce((a, h) => (h[m] > a[m] ? h : a), visibles[0]);
      const nombrePico = { facturacion: 'facturación', ganancia: 'ganancia', tickets: 'cantidad de tickets' }[m];
      sec.appendChild(nodo('p', 'stats-destacado', `Hora de mayor ${nombrePico}: ${pico.hora} a ${pico.hora + 1} h.`));
      Charts.barras(grafico, {
        titulo: 'Ventas por hora',
        categorias: visibles.map((h) => `${h.hora}h`),
        series: [{ nombre: m, color: Charts.COLOR.a, valores: visibles.map(valor) }],
        formatoEje: m === 'tickets' ? Charts.corto : (v) => '$' + Charts.corto(v),
        formatoValor: m === 'tickets' ? (v) => n1(v) : (v) => '$' + Charts.corto(v),
        entero: m === 'tickets' && dividir === 1,
        describir: (i) => {
          const h = visibles[i];
          return `${h.hora}:00 a ${h.hora}:59 — facturación ${pesos(h.facturacion / dividir)} · ganancia ${pesos(h.ganancia / dividir)} · ` +
            `${n1(h.tickets / dividir)} tickets · ticket promedio ${pesos(h.ticketPromedio)}`;
        },
      });
    }
    sec.appendChild(grafico);
    panel.appendChild(sec);
  }

  // ---------- Pestaña: evolución de facturación ----------
  function barrasPorJornada(cont, { valorDe, formatoEje, formatoValor, describir, entero: esEntero }) {
    const total = jornadasAsc.length;
    const lista = jornadasAsc.slice(-MAX_JORNADAS_BARRAS);
    const sel = lista.findIndex((j) => j.fecha === estado.jornada);
    const stats = lista.map((j) => ({ j, k: Stats.kpis(Stats.filtrarPorFecha(datos.confirmadas, j.fecha)) }));
    Charts.barras(cont, {
      titulo: 'Por jornada',
      categorias: lista.map((j) => Stats.etiquetaFecha(j.fecha).replace(' ', '\n')),
      series: [{ nombre: 'Jornada', color: Charts.COLOR.a, valores: stats.map((s) => valorDe(s.k)) }],
      seleccionado: sel === -1 ? null : sel,
      formatoEje, formatoValor, entero: esEntero,
      describir: (i) => `${etiqueta(lista[i].fecha)} — ${describir(stats[i].k)}`,
      lecturaInicial: 'Tocá una jornada para ver el detalle y seleccionarla.',
      onSelect: (i) => { estado.jornada = lista[i].fecha; render(); },
    });
    return total > MAX_JORNADAS_BARRAS ? `Mostrando las últimas ${MAX_JORNADAS_BARRAS} de ${total} jornadas.` : null;
  }

  const METRICAS_EVO = [
    { id: 'facturacion', label: 'Facturación' },
    { id: 'ganancia', label: 'Ganancia' },
  ];

  function renderEvo(panel) {
    const m = estado.metricaEvo;
    const nombreM = m === 'ganancia' ? 'Ganancia' : 'Facturación';

    const sec1 = seccion(`${nombreM} acumulada durante el día`);
    sec1.appendChild(chips(METRICAS_EVO, m, (id) => { estado.metricaEvo = id; renderPanel(); }));
    const g1 = nodo('div');
    if (estado.jornada === 'todas') {
      Charts.vacio(g1, 'Elegí una jornada arriba (o tocá una barra de abajo) para ver cómo fue creciendo durante el día.');
    } else {
      const puntos = Stats.acumulado(ventasScope(), m);
      if (!puntos.length) {
        Charts.vacio(g1, 'No hay ventas en esta jornada.');
      } else {
        const xMin = Math.floor(puntos[0].x / 60);
        const xMax = Math.max(xMin + 1, Math.ceil(puntos[puntos.length - 1].x / 60));
        Charts.lineas(g1, {
          titulo: `${nombreM} acumulada`,
          series: [{ nombre: etiqueta(estado.jornada), color: Charts.COLOR.a, area: true, puntos }],
          xMin, xMax, formatoEje: (v) => '$' + Charts.corto(v), formatoValor: pesos,
        });
      }
    }
    sec1.appendChild(g1);
    panel.appendChild(sec1);

    const sec2 = seccion(`${nombreM} por jornada`);
    const g2 = nodo('div');
    const nota = barrasPorJornada(g2, {
      valorDe: (k) => k[m],
      formatoEje: (v) => '$' + Charts.corto(v),
      formatoValor: (v) => '$' + Charts.corto(v),
      describir: (k) => `facturación ${pesos(k.facturacion)} · ganancia ${pesos(k.ganancia)} · margen ${pct(k.margen)} · ${k.tickets} tickets`,
    });
    if (nota) sec2.appendChild(nodo('p', 'stats-nota', nota));
    const totalFeria = Stats.kpis(datos.confirmadas);
    sec2.appendChild(nodo('p', 'stats-destacado',
      `Total de ${jornadasAsc.length} jornada(s): facturación ${pesos(totalFeria.facturacion)} · ganancia ${pesos(totalFeria.ganancia)}.`));
    sec2.appendChild(g2);
    panel.appendChild(sec2);
  }

  // ---------- Pestaña: comparar jornadas ----------
  function selectorJornada(valor, alCambiar) {
    const sel = nodo('select', 'stats-select');
    jornadasAsc.slice().reverse().forEach((j) => {
      const o = nodo('option', null, `${etiqueta(j.fecha)} · ${j.tickets} tickets`);
      o.value = j.fecha;
      sel.appendChild(o);
    });
    sel.value = valor;
    sel.addEventListener('change', () => alCambiar(sel.value));
    return sel;
  }

  const FILAS_COMP = [
    { k: 'facturacion', t: 'Facturación', f: pesos },
    { k: 'ganancia', t: 'Ganancia', f: pesos },
    { k: 'margen', t: 'Margen', f: pct, pp: true },
    { k: 'tickets', t: 'Tickets', f: entero },
    { k: 'ticketPromedio', t: 'Ticket promedio', f: pesos },
    { k: 'unidades', t: 'Unidades vendidas', f: entero },
    { k: 'descuentos', t: 'Descuentos', f: pesos, neutro: true },
  ];

  function celdaDelta(fila, d) {
    const td = nodo('td', 'stats-delta');
    if (d === null || d === undefined) { td.textContent = '—'; return td; }
    const redondo = Math.round(d * 10) / 10;
    const flecha = redondo > 0 ? '▲' : redondo < 0 ? '▼' : '=';
    const signo = redondo > 0 ? '+' : '';
    td.textContent = `${flecha} ${signo}${n1(d)}${fila.pp ? ' p.p.' : ' %'}`;
    if (!fila.neutro) td.classList.add(redondo > 0 ? 'sube' : redondo < 0 ? 'baja' : 'igual');
    return td;
  }

  function renderComp(panel) {
    if (jornadasAsc.length < 2) {
      const sec = seccion('Comparar jornadas');
      Charts.vacio(sec.appendChild(nodo('div')), 'Hacen falta al menos dos jornadas con ventas para compararlas.');
      panel.appendChild(sec);
      return;
    }
    if (!jornadasAsc.some((j) => j.fecha === estado.compA)) estado.compA = jornadasAsc[jornadasAsc.length - 1].fecha;
    if (!jornadasAsc.some((j) => j.fecha === estado.compB)) {
      estado.compB = (jornadasAsc[jornadasAsc.length - 2] || jornadasAsc[0]).fecha;
    }
    const sec = seccion('Comparar jornadas');
    const fila = nodo('div', 'stats-comp-selectores');
    const ca = nodo('label', 'stats-comp-sel', 'A: ');
    ca.style.color = Charts.COLOR.aOsc;
    ca.appendChild(selectorJornada(estado.compA, (v) => { estado.compA = v; renderPanel(); }));
    const cb = nodo('label', 'stats-comp-sel', 'B: ');
    cb.style.color = Charts.COLOR.b;
    cb.appendChild(selectorJornada(estado.compB, (v) => { estado.compB = v; renderPanel(); }));
    fila.appendChild(ca);
    fila.appendChild(cb);
    sec.appendChild(fila);
    if (estado.compA === estado.compB) sec.appendChild(nodo('p', 'stats-nota', 'Elegiste la misma jornada en A y en B.'));

    const r = Stats.comparar(datos.confirmadas, estado.compA, estado.compB);
    const tabla = nodo('table', 'stats-tabla');
    const cab = nodo('tr');
    cab.appendChild(nodo('th', null, ''));
    cab.appendChild(nodo('th', null, `A · ${Stats.etiquetaFecha(estado.compA)}`));
    cab.appendChild(nodo('th', null, `B · ${Stats.etiquetaFecha(estado.compB)}`));
    cab.appendChild(nodo('th', null, 'A vs B'));
    tabla.appendChild(cab);
    FILAS_COMP.forEach((f) => {
      const tr = nodo('tr');
      tr.appendChild(nodo('td', 'stats-fila-et', f.t));
      tr.appendChild(nodo('td', null, f.f(r.a[f.k])));
      tr.appendChild(nodo('td', null, f.f(r.b[f.k])));
      tr.appendChild(celdaDelta(f, r.delta[f.k]));
      tabla.appendChild(tr);
    });
    sec.appendChild(tabla);
    panel.appendChild(sec);

    const m = estado.metricaComp;
    const nombreM = m === 'ganancia' ? 'Ganancia' : 'Facturación';
    const sec2 = seccion(`${nombreM} acumulada: A contra B`);
    sec2.appendChild(chips(METRICAS_EVO, m, (id) => { estado.metricaComp = id; renderPanel(); }));
    const g1 = nodo('div');
    const pa = Stats.acumulado(Stats.filtrarPorFecha(datos.confirmadas, estado.compA), m);
    const pb = Stats.acumulado(Stats.filtrarPorFecha(datos.confirmadas, estado.compB), m);
    const todosX = pa.concat(pb).map((p) => p.x);
    if (!todosX.length) {
      Charts.vacio(g1, 'No hay ventas para comparar.');
    } else {
      const xMin = Math.floor(Math.min(...todosX) / 60);
      const xMax = Math.max(xMin + 1, Math.ceil(Math.max(...todosX) / 60));
      Charts.lineas(g1, {
        titulo: 'Comparación acumulada',
        series: [
          { nombre: `A · ${Stats.etiquetaFecha(estado.compA)}`, color: Charts.COLOR.a, area: true, puntos: pa },
          { nombre: `B · ${Stats.etiquetaFecha(estado.compB)}`, color: Charts.COLOR.b, dash: true, puntos: pb },
        ],
        xMin, xMax, formatoEje: (v) => '$' + Charts.corto(v), formatoValor: pesos,
      });
    }
    sec2.appendChild(g1);
    panel.appendChild(sec2);

    const sec3 = seccion(`${nombreM} por hora: A contra B`);
    const g2 = nodo('div');
    const ha = Stats.porHora(Stats.filtrarPorFecha(datos.confirmadas, estado.compA));
    const hb = Stats.porHora(Stats.filtrarPorFecha(datos.confirmadas, estado.compB));
    const ra = Stats.rangoHoras(ha), rb = Stats.rangoHoras(hb);
    if (!ra && !rb) {
      Charts.vacio(g2, 'No hay ventas para comparar.');
    } else {
      const desde = Math.min(ra ? ra.min : 23, rb ? rb.min : 23);
      const hasta = Math.max(ra ? ra.max : 0, rb ? rb.max : 0);
      const idx = []; for (let h = desde; h <= hasta; h++) idx.push(h);
      Charts.barras(g2, {
        titulo: 'Comparación por hora',
        categorias: idx.map((h) => `${h}h`),
        series: [
          { nombre: `A · ${Stats.etiquetaFecha(estado.compA)}`, color: Charts.COLOR.a, valores: idx.map((h) => ha[h][m]) },
          { nombre: `B · ${Stats.etiquetaFecha(estado.compB)}`, color: Charts.COLOR.b, valores: idx.map((h) => hb[h][m]) },
        ],
        formatoEje: (v) => '$' + Charts.corto(v),
        describir: (i) => `${idx[i]}:00 a ${idx[i]}:59 — A: ${pesos(ha[idx[i]][m])} (${ha[idx[i]].tickets} tickets) · B: ${pesos(hb[idx[i]][m])} (${hb[idx[i]].tickets} tickets)`,
      });
    }
    sec3.appendChild(g2);
    panel.appendChild(sec3);
  }

  // ---------- Pestaña: productos más vendidos ----------
  function renderProd(panel) {
    const sec = seccion('Productos más vendidos',
      (estado.jornada === 'todas' ? 'Todas las jornadas.' : `Jornada: ${etiqueta(estado.jornada)}.`) +
      ' La facturación es neta de descuentos.');
    sec.appendChild(chips(
      [{ id: 'unidades', label: 'Unidades' }, { id: 'facturacion', label: 'Facturación' }, { id: 'ganancia', label: 'Ganancia' }],
      estado.metricaProd, (id) => { estado.metricaProd = id; renderPanel(); }));
    sec.appendChild(chips(
      [{ id: 'todos', label: 'Todos' }, { id: 'articulo', label: 'Artículos' }, { id: 'combo', label: 'Combos' }],
      estado.tipoProd, (id) => { estado.tipoProd = id; renderPanel(); }));
    const g = nodo('div');
    const r = Stats.topProductos(ventasScope(), { metrica: estado.metricaProd, tipo: estado.tipoProd, limite: 10 });
    const m = estado.metricaProd;
    if (!r.items.length) {
      Charts.vacio(g, 'No hay ventas en esta selección.');
    } else {
      sec.appendChild(nodo('p', 'stats-nota', `Mostrando ${r.items.length} de ${r.totalDistintos} producto(s).`));
      Charts.barrasH(g, {
        titulo: 'Productos más vendidos',
        items: r.items.map((p) => ({
          etiqueta: (p.esCombo ? '[Combo] ' : '') + p.nombre,
          valor: p[m],
          detalle: `${entero(p.unidades)} u · fact. ${pesos(p.facturacion)} · gan. ${pesos(p.ganancia)}`,
        })),
        formatoValor: m === 'unidades' ? (v) => `${entero(v)} u` : pesos,
        color: m === 'ganancia' ? Charts.COLOR.verde : Charts.COLOR.a,
      });
    }
    sec.appendChild(g);
    panel.appendChild(sec);
  }

  // ---------- Pestaña: ticket promedio ----------
  function renderTicket(panel) {
    const k = Stats.kpis(ventasScope());
    const sec0 = seccion('Ticket promedio',
      estado.jornada === 'todas' ? 'Todas las jornadas.' : `Jornada: ${etiqueta(estado.jornada)}.`);
    const fila = nodo('div', 'stats-kpis stats-kpis-chicos');
    fila.appendChild(tile('Promedio', pesos(k.ticketPromedio)));
    fila.appendChild(tile('Mediana', pesos(k.ticketMediana)));
    fila.appendChild(tile('Más alto', pesos(k.ticketMaximo)));
    fila.appendChild(tile('Unidades por ticket', n1(k.unidadesPorTicket)));
    sec0.appendChild(fila);
    panel.appendChild(sec0);

    const sec1 = seccion('Ticket promedio por jornada');
    const g1 = nodo('div');
    const nota = barrasPorJornada(g1, {
      valorDe: (kk) => kk.ticketPromedio,
      formatoEje: (v) => '$' + Charts.corto(v),
      formatoValor: (v) => '$' + Charts.corto(v),
      describir: (kk) => `ticket promedio ${pesos(kk.ticketPromedio)} · mediana ${pesos(kk.ticketMediana)} · ${kk.tickets} tickets`,
    });
    if (nota) sec1.appendChild(nodo('p', 'stats-nota', nota));
    sec1.appendChild(g1);
    panel.appendChild(sec1);

    const sec2 = seccion('Ticket promedio por hora');
    const g2 = nodo('div');
    const horas = Stats.porHora(ventasScope());
    const rango = Stats.rangoHoras(horas);
    if (!rango) {
      Charts.vacio(g2, 'No hay ventas en esta selección.');
    } else {
      const vis = horas.slice(rango.min, rango.max + 1);
      Charts.barras(g2, {
        titulo: 'Ticket promedio por hora',
        categorias: vis.map((h) => `${h.hora}h`),
        series: [{ nombre: 'Ticket promedio', color: Charts.COLOR.b, valores: vis.map((h) => h.ticketPromedio) }],
        formatoEje: (v) => '$' + Charts.corto(v),
        formatoValor: (v) => '$' + Charts.corto(v),
        describir: (i) => `${vis[i].hora}:00 a ${vis[i].hora}:59 — ticket promedio ${pesos(vis[i].ticketPromedio)} · ${vis[i].tickets} tickets`,
      });
    }
    sec2.appendChild(g2);
    panel.appendChild(sec2);

    const sec3 = seccion('Distribución de los tickets', 'Cuántos tickets cayeron en cada rango de importe.');
    const g3 = nodo('div');
    const dist = Stats.distribucionTickets(ventasScope());
    if (!dist.rangos.length) {
      Charts.vacio(g3, 'No hay ventas en esta selección.');
    } else {
      Charts.barras(g3, {
        titulo: 'Distribución de tickets',
        categorias: dist.rangos.map((r) => `$${Charts.corto(r.desde)}\na ${Charts.corto(r.hasta)}`),
        series: [{ nombre: 'Tickets', color: Charts.COLOR.verde, valores: dist.rangos.map((r) => r.cantidad) }],
        formatoEje: entero, formatoValor: entero, entero: true,
        describir: (i) => `De ${pesos(dist.rangos[i].desde)} a menos de ${pesos(dist.rangos[i].hasta)}: ${dist.rangos[i].cantidad} ticket(s)`,
      });
    }
    sec3.appendChild(g3);
    panel.appendChild(sec3);
  }

  // ---------- Render general ----------
  function renderPanel() {
    const panel = $('statsPanel');
    const scrollTop = panel.scrollTop;
    panel.textContent = '';
    try {
      if (estado.tab === 'hora') renderHora(panel);
      else if (estado.tab === 'evo') renderEvo(panel);
      else if (estado.tab === 'comp') renderComp(panel);
      else if (estado.tab === 'prod') renderProd(panel);
      else renderTicket(panel);
    } catch (e) {
      console.error('Estadísticas:', e);
      panel.textContent = 'No se pudo mostrar esta pestaña. El resto de la caja no se ve afectado.';
    }
    panel.scrollTop = scrollTop;
  }

  function render() {
    renderSelector();
    renderKpis();
    renderTabs();
    renderPanel();
    renderPie();
  }

  // ---------- Apertura / cierre ----------
  async function abrir() {
    const modal = $('modalStats');
    modal.classList.remove('hidden');
    $('statsPanel').textContent = 'Calculando…';
    $('statsKpis').textContent = '';
    $('statsPie').textContent = '';
    try {
      datos = await Stats.cargar();
      jornadasAsc = Stats.jornadas(datos.confirmadas);
      if (!jornadasAsc.length) {
        $('statsPanel').textContent = '';
        Charts.vacio($('statsPanel'), 'Todavía no hay ventas confirmadas guardadas en esta tablet.');
        $('statsJornada').textContent = '';
        renderPie();
        return;
      }
      estado = estadoInicial();
      render();
    } catch (e) {
      console.error('Estadísticas:', e);
      $('statsPanel').textContent = 'No se pudieron calcular las estadísticas. El resto de la caja no se ve afectado.';
    }
  }

  function cerrar() {
    $('modalStats').classList.add('hidden');
    datos = null; // se vuelve a leer la próxima vez que se abra
    jornadasAsc = [];
    $('statsPanel').textContent = '';
    $('statsKpis').textContent = '';
    $('statsPie').textContent = '';
  }

  function init() {
    const boton = document.querySelector('[data-action="stats"]');
    if (!boton) return;
    if (typeof Stats === 'undefined' || typeof Charts === 'undefined' || !$('modalStats')) {
      boton.classList.add('hidden'); // si faltara algún archivo, no se ofrece la sección
      return;
    }
    boton.addEventListener('click', abrir);
    document.querySelectorAll('[data-close="modalStats"]').forEach((b) => b.addEventListener('click', cerrar));
    $('statsJornada').addEventListener('change', () => elegirJornada($('statsJornada').value));
    $('statsPrev').addEventListener('click', () => {
      const i = jornadasAsc.findIndex((j) => j.fecha === estado.jornada);
      if (i > 0) elegirJornada(jornadasAsc[i - 1].fecha);
    });
    $('statsNext').addEventListener('click', () => {
      const i = jornadasAsc.findIndex((j) => j.fecha === estado.jornada);
      if (i !== -1 && i < jornadasAsc.length - 1) elegirJornada(jornadasAsc[i + 1].fecha);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    try { init(); } catch (e) { console.error('Estadísticas (init):', e); }
  });

  return { abrir, cerrar };
})();
