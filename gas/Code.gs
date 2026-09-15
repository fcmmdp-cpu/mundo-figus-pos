/**
 * Code.gs — Backend de Mundo Figus Caja.
 * Desplegar como Web App (Implementar > Nueva implementación > Aplicación web).
 * Ejecutar como: Yo. Acceso: cualquiera con el enlace.
 * La URL /exec resultante se pega en Configuración > URL de Google Apps Script.
 *
 * Hojas usadas: Artículos, Combos, Detalle Combos, Ventas Nueva, Ventas Detalle, Feria.
 * NO se toca Feria Histórico.
 */

const SHEET_ARTICULOS = 'Artículos';
const SHEET_COMBOS = 'Combos';
const SHEET_DETALLE_COMBOS = 'Detalle Combos';
const SHEET_VENTAS_NUEVA = 'Ventas Nueva';
const SHEET_VENTAS_DETALLE = 'Ventas Detalle';
const SHEET_FERIA = 'Feria';
// Hoja técnica interna (no forma parte del modelo de negocio de la
// especificación): registra qué efectos comerciales de cada venta ya se
// aplicaron, para que un reintento nunca pueda repetirlos. Se crea sola,
// oculta, la primera vez que hace falta.
const SHEET_LOG = 'Log Sync (no editar)';

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------- GET: catálogo ----------------
function doGet(e) {
  const action = e.parameter.action;
  try {
    if (action === 'getCatalog') {
      return respond_({ ok: true, data: obtenerCatalogo_() });
    }
    if (action === 'checkVenta') {
      return respond_({ ok: true, data: checkVenta_(e.parameter.id) });
    }
    return respond_({ ok: false, error: 'Acción no reconocida' });
  } catch (err) {
    return respond_({ ok: false, error: String(err) });
  }
}

// Solo lectura. Le permite al cliente confirmar si una venta puntual ya
// quedó aplicada del lado del servidor cuando el envío falló por un motivo
// de comunicación (no por rechazo del servidor). No modifica nada.
function checkVenta_(idVenta) {
  if (!idVenta) return { existe: false, estado: null };
  const sheetVentas = ss_().getSheetByName(SHEET_VENTAS_NUEVA);
  const fila = buscarFilaPorIdVenta_(sheetVentas, idVenta);
  if (fila === -1) return { existe: false, estado: null };
  const headers = obtenerEncabezados_(sheetVentas);
  const colEstado = headers.indexOf('Estado') + 1;
  const estado = sheetVentas.getRange(fila, colEstado).getValue();
  return { existe: true, estado };
}

function obtenerCatalogo_() {
  const articulos = leerHojaComoObjetos_(SHEET_ARTICULOS).map((r) => ({
    ID: r['ID'],
    Articulo: r['Artículo'],
    Categoria: r['Categoría'],
    Coleccion: r['Colección'],
    PCosto: r['P.Costo'],
    PVenta: r['P.Venta'],
    Stock: r['Stock'],
    Activo: r['Activo'],
    MostrarEnCaja: r['Mostrar en caja'],
  }));

  const combos = leerHojaComoObjetos_(SHEET_COMBOS).map((r) => ({
    IDCombo: r['ID Combo'],
    Nombre: r['Nombre'],
    Coleccion: r['Colección'],
    PrecioVenta: r['Precio Venta'],
    Activo: r['Activo'],
    CostoCombo: r['Costo Combo'],
  }));

  const detalleCombos = leerHojaComoObjetos_(SHEET_DETALLE_COMBOS).map((r) => ({
    IDCombo: r['ID Combo'],
    IDArticulo: r['ID Artículo'],
    Cantidad: r['Cantidad'],
  }));

  return { articulos, combos, detalleCombos };
}

// ---------------- POST: ventas y anulaciones ----------------
function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const lock = LockService.getScriptLock();
    lock.waitLock(20000); // evita carreras si dos tablets sincronizan a la vez
    try {
      if (body.action === 'pushVenta') {
        return respond_(pushVenta_(body.data));
      }
      if (body.action === 'anularVenta') {
        return respond_(anularVenta_(body.data));
      }
      return respond_({ ok: false, error: 'Acción no reconocida' });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return respond_({ ok: false, error: String(err) });
  }
}

