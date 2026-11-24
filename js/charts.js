// charts.js — Gráficos SVG propios, sin librerías ni red.
//
// Tres tipos, suficientes para la sección Estadísticas:
//   barras()   barras verticales (una o varias series)
//   lineas()   líneas escalonadas de acumulado a lo largo del día
//   barrasH()  ranking horizontal con nombre arriba de cada barra
//
// Todo texto se inserta con textContent (nunca innerHTML), así que un nombre
// de producto con caracteres raros no puede romper ni inyectar nada.
// Los gráficos son táctiles: tocar una barra o un punto del tiempo muestra el
// valor exacto en una línea de lectura debajo del gráfico (en la tablet no hay hover).

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const COLOR = {
    a: '#ff7a1a', aOsc: '#e05f00', b: '#2166d6', verde: '#1fa855',
    grilla: '#e3e5e9', eje: '#8a8f98', texto: '#444b57',
  };

  function el(tag, attrs, texto) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (texto !== undefined) e.textContent = texto;
    return e;
  }

  function pesos(n) { return '$' + Math.round(n).toLocaleString('es-AR'); }

  function corto(n) {
    const a = Math.abs(n);
    if (a >= 1e6) return (n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 }) + 'M';
    if (a >= 1e3) return (n / 1e3).toLocaleString('es-AR', { maximumFractionDigits: a >= 1e4 ? 0 : 1 }) + 'k';
    return Math.round(n).toLocaleString('es-AR');
  }

  // Escala "linda" para el eje Y: paso redondo (1, 2, 2.5, 5 × 10^k).
  function escala(max, objetivo = 4, entero = false) {
    if (!(max > 0)) return { max: entero ? 4 : 1, paso: entero ? 1 : 0.25 };
    const bruto = max / objetivo;
    const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    let paso = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
    if (entero) paso = Math.max(1, Math.ceil(paso));
    return { max: Math.ceil(max / paso) * paso, paso };
  }

  function limpiar(cont) { cont.textContent = ''; }

  function vacio(cont, mensaje) {
    limpiar(cont);
    const d = document.createElement('div');
    d.className = 'stats-vacio';
    d.textContent = mensaje;
    cont.appendChild(d);
  }

  function lineasTexto(svg, x, y, texto, attrs) {
    // Texto de varias líneas ("dom\n22/11") con tspans.
    const t = el('text', Object.assign({ x, y }, attrs));
    String(texto).split('\n').forEach((linea, i) => {
      t.appendChild(el('tspan', { x, dy: i === 0 ? 0 : 13 }, linea));
    });
    svg.appendChild(t);
  }

  function armarContenedor(cont, svg, leyenda, lecturaInicial) {
    limpiar(cont);
    cont.classList.add('stats-chart');
    if (leyenda && leyenda.length) {
      const ley = document.createElement('div');
      ley.className = 'stats-leyenda';
      leyenda.forEach((s) => {
        const it = document.createElement('span');
        const marca = document.createElement('i');
        marca.style.background = s.color;
        if (s.dash) marca.style.opacity = '0.65';
        it.appendChild(marca);
        it.appendChild(document.createTextNode(s.nombre));
        ley.appendChild(it);
      });
      cont.appendChild(ley);
    }
    cont.appendChild(svg);
    const lectura = document.createElement('div');
    lectura.className = 'stats-lectura';
    lectura.textContent = lecturaInicial || 'Tocá una barra para ver el detalle.';
    cont.appendChild(lectura);
    return lectura;
  }

  // ---------- Barras verticales ----------
  // opciones: { categorias:[texto], series:[{nombre,color,valores[]}], formatoEje(v),
  //   formatoValor(v), seleccionado:i|null, describir(i)->texto, onSelect(i), alto, entero }
  function barras(cont, op) {
    const n = op.categorias.length;
    const series = op.series;
    const todos = series.reduce((acc, s) => acc.concat(s.valores), []);
    if (!n || !todos.some((v) => v > 0)) { vacio(cont, 'Sin datos para mostrar.'); return; }

    const multilinea = op.categorias.some((c) => String(c).includes('\n'));
    const W = 720, H = op.alto || 260;
    const ml = 50, mr = 8, mt = 18, mb = multilinea ? 42 : 28;
    const pw = W - ml - mr, ph = H - mt - mb;
    const esc = escala(Math.max(...todos), 4, op.entero);
    const y = (v) => mt + ph - (v / esc.max) * ph;
    const fmtEje = op.formatoEje || corto;

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': op.titulo || 'Gráfico de barras',
      preserveAspectRatio: 'xMidYMid meet',
    });

    for (let v = 0; v <= esc.max + 1e-9; v += esc.paso) {
      svg.appendChild(el('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: COLOR.grilla, 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: ml - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: COLOR.eje }, fmtEje(v)));
    }

    const ancho = pw / n;
    const pad = ancho * 0.16;
    const bw = (ancho - 2 * pad) / series.length;
    const haySel = op.seleccionado !== null && op.seleccionado !== undefined;
    let lectura = null;

    for (let i = 0; i < n; i++) {
      const gx = ml + i * ancho;
      series.forEach((s, k) => {
        const v = s.valores[i] || 0;
        if (v <= 0) return;
        const h = Math.max(1.5, (v / esc.max) * ph);
        const opaco = haySel && op.seleccionado !== i ? 0.4 : 1;
        svg.appendChild(el('rect', {
          x: gx + pad + k * bw, y: mt + ph - h, width: Math.max(1, bw - 1), height: h,
          rx: 2, fill: s.color, opacity: opaco,
        }));
        if (series.length === 1 && bw >= 24 && op.formatoValor) {
          svg.appendChild(el('text', {
            x: gx + ancho / 2, y: mt + ph - h - 4, 'text-anchor': 'middle', 'font-size': 11,
            fill: COLOR.texto,
          }, op.formatoValor(v)));
        }
      });
      lineasTexto(svg, gx + ancho / 2, H - mb + 16, op.categorias[i], {
        'text-anchor': 'middle', 'font-size': 12, fill: COLOR.texto,
        'font-weight': haySel && op.seleccionado === i ? 700 : 400,
      });
      // Zona táctil de toda la columna.
      const zona = el('rect', { x: gx, y: mt, width: ancho, height: ph, fill: 'transparent', style: 'cursor:pointer' });
      zona.addEventListener('click', () => {
        if (lectura && op.describir) lectura.textContent = op.describir(i);
        if (op.onSelect) op.onSelect(i);
      });
      svg.appendChild(zona);
    }

    svg.appendChild(el('line', { x1: ml, x2: W - mr, y1: mt + ph, y2: mt + ph, stroke: COLOR.eje, 'stroke-width': 1 }));

    lectura = armarContenedor(cont, svg, series.length > 1 ? series : null, op.lecturaInicial);
  }

  // ---------- Líneas escalonadas (acumulado en el día) ----------
  // opciones: { series:[{nombre,color,dash,area,puntos:[{x:minutos,y}]}], xMin, xMax (en horas
  //   enteras), formatoEje(v), formatoValor(v), alto }
  function lineas(cont, op) {
    const series = op.series.filter((s) => s.puntos.length);
    if (!series.length) { vacio(cont, 'Sin ventas para mostrar.'); return; }

    const W = 720, H = op.alto || 260;
    const ml = 50, mr = 12, mt = 14, mb = 28;
    const pw = W - ml - mr, ph = H - mt - mb;
    const x0 = op.xMin * 60, x1 = Math.max(op.xMax, op.xMin + 1) * 60;
    const maxY = Math.max(...series.map((s) => s.puntos[s.puntos.length - 1].y));
    const esc = escala(maxY, 4);
    const x = (min) => ml + ((min - x0) / (x1 - x0)) * pw;
    const y = (v) => mt + ph - (v / esc.max) * ph;
    const fmtEje = op.formatoEje || corto;
    const fmtVal = op.formatoValor || pesos;

    const svg = el('svg', {
      viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': op.titulo || 'Gráfico de evolución',
      preserveAspectRatio: 'xMidYMid meet',
    });

    for (let v = 0; v <= esc.max + 1e-9; v += esc.paso) {
      svg.appendChild(el('line', { x1: ml, x2: W - mr, y1: y(v), y2: y(v), stroke: COLOR.grilla, 'stroke-width': 1 }));
      svg.appendChild(el('text', { x: ml - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 12, fill: COLOR.eje }, fmtEje(v)));
    }
    const horas = op.xMax - op.xMin;
    const salto = horas > 12 ? 3 : horas > 7 ? 2 : 1;
    for (let h = op.xMin; h <= x1 / 60; h += salto) {
      svg.appendChild(el('text', { x: x(h * 60), y: H - 8, 'text-anchor': 'middle', 'font-size': 12, fill: COLOR.texto }, `${h}h`));
    }

    series.forEach((s) => {
      let d = `M ${x(Math.max(x0, s.puntos[0].x))} ${y(0)}`;
      s.puntos.forEach((p) => { d += ` H ${x(p.x)} V ${y(p.y)}`; });
      if (s.area) {
        svg.appendChild(el('path', { d: `${d} V ${y(0)} Z`, fill: s.color, opacity: 0.12, stroke: 'none' }));
      }
      const attrs = { d, fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' };
      if (s.dash) attrs['stroke-dasharray'] = '7 5';
      svg.appendChild(el('path', attrs));
    });

    svg.appendChild(el('line', { x1: ml, x2: W - mr, y1: mt + ph, y2: mt + ph, stroke: COLOR.eje, 'stroke-width': 1 }));

    // Marcador táctil.
    const marca = el('line', { x1: 0, x2: 0, y1: mt, y2: mt + ph, stroke: COLOR.eje, 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
    svg.appendChild(marca);
    const zona = el('rect', { x: ml, y: mt, width: pw, height: ph, fill: 'transparent', style: 'cursor:pointer' });
    svg.appendChild(zona);

    const lectura = armarContenedor(cont, svg, op.series.length > 1 ? op.series : null,
      op.lecturaInicial || 'Tocá el gráfico para ver el acumulado a cada hora.');

    zona.addEventListener('click', (ev) => {
      const r = svg.getBoundingClientRect();
      const vx = ((ev.clientX - r.left) / r.width) * W;
      const min = Math.min(x1, Math.max(x0, x0 + ((vx - ml) / pw) * (x1 - x0)));
      marca.setAttribute('x1', x(min));
      marca.setAttribute('x2', x(min));
      marca.setAttribute('visibility', 'visible');
      const hh = Math.floor(min / 60), mm = Math.floor(min % 60);
      const partes = series.map((s) => {
        let acc = 0;
        for (const p of s.puntos) { if (p.x <= min) acc = p.y; else break; }
        return (series.length > 1 ? `${s.nombre}: ` : '') + fmtVal(acc);
      });
      lectura.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} — acumulado ${partes.join(' · ')}`;
    });
  }

  // ---------- Ranking horizontal ----------
  // opciones: { items:[{etiqueta, valor, detalle}], formatoValor(v), color }
  function barrasH(cont, op) {
    const items = op.items;
    if (!items.length || !items.some((i) => i.valor > 0)) { vacio(cont, 'Sin datos para mostrar.'); return; }

    const W = 720, fila = 48, mt = 4;
    const H = mt + fila * items.length;
    const reserva = 120; // lugar para el valor al final de la barra
    const max = Math.max(...items.map((i) => i.valor));
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': op.titulo || 'Ranking', preserveAspectRatio: 'xMidYMid meet' });

    items.forEach((it, i) => {
      const y0 = mt + i * fila;
      const nombre = it.etiqueta.length > 46 ? it.etiqueta.slice(0, 45) + '…' : it.etiqueta;
      svg.appendChild(el('text', { x: 0, y: y0 + 15, 'font-size': 13, 'font-weight': 600, fill: COLOR.texto }, `${i + 1}. ${nombre}`));
      if (it.detalle) {
        svg.appendChild(el('text', { x: W, y: y0 + 15, 'text-anchor': 'end', 'font-size': 11, fill: COLOR.eje }, it.detalle));
      }
      const w = Math.max(2, (it.valor / max) * (W - reserva));
      svg.appendChild(el('rect', { x: 0, y: y0 + 22, width: w, height: 14, rx: 3, fill: op.color || COLOR.a }));
      svg.appendChild(el('text', { x: w + 6, y: y0 + 34, 'font-size': 13, 'font-weight': 700, fill: COLOR.texto }, op.formatoValor(it.valor)));
    });

    limpiar(cont);
    cont.classList.add('stats-chart', 'stats-chart-lista');
    cont.appendChild(svg);
  }

  return { barras, lineas, barrasH, vacio, pesos, corto, escala, COLOR };
})();

if (typeof window !== 'undefined') window.Charts = Charts;
if (typeof module !== 'undefined' && module.exports) module.exports = Charts;