// Idempotente EFECTO POR EFECTO. Que la cabecera ya exista NO se usa como
// señal de "toda la operación ya se aplicó": cada línea de detalle, su
// descuento de stock, y el recálculo de Feria se verifican y aplican de
// forma independiente. Así, un reintento sobre una venta que el servidor ya
// había recibido total o parcialmente completa exactamente lo que falta y
// nunca repite lo que ya estaba.
function pushVenta_(venta) {
  const sheetVentas = ss_().getSheetByName(SHEET_VENTAS_NUEVA);
  const yaExistiaCabecera = buscarFilaPorIdVenta_(sheetVentas, venta.IDVenta) !== -1;

  if (!yaExistiaCabecera) {
    sheetVentas.appendRow([
      venta.IDVenta, venta.Fecha, venta.Hora, venta.Canal, venta.Cliente || '',
      venta.Localidad || '', venta.Subtotal, venta.Descuento, venta.TotalCobrado,
      venta.Efectivo, venta.Transferencia, venta.TipoPago, venta.CostoTotal,
      venta.Ganancia, venta.Estado,
    ]);
  }

  const sheetDetalle = ss_().getSheetByName(SHEET_VENTAS_DETALLE);
  const detalleExistente = new Set(
    sheetDetalle.getDataRange().getValues().slice(1)
      .filter((r) => r[0] === venta.IDVenta)
      .map((r) => claveLinea_(r[1], r[2]))
  );

  const log = obtenerLog_();

  venta.detalle.forEach((d) => {
    const clave = claveLinea_(d.Tipo, d.IDProducto);
    const claveStock = `STOCK-${venta.IDVenta}-${clave}`;

    // Efecto 1: descuento de stock de esta línea puntual — guardado en el
    // log, NO en la presencia de la fila de detalle, para que ninguno de
    // los dos pueda quedar aplicado sin el otro tras una falla a mitad de camino.
    if (!log.has(claveStock)) {
      actualizarStockMaestro_([d], -1);
      registrarLog_(claveStock);
      log.add(claveStock);
    }

    // Efecto 2: fila de detalle de esta línea puntual.
    if (!detalleExistente.has(clave)) {
      sheetDetalle.appendRow([
        d.IDVenta, d.Tipo, d.IDProducto, d.Articulo, d.Cantidad, d.PrecioUnitario,
        d.SubtotalLinea, d.DescuentoLinea, d.CostoUnitario, d.CostoTotal, d.GananciaLinea,
      ]);
      detalleExistente.add(clave);
    }
  });

  // Efecto 3: Feria. Es un recálculo completo (no un delta), así que llamarlo
  // de nuevo en cada reintento es intrínsecamente seguro por diseño.
  recalcularFeriaFecha_(venta.Fecha);

  return { ok: true, idVenta: venta.IDVenta, yaExistia: yaExistiaCabecera };
}

// Idempotente EFECTO POR EFECTO, igual que pushVenta_: la reposición de
// stock de cada línea se guarda en el log de forma independiente del estado
// "Anulada" de la cabecera, para cubrir el caso de que el script se
// interrumpa entre reponer stock y terminar de marcar el estado.
function anularVenta_(data) {
  const sheetVentas = ss_().getSheetByName(SHEET_VENTAS_NUEVA);
  const fila = buscarFilaPorIdVenta_(sheetVentas, data.IDVenta);
  if (fila === -1) return { ok: false, error: 'Venta no encontrada: ' + data.IDVenta };

  const headers = obtenerEncabezados_(sheetVentas);
  const colEstado = headers.indexOf('Estado') + 1;
  const colFecha = headers.indexOf('Fecha') + 1;
  const fechaVenta = formatearFecha_(sheetVentas.getRange(fila, colFecha).getValue());

  const sheetDetalle = ss_().getSheetByName(SHEET_VENTAS_DETALLE);
  const filasDetalle = sheetDetalle.getDataRange().getValues().slice(1)
    .filter((r) => r[0] === data.IDVenta);

  const log = obtenerLog_();

  filasDetalle.forEach((r) => {
    const tipo = r[1], idProducto = r[2], cantidad = Number(r[4]);
    const claveRevert = `REVERT-${data.IDVenta}-${claveLinea_(tipo, idProducto)}`;
    if (!log.has(claveRevert)) {
      actualizarStockMaestro_([{ Tipo: tipo, IDProducto: idProducto, Cantidad: cantidad }], +1);
      registrarLog_(claveRevert);
      log.add(claveRevert);
    }
  });

  if (sheetVentas.getRange(fila, colEstado).getValue() !== 'Anulada') {
    sheetVentas.getRange(fila, colEstado).setValue('Anulada');
  }

  recalcularFeriaFecha_(fechaVenta);

  return { ok: true };
}

function claveLinea_(tipo, idProducto) {
  const tipoNorm = (tipo === 'Articulo') ? 'Artículo' : tipo;
  return `${tipoNorm}|${idProducto}`;
}

// ---------------- Log de idempotencia ----------------
function obtenerHojaLog_() {
  let sheet = ss_().getSheetByName(SHEET_LOG);
  if (!sheet) {
    sheet = ss_().insertSheet(SHEET_LOG);
    sheet.appendRow(['Clave', 'Fecha registro']);
    sheet.hideSheet();
  }
  return sheet;
}

function obtenerLog_() {
  const sheet = obtenerHojaLog_();
  const datos = sheet.getDataRange().getValues();
  const set = new Set();
  for (let i = 1; i < datos.length; i++) set.add(datos[i][0]);
  return set;
}

function registrarLog_(clave) {
  obtenerHojaLog_().appendRow([clave, new Date()]);
}

// signo: -1 al vender, +1 al anular. Expande combos por Detalle Combos.
function actualizarStockMaestro_(detalle, signo) {
  const sheetArt = ss_().getSheetByName(SHEET_ARTICULOS);
  const headers = obtenerEncabezados_(sheetArt);
  const colId = headers.indexOf('ID') + 1;
  const colStock = headers.indexOf('Stock') + 1;
  const datos = sheetArt.getDataRange().getValues();

  const indicePorId = {};
  for (let i = 1; i < datos.length; i++) indicePorId[datos[i][colId - 1]] = i + 1; // fila real (1-indexed)

  const combosDetalle = leerHojaComoObjetos_(SHEET_DETALLE_COMBOS);

  function descontar(idArticulo, cantidad) {
    const fila = indicePorId[idArticulo];
    if (!fila) return;
    const celda = sheetArt.getRange(fila, colStock);
    const actual = Number(celda.getValue()) || 0;
    celda.setValue(actual + signo * cantidad);
  }

  detalle.forEach((d) => {
    if (d.Tipo === 'Artículo' || d.Tipo === 'Articulo') {
      descontar(d.IDProducto, Number(d.Cantidad));
    } else {
      combosDetalle
        .filter((c) => c['ID Combo'] === d.IDProducto)
        .forEach((c) => descontar(c['ID Artículo'], Number(c['Cantidad']) * Number(d.Cantidad)));
    }
  });
}

// Recalcula DESDE CERO (no acumula) los contadores Álb./Figus./Naipes/Ext./Combos
// de una fecha puntual en Feria, a partir de las ventas realmente Confirmadas
// de esa fecha. Esto es lo que la vuelve segura frente a reintentos de
// sincronización y frente a anulaciones: se recompone el valor correcto en
// lugar de sumar/restar deltas, así que da igual cuántas veces se dispare.
// No requiere ni Canal ni Estado del payload entrante: siempre relee la
// fuente de verdad (Ventas Nueva + Ventas Detalle) en el momento de calcular.
function recalcularFeriaFecha_(fecha) {
  if (!fecha) return;

  const sheetVentas = ss_().getSheetByName(SHEET_VENTAS_NUEVA);
  const headersVentas = obtenerEncabezados_(sheetVentas);
  const idxFecha = headersVentas.indexOf('Fecha');
  const idxCanal = headersVentas.indexOf('Canal');
  const idxEstado = headersVentas.indexOf('Estado');
  const idxId = headersVentas.indexOf('ID Venta');

  const filasVentas = sheetVentas.getDataRange().getValues().slice(1);
  const idsValidos = new Set(
    filasVentas
      .filter((r) =>
        formatearFecha_(r[idxFecha]) === fecha &&
        r[idxCanal] === 'Feria' &&
        r[idxEstado] === 'Confirmada')
      .map((r) => r[idxId])
  );

  const sheetDetalle = ss_().getSheetByName(SHEET_VENTAS_DETALLE);
  const headersDetalle = obtenerEncabezados_(sheetDetalle);
  const dIdxId = headersDetalle.indexOf('ID Venta');
  const dIdxTipo = headersDetalle.indexOf('Tipo');
  const dIdxProducto = headersDetalle.indexOf('ID Producto');
  const dIdxCantidad = headersDetalle.indexOf('Cantidad');

  const filasDetalle = sheetDetalle.getDataRange().getValues().slice(1)
    .filter((r) => idsValidos.has(r[dIdxId]));

  const articulosPorId = {};
  leerHojaComoObjetos_(SHEET_ARTICULOS).forEach((a) => { articulosPorId[a['ID']] = a; });
  const combosDetalle = leerHojaComoObjetos_(SHEET_DETALLE_COMBOS);

  let sumaAlb = 0, sumaFigus = 0, sumaNaipes = 0, sumaExt = 0, sumaCombos = 0;

  function sumarCategoria_(art, cant) {
    if (!art) return;
    switch (art['Categoría']) {
      case 'Álbumes': sumaAlb += cant; break;
      case 'Figuritas': sumaFigus += cant; break;
      case 'Naipes': sumaNaipes += cant; break;
      case 'Extensiones': sumaExt += cant; break;
    }
  }

  filasDetalle.forEach((r) => {
    const tipo = r[dIdxTipo];
    const idProducto = r[dIdxProducto];
    const cantidad = Number(r[dIdxCantidad]) || 0;
    if (tipo === 'Combo') {
      sumaCombos += cantidad;
      combosDetalle
        .filter((c) => c['ID Combo'] === idProducto)
        .forEach((c) => sumarCategoria_(articulosPorId[c['ID Artículo']], Number(c['Cantidad']) * cantidad));
    } else {
      sumarCategoria_(articulosPorId[idProducto], cantidad);
    }
  });

  const sheetFeria = ss_().getSheetByName(SHEET_FERIA);
  const headersFeria = obtenerEncabezados_(sheetFeria);
  const colFecha = headersFeria.indexOf('Fecha') + 1;
  const colAlb = headersFeria.indexOf('Álb.') + 1;
  const colFigus = headersFeria.indexOf('Figus') + 1;
  const colNaipes = headersFeria.indexOf('Naipes') + 1;
  const colExt = headersFeria.indexOf('Ext.') + 1;
  const colCombos = headersFeria.indexOf('Combos') + 1;

  const datosFeria = sheetFeria.getDataRange().getValues();
  let filaFecha = -1;
  for (let i = 1; i < datosFeria.length; i++) {
    if (formatearFecha_(datosFeria[i][colFecha - 1]) === fecha) { filaFecha = i + 1; break; }
  }
  if (filaFecha === -1) {
    if (idsValidos.size === 0) return; // no hay nada que registrar y no existe la fila: no crear una vacía
    sheetFeria.appendRow([fecha]);
    filaFecha = sheetFeria.getLastRow();
  }

  if (colAlb) sheetFeria.getRange(filaFecha, colAlb).setValue(sumaAlb);
  if (colFigus) sheetFeria.getRange(filaFecha, colFigus).setValue(sumaFigus);
  if (colNaipes) sheetFeria.getRange(filaFecha, colNaipes).setValue(sumaNaipes);
  if (colExt) sheetFeria.getRange(filaFecha, colExt).setValue(sumaExt);
  if (colCombos) sheetFeria.getRange(filaFecha, colCombos).setValue(sumaCombos);
}

// Normaliza una fecha (Date o string) a 'YYYY-MM-DD' para comparar de forma
// consistente con lo que manda la app (que ya envía Fecha como 'YYYY-MM-DD').
function formatearFecha_(valor) {
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, ss_().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  }
  return String(valor).slice(0, 10);
}

// ---------------- Utilidades de hoja ----------------
function obtenerEncabezados_(sheet) {
  return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function leerHojaComoObjetos_(nombreHoja) {
  const sheet = ss_().getSheetByName(nombreHoja);
  const datos = sheet.getDataRange().getValues();
  const headers = datos[0];
  const filas = [];
  for (let i = 1; i < datos.length; i++) {
    if (datos[i].every((c) => c === '' || c === null)) continue;
    const obj = {};
    headers.forEach((h, idx) => { if (h) obj[h] = datos[i][idx]; });
    filas.push(obj);
  }
  return filas;
}

function buscarFilaPorIdVenta_(sheet, idVenta) {
  const datos = sheet.getDataRange().getValues();
  for (let i = 1; i < datos.length; i++) {
    if (datos[i][0] === idVenta) return i + 1;
  }
  return -1;
}

// =====================================================================
// RESET DE VENTAS DE PRUEBA — herramienta de mantenimiento
// NO se llama desde doGet/doPost ni desde la app. Se ejecuta a mano
// desde el editor de Apps Script: Ejecutar > elegir la función > Ejecutar.
//
// Uso:
//   1) Ejecutar auditoriaResetPruebas() (solo lectura). Revisar la hoja
//      "AUDITORIA RESET (revisar)" que genera.
//   2) Si el resumen es correcto, cambiar RESET_PRUEBAS_AUTORIZADO a true.
//   3) Ejecutar ejecutarResetVentasPrueba().
//   4) Volver a poner RESET_PRUEBAS_AUTORIZADO en false.
// =====================================================================

const RESET_PRUEBAS_AUTORIZADO = false; // cambiar a true SOLO después de revisar la auditoría

// Identifica ventas de prueba por su ID Venta (todo lo generado por este POS
// arranca con "VTA-"; ver idgen.js). Calcula, SIN ESCRIBIR NADA, cuánto stock
// hay que devolver a cada artículo — expandiendo combos por Detalle Combos, y
// excluyendo del cálculo de stock a las ventas que ya están en estado
// "Anulada" (esas ya recibieron su reversión cuando se anularon).
function calcularImpactoVentasPrueba_() {
  const sheetVentas = ss_().getSheetByName(SHEET_VENTAS_NUEVA);
  const headersVentas = obtenerEncabezados_(sheetVentas);
  const idxId = headersVentas.indexOf('ID Venta');
  const idxFecha = headersVentas.indexOf('Fecha');
  const idxHora = headersVentas.indexOf('Hora');
  const idxEstado = headersVentas.indexOf('Estado');
  const idxTotal = headersVentas.indexOf('Total Cobrado');

  const filasVentas = sheetVentas.getDataRange().getValues().slice(1)
    .filter((r) => r[idxId] && String(r[idxId]).indexOf('VTA-') === 0);

  const ventasPrueba = filasVentas.map((r) => ({
    IDVenta: r[idxId],
    Fecha: formatearFecha_(r[idxFecha]),
    Hora: r[idxHora],
    Estado: r[idxEstado],
    TotalCobrado: r[idxTotal],
  }));

  const idsTodas = new Set(ventasPrueba.map((v) => v.IDVenta));
  const idsConfirmadas = new Set(ventasPrueba.filter((v) => v.Estado === 'Confirmada').map((v) => v.IDVenta));
  const idsAnuladas = ventasPrueba.filter((v) => v.Estado === 'Anulada').length;

  const sheetDetalle = ss_().getSheetByName(SHEET_VENTAS_DETALLE);
  const headersDetalle = obtenerEncabezados_(sheetDetalle);
  const dIdxId = headersDetalle.indexOf('ID Venta');
  const dIdxTipo = headersDetalle.indexOf('Tipo');
  const dIdxProducto = headersDetalle.indexOf('ID Producto');
  const dIdxCantidad = headersDetalle.indexOf('Cantidad');

  const filasDetalleTodas = sheetDetalle.getDataRange().getValues().slice(1)
    .filter((r) => idsTodas.has(r[dIdxId]));
  const filasDetalleConfirmadas = filasDetalleTodas.filter((r) => idsConfirmadas.has(r[dIdxId]));

  const combosDetalle = leerHojaComoObjetos_(SHEET_DETALLE_COMBOS);
  const lineasPorArticuloConfirmadas = {};

  function sumar(idArticulo, cantidad) {
    lineasPorArticuloConfirmadas[idArticulo] = (lineasPorArticuloConfirmadas[idArticulo] || 0) + cantidad;
  }

  filasDetalleConfirmadas.forEach((r) => {
    const tipo = r[dIdxTipo];
    const idProducto = r[dIdxProducto];
    const cantidad = Number(r[dIdxCantidad]) || 0;
    if (tipo === 'Combo') {
      // Los combos NO tienen stock propio: se devuelve únicamente a sus
      // componentes físicos, según Detalle Combos.
      combosDetalle
        .filter((c) => c['ID Combo'] === idProducto)
        .forEach((c) => sumar(c['ID Artículo'], Number(c['Cantidad']) * cantidad));
    } else {
      sumar(idProducto, cantidad);
    }
  });

  return {
    ventasPrueba,
    idsTodas,
    idsConfirmadas,
    ventasAnuladasCount: idsAnuladas,
    ventasConfirmadasCount: idsConfirmadas.size,
    lineasPorArticuloConfirmadas,
    totalLineasADeletar: filasDetalleTodas.length,
  };
}

// PASO 1 — SOLO LECTURA. Genera la hoja de auditoría para revisar a mano.
// No modifica Artículos, Ventas Nueva, Ventas Detalle, Combos, Detalle
// Combos ni ningún dato de negocio.
function auditoriaResetPruebas() {
  const r = calcularImpactoVentasPrueba_();

  const nombreHoja = 'AUDITORIA RESET (revisar)';
  const existente = ss_().getSheetByName(nombreHoja);
  if (existente) ss_().deleteSheet(existente); // reemplaza una auditoría anterior, no toca nada más
  const sheet = ss_().insertSheet(nombreHoja);

  const articulos = {};
  leerHojaComoObjetos_(SHEET_ARTICULOS).forEach((a) => { articulos[a['ID']] = a; });

  sheet.appendRow(['RESUMEN']);
  sheet.appendRow(['Ventas de prueba detectadas (ID Venta empieza con "VTA-")', r.ventasPrueba.length]);
  sheet.appendRow(['  · Confirmadas (con stock afectado, se revierte)', r.ventasConfirmadasCount]);
  sheet.appendRow(['  · Ya Anuladas (su stock ya se había repuesto; no se revierte de nuevo)', r.ventasAnuladasCount]);
  sheet.appendRow(['Líneas de Ventas Detalle a eliminar', r.totalLineasADeletar]);
  sheet.appendRow(['Artículos cuyo stock será modificado', Object.keys(r.lineasPorArticuloConfirmadas).length]);
  sheet.appendRow(['']);

  sheet.appendRow(['VENTAS QUE SE VAN A ELIMINAR']);
  sheet.appendRow(['ID Venta', 'Fecha', 'Hora', 'Estado', 'Total Cobrado']);
  r.ventasPrueba.forEach((v) => sheet.appendRow([v.IDVenta, v.Fecha, v.Hora, v.Estado, v.TotalCobrado]));
  sheet.appendRow(['']);

  sheet.appendRow(['IMPACTO EN STOCK (solo ventas Confirmada; combos ya expandidos a sus componentes)']);
  sheet.appendRow(['ID Artículo', 'Nombre', 'Stock actual', 'Cantidad a devolver', 'Stock resultante']);
  Object.keys(r.lineasPorArticuloConfirmadas).forEach((id) => {
    const art = articulos[id];
    const actual = art ? Number(art['Stock']) || 0 : null;
    const devolver = r.lineasPorArticuloConfirmadas[id];
    const resultante = actual !== null ? actual + devolver : null;
    sheet.appendRow([id, art ? art['Artículo'] : '(no encontrado en Artículos)', actual, devolver, resultante]);
  });
  sheet.appendRow(['']);

  sheet.appendRow(['TRATAMIENTO DE COMBOS']);
  sheet.appendRow(['Los combos vendidos no reciben ni pierden stock propio (no tienen). Todo el stock devuelto va a los artículos componentes según Detalle Combos, multiplicado por la cantidad de combos vendidos en cada línea.']);
  sheet.appendRow(['']);

  sheet.appendRow(['SIGUIENTE PASO']);
  sheet.appendRow(['Si este resumen es correcto: cambiar RESET_PRUEBAS_AUTORIZADO a true en el código y ejecutar ejecutarResetVentasPrueba().']);

  sheet.autoResizeColumns(1, 5);
  SpreadsheetApp.flush();

  return {
    ok: true,
    mensaje: `Auditoría generada en la hoja "${nombreHoja}". Revisala antes de autorizar el reset.`,
    ventas: r.ventasPrueba.length,
    lineas: r.totalLineasADeletar,
    articulosAfectados: Object.keys(r.lineasPorArticuloConfirmadas).length,
  };
}

// PASO 2 — ESCRITURA. Recalcula el impacto en el momento de ejecutar (no usa
// nada cacheado de la auditoría) para que sea exacto respecto al estado real
// de la planilla en ese instante. Requiere RESET_PRUEBAS_AUTORIZADO = true.
function ejecutarResetVentasPrueba() {
  if (!RESET_PRUEBAS_AUTORIZADO) {
    throw new Error('Reset no autorizado. Revisá la hoja de auditoría y cambiá RESET_PRUEBAS_AUTORIZADO a true antes de ejecutar esta función.');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const r = calcularImpactoVentasPrueba_();
    if (r.ventasPrueba.length === 0) {
      return { ok: true, mensaje: 'No se encontraron ventas de prueba (VTA-). Nada para revertir.' };
    }

    // 1) Revertir stock exacto — solo de las ventas que estaban Confirmada.
    const sheetArt = ss_().getSheetByName(SHEET_ARTICULOS);
    const headersArt = obtenerEncabezados_(sheetArt);
    const colId = headersArt.indexOf('ID') + 1;
    const colStock = headersArt.indexOf('Stock') + 1;
    const datosArt = sheetArt.getDataRange().getValues();
    const filaPorId = {};
    for (let i = 1; i < datosArt.length; i++) filaPorId[datosArt[i][colId - 1]] = i + 1;

    Object.keys(r.lineasPorArticuloConfirmadas).forEach((id) => {
      const fila = filaPorId[id];
      if (!fila) return; // el artículo ya no existe en el catálogo: no hay celda que tocar
      const celda = sheetArt.getRange(fila, colStock);
      celda.setValue((Number(celda.getValue()) || 0) + r.lineasPorArticuloConfirmadas[id]);
    });

    // 2) Recién ahora que el stock quedó restaurado, borrar las filas de
    // Ventas Detalle y Ventas Nueva de las ventas de prueba (todas: Confirmada y Anulada).
    borrarFilasPorIdVenta_(ss_().getSheetByName(SHEET_VENTAS_DETALLE), r.idsTodas);
    borrarFilasPorIdVenta_(ss_().getSheetByName(SHEET_VENTAS_NUEVA), r.idsTodas);

    // 3) Limpiar las entradas del log de idempotencia que correspondían a estas ventas.
    limpiarLogDeVentas_(r.idsTodas);

    // 4) Recalcular Feria para cada fecha afectada: al ya no existir esas
    // ventas, el recálculo las excluye solo, sin tocar ninguna otra fecha.
    const fechas = new Set(r.ventasPrueba.map((v) => v.Fecha));
    fechas.forEach((f) => recalcularFeriaFecha_(f));

    return {
      ok: true,
      ventasEliminadas: r.ventasPrueba.length,
      articulosRestaurados: Object.keys(r.lineasPorArticuloConfirmadas).length,
      fechasFeriaRecalculadas: Array.from(fechas),
    };
  } finally {
    lock.releaseLock();
  }
}

// Borra, de abajo hacia arriba (para no correr índices), todas las filas
// cuya primera columna (ID Venta) esté en idsSet.
function borrarFilasPorIdVenta_(sheet, idsSet) {
  const datos = sheet.getDataRange().getValues();
  for (let i = datos.length - 1; i >= 1; i--) {
    if (idsSet.has(datos[i][0])) sheet.deleteRow(i + 1);
  }
}

// Limpia del log de idempotencia las claves que correspondan a alguna de las
// ventas de prueba (las claves tienen forma STOCK-<IDVenta>-... / REVERT-<IDVenta>-...).
function limpiarLogDeVentas_(idsSet) {
  const sheet = obtenerHojaLog_();
  const datos = sheet.getDataRange().getValues();
  const ids = Array.from(idsSet);
  for (let i = datos.length - 1; i >= 1; i--) {
    const clave = String(datos[i][0]);
    if (ids.some((id) => clave.indexOf(id) !== -1)) sheet.deleteRow(i + 1);
  }
}
