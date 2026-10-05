# Mundo Figus — Caja (POS offline)

## 1. Desplegar el backend (Google Apps Script)

1. Abrí la planilla de Google Sheets (la que ya tiene Artículos, Combos, Detalle Combos, Ventas Nueva, Ventas Detalle, Feria).
2. Extensiones → Apps Script.
3. Pegá el contenido de `gas/Code.gs` (reemplazando el archivo por defecto).
4. Implementar → Nueva implementación → tipo "Aplicación web".
   - Ejecutar como: **Yo**.
   - Quién tiene acceso: **Cualquiera con el enlace**.
5. Copiá la URL que termina en `/exec`.

## 2. Publicar la app (PWA)

Subí toda la carpeta `mundo-figus-pos/` (menos `gas/` y este README) a cualquier hosting estático con HTTPS (GitHub Pages, Netlify, Firebase Hosting, etc.). HTTPS es obligatorio para que el Service Worker funcione.

## 3. Instalar en la tablet Android

1. Con Internet, abrí la URL publicada en Chrome.
2. Menú (⋮) → "Instalar aplicación" (o el banner de instalación aparece solo).
3. Abrí la app → Configuración → pegá la URL `/exec` del paso 1 → Guardar URL.
4. Configuración → **ACTUALIZAR CATÁLOGO** (con Internet).
5. A partir de acá la app funciona sin conexión.

## 4. Uso diario

- Antes de la feria, con Internet: abrir Configuración → Actualizar catálogo.
- Durante la feria: vender normalmente, con o sin conexión.
- Con Internet disponible, la sincronización es automática; también existe el botón **SINCRONIZAR AHORA**.

## 5. Checklist de aceptación (de la especificación)

Antes de dar por cerrado, probar en la tablet real:

- [ ] Instalación como PWA
- [ ] Actualizar catálogo con Internet
- [ ] Apagar Internet y abrir la caja
- [ ] Vender artículos sueltos y combos
- [ ] Cambiar cantidad tocando el número (teclado numérico Android)
- [ ] Intentar vender más que el stock → "STOCK INSUFICIENTE"
- [ ] Armar un ticket con varios productos
- [ ] Poner un pedido en espera y recuperarlo
- [ ] Aplicar un descuento (Total final)
- [ ] Cobrar en efectivo, transferencia y mixto
- [ ] Ver las ventas en Historial (offline)
- [ ] Anular una venta y verificar que el stock se repone
- [ ] Ver Resumen de jornada
- [ ] Reconectar Internet y sincronizar
- [ ] Confirmar que Ventas Nueva y Ventas Detalle se cargaron en Sheets
- [ ] Sincronizar de nuevo y confirmar que NO se duplica nada
- [ ] Confirmar que los combos descontaron sus componentes en Artículos
- [ ] Confirmar que las ventas anuladas no entran en ningún total

## Notas de diseño

- El stock nunca se ve en pantalla de venta; solo se usa para validar internamente.
- Los costos de cada venta quedan congelados en el momento de vender: si después cambiás el costo maestro de un artículo, no se altera la ganancia histórica.
- El descuento general se distribuye proporcionalmente entre las líneas del ticket.
- La sincronización es idempotente por `ID Venta`: reintentarla nunca duplica filas en Sheets.
- Álb./Figus./Naipes/Ext./Combos en la hoja "Feria" **no se acumulan**: cada venta o anulación dispara un recálculo completo de esos valores para esa fecha, releyendo Ventas Nueva + Ventas Detalle (solo Estado = "Confirmada") y expandiendo combos por Detalle Combos. Por eso un reintento de sincronización o una anulación nunca deja cantidades incorrectas ni duplicadas.
- El backend crea automáticamente una hoja técnica oculta **"Log Sync (no editar)"**. No es parte del modelo de negocio: es el registro de qué efecto de cada venta (descuento de stock de tal línea, reposición de tal línea al anular) ya se aplicó, para que un reintento nunca pueda repetirlo. No hay que tocarla a mano.

## 6. Reset de ventas de prueba (herramienta de mantenimiento)

`gas/Code.gs` incluye `auditoriaResetPruebas()` y `ejecutarResetVentasPrueba()`, pensadas para borrar de una sola vez todas las ventas hechas durante el desarrollo (todo ID Venta que arranca con `VTA-`) y devolver el stock exactamente a como estaba antes. No se llaman desde la app ni desde doGet/doPost — se ejecutan a mano desde el editor de Apps Script.

Procedimiento:

1. En el editor de Apps Script, seleccioná la función `auditoriaResetPruebas` y **Ejecutar**. Es de solo lectura: no modifica nada. Genera una hoja nueva **"AUDITORIA RESET (revisar)"** con la cantidad de ventas a eliminar, líneas de detalle, y el stock actual/a devolver/resultante de cada artículo afectado (los combos ya vienen expandidos a sus componentes; una venta ya Anulada no se cuenta dos veces porque su stock ya se había repuesto al anularla).
2. Revisá esa hoja con calma.
3. Si está todo correcto, en el código cambiá `RESET_PRUEBAS_AUTORIZADO` de `false` a `true`.
4. Ejecutá `ejecutarResetVentasPrueba()`. Revierte el stock, borra las filas de `Ventas Nueva`/`Ventas Detalle` de esas ventas, limpia sus entradas en el log de idempotencia y recalcula `Feria` (las fechas afectadas quedan en cero si no les quedan ventas reales).
5. Volvé a poner `RESET_PRUEBAS_AUTORIZADO` en `false`.
6. Recién después, en la app, Configuración → **"Borrar ventas de prueba (local)"** — borra únicamente el Historial y la cola de sincronización de ese dispositivo (nunca toca catálogo, artículos, combos ni configuración). Pide escribir `BORRAR` para confirmar.

No corras el paso 6 antes que el reset del lado de Sheets: el orden importa para no perder de vista qué faltaba sincronizar.

## 7. Corrección: sincronización y reset local (v2)

- **`js/sync.js`**: si el envío de una venta/anulación falla, antes de dejarla pendiente se consulta `action=checkVenta` en Apps Script (solo lectura) para confirmar si el servidor ya la había aplicado (por ejemplo, si la escritura llegó pero la confirmación no volvió al cliente por un corte de red o una redirección de Apps Script). Si el servidor confirma que ya está, se marca sincronizada sin reenviar.
- **`gas/Code.gs`**: nuevo `action=checkVenta&id=<IDVenta>` en `doGet`, de solo lectura. No modifica `Ventas Nueva`, `Ventas Detalle`, `Artículos` ni nada más.
- **"Borrar ventas de prueba (local)"** dejó de usar `window.prompt`/`alert`: en una PWA instalada en modo standalone esos diálogos nativos pueden no mostrarse, y la acción seguía de largo sin confirmar ni avisar, sin borrar nada. Ahora usa un modal propio de la app.
- **`service-worker.js`**: `CACHE_NAME` pasó a `v2` y el `install` ahora fuerza descarga fresca (`{cache:'reload'}`) de cada archivo, para asegurar que los dispositivos ya instalados actualicen a esta versión. **Recordatorio para el futuro:** cada vez que se publique un cambio en `index.html`, `css/` o `js/`, hay que subir el número de `CACHE_NAME` en `service-worker.js`, o los dispositivos ya instalados van a seguir sirviendo la versión vieja indefinidamente.

## 8. Corrección: PWA instalada no reabría en Android (v3)

Causa: rutas relativas ambiguas (`manifest.json` con `start_url`/`scope` relativos al propio manifest, registro del Service Worker sin `scope` explícito, sin `id` estable) combinadas con un `fetch` handler que no trataba las solicitudes de navegación (`request.mode === 'navigate'`) como un caso aparte. Al reabrir desde el ícono instalado, cualquier desajuste entre la URL de navegación real y la clave de caché podía terminar en una respuesta de red redirigida — que Chrome rechaza usar como respuesta a una navegación desde un Service Worker — dejando la app en blanco.

Corregido:
- `manifest.json`: `start_url`, `scope` e íconos con ruta absoluta `/mundo-figus-pos/...`, y `id` estable agregado.
- `index.html`: manifest, íconos, CSS y todos los `<script>` con ruta absoluta `/mundo-figus-pos/...`.
- `js/app.js`: `registrarSW()` registra con ruta y `scope` absolutos.
- `service-worker.js`: `CACHE_NAME` subido a `v3`; todas las rutas de `ARCHIVOS` son absolutas; el `fetch` handler ahora separa las solicitudes de navegación (network-first, con fallback explícito a `/mundo-figus-pos/index.html` cacheado) del resto del shell (cache-first, como antes).

**Importante:** como la app se movió de rutas relativas a `/mundo-figus-pos/...`, si alguna vez cambia el nombre del repositorio o el subdirectorio de publicación, hay que actualizar `BASE` en `service-worker.js` y las rutas en `manifest.json`/`index.html`/`app.js` en conjunto.

## 10. Corrección: la PWA instalada no relanzaba en Android

Causa encontrada: `"orientation": "landscape"` en `manifest.json`. Un WebAPK con orientación bloqueada puede quedar trabado al intentar recrear la Activity nativa cuando Android reclama el proceso en segundo plano (común en varios fabricantes, incluso sin cerrar la app manualmente); un reinicio completo del teléfono resetea ese estado y permite abrir una vez más, hasta repetirse el ciclo.

Corregido: se eliminó por completo el campo `orientation` de `manifest.json`, sin reemplazarlo por otro bloqueo. No se tocó `service-worker.js`, `start_url`, `scope`, `id` ni ningún código de inicialización — no se encontró causa ahí.

**Nota operativa:** como el cambio está en `manifest.json`, para que un dispositivo ya instalado lo tome hace falta desinstalar y volver a instalar el ícono (igual que con el cambio de `start_url`/`scope`/`id` anterior) — un manifest ya asociado a un WebAPK no se re-lee solo. `CACHE_NAME` en `service-worker.js` se dejó exactamente igual (`v3`), a pedido explícito; por eso, para una tablet/celular que YA tiene la app instalada y NO se reinstala, ni el manifest nuevo ni el CSS más compacto de este punto van a aplicarse hasta que se reinstale o se suba `CACHE_NAME` en una futura actualización.

## 11. Ajuste: más espacio vertical en horizontal (celular)

En `css/styles.css`, sin tocar la estructura ni la proporción catálogo/carrito:

- `#topbar`: de `padding: 10px 16px; height: 56px` a `padding: 6px 14px; height: 44px` (y `#posScreen` ajustado a `calc(100% - 44px)` para no dejar hueco).
- `.categorias button`: `padding` vertical de `16px` a `10px` (se mantiene `font-size: 16px` y `font-weight: 700`, siguen siendo cómodos al tacto).
- `.categorias`: `gap` y `margin-bottom` de `8px` a `6px` — menos separación entre categorías y respecto de lo que sigue.
- `.buscador`: `padding` de `12px` a `8px 12px`, `margin-bottom` de `8px` a `6px`.
- `.chips`: `margin-bottom` de `8px` a `6px` (el resto — fila única deslizable, `flex-shrink: 0` — queda intacto).

No se tocó `.grid-productos` en sí: al reducir todo lo de arriba, automáticamente le queda más alto disponible (sigue con `flex: 1; min-height: 0; overflow-y: auto`). En tablet, donde ya sobraba alto, este ajuste no cambia nada visualmente perceptible — el espacio extra recuperado en celular simplemente se suma al que ya tenía la grilla en pantallas más altas.

## 9. Corrección: scroll de colecciones y grilla de productos (v3)

`#panelProductos` heredaba `overflow: hidden` sin que sus hijos flex tuvieran `min-height: 0`, y `.chips` usaba `flex-wrap: wrap` — en pantallas bajas (celular Android horizontal), las colecciones que no entraban en una fila quedaban directamente fuera de la vista, sin ningún scroll que las alcanzara.

Corregido en `css/styles.css`:
- `.chips` pasa a fila única (`flex-wrap: nowrap`) con scroll horizontal táctil (`overflow-x: auto`, `-webkit-overflow-scrolling: touch`) y no se encoge (`flex-shrink: 0` en el contenedor y en cada botón).
- `#panelProductos`, `.grid-productos`, `#panelCarrito` y `.lineas-carrito` reciben `min-height: 0` (y `min-width: 0` donde corresponde) para que el scroll vertical de la grilla de productos y del carrito funcionen de forma independiente dentro de sus contenedores flex, como ya venía funcionando el resto del diseño de escritorio/tablet — no se tocó nada de ese comportamiento.
- La hoja "Feria Histórico" no se toca en ningún punto del código.

## 12. Tres mejoras: orden alfabético, colección en combos, Detalle para reposición

- **`js/catalog.js`**: `productosDeCaja()` y `combosDeCaja()` ahora ordenan A→Z por nombre (`localeCompare('es')`) antes de devolver el array. Es solo presentación: no reordena filas en Sheets ni cambia el orden de inserción en IndexedDB.
- **`js/app.js`** — `renderProductos()`: la tarjeta de combo muestra ahora una línea con el nombre de la colección arriba del nombre del combo (solo en combos, solo si tienen colección cargada) — permite distinguir combos con nombre genérico repetido entre colecciones ("Álbum + 20 sobres" de Margarita vs. de otra).
- **`js/app.js`** — `renderResumen()` / nueva `renderDetalleReposicion()`: agrega el bloque "Detalle para reposición" debajo de los totales existentes del Resumen de jornada, sin modificar nada de lo que ya mostraba.
- **`js/reports.js`** — `resumenJornada(fecha)`: en el mismo recorrido que ya usa para sumar Álb./Figus/Naipes/Ext./Combos (que ya filtra por `Estado === 'Confirmada'` y ya expande combos vía `Detalle Combos`), ahora también acumula cantidad física por `ID Artículo` en un `Map`, resuelve el nombre desde `articulos` local y lo ordena alfabéticamente al final como `resumen.detalleReposicion`. Usa exclusivamente el store local `ventas` (nunca Sheets ni otros canales), por lo que funciona igual para jornadas futuras y para el sábado/domingo ya guardados en la tablet, siempre que sigan en IndexedDB.
- **`index.html`**: agrega el contenedor `#detalleReposicionBody` dentro del modal de Resumen de jornada.
- **`css/styles.css`**: estilos mínimos para la etiqueta de colección en tarjetas de combo (`.coleccion-combo`) y el subtítulo del nuevo bloque (`.subtitulo-resumen`).

No se tocó `gas/Code.gs`, la sincronización, la estructura de IndexedDB (mismos stores/índices) ni ninguna otra pantalla.

**Nota sobre el Detalle para reposición retroactivo (sábado/domingo):** se calcula usando la composición *actual* de `Detalle Combos` en IndexedDB, porque la app no guarda una "foto" de la composición del combo en el momento de cada venta. Confirmado por el usuario que la composición de los combos vendidos esos días no cambió desde entonces, así que el resultado es exacto para ambas jornadas.

## 13. Arquitectura standalone + verificación de destino (v5) — corrige el cambio mensual de planilla

**Causa raíz del incidente de sincronización contra la planilla equivocada:** `gas/Code.gs` resolvía la planilla con `SpreadsheetApp.getActiveSpreadsheet()`, que depende de que el script esté *vinculado como contenedor* a un archivo de Sheets específico. El cambio mensual de planilla se hacía copiando el archivo de Sheets a un nuevo mes — pero esa copia **no lleva consigo** la vinculación del Apps Script contenedor: el script seguía apuntando al archivo del mes anterior aunque la tablet usara la misma URL `/exec` de siempre. Resultado: un domingo, ~170 ventas de feria se sincronizaron contra "Mundo Figus 09/2026" en vez de "Mundo Figus 10/2026", sin ningún error visible en la app (el servidor respondía `ok:true` igual, solo que escribía en el archivo equivocado).

Esta versión elimina esa dependencia y agrega una verificación obligatoria antes de cualquier operación que escriba datos.

### (B) Apps Script ahora es standalone, con la planilla configurada por `Script Properties`

- **`gas/Code.gs`**: `ss_()` ya NO usa `getActiveSpreadsheet()`. Lee el ID de la planilla desde `PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')` y abre esa planilla con `SpreadsheetApp.openById(id)`. Si la propiedad no está configurada, lanza un error explícito en vez de adivinar.
- Esto significa que, a partir de ahora, **el cambio mensual de planilla se hace cambiando únicamente el valor de `SPREADSHEET_ID` en Script Properties** del proyecto standalone — nunca hay que tocar código, volver a desplegar, ni generar una URL `/exec` nueva. La tablet sigue usando siempre la misma URL.
- Nuevo endpoint de solo lectura `action=infoDestino` en `doGet` (función `infoDestino_()`), que devuelve `{ nombre, id }` de la planilla actualmente configurada. No modifica nada.
- **No se tocó ni se eliminó el Apps Script viejo** vinculado como contenedor a "Mundo Figus 09/2026": este proyecto nuevo es standalone y separado; el viejo sigue existiendo intacto donde estaba.

### (A) MF Caja verifica y exige confirmar el destino antes de escribir

- **`js/sync.js`**: nueva `obtenerInfoDestino()` — consulta `action=infoDestino`, de solo lectura, nunca lanza excepción: devuelve `{ok:true, nombre, id}` o `{ok:false, error}`.
- **`js/app.js`**: nueva `pedirConfirmacionDestino({titulo, textoBloqueo, textoConfirmarHtml, accion})`, punto único de entrada para **SINCRONIZAR AHORA** y **ACTUALIZAR CATÁLOGO**:
  - Si `infoDestino` no puede verificarse (sin conexión, URL mal configurada, `SPREADSHEET_ID` sin configurar, etc.) → se bloquea la acción por completo (modal `#modalBloqueoDestino`, de cierre manual). No se borra nada de `syncQueue`, no se modifica ninguna venta local, no se envía ni se descarga nada. Queda todo tal cual hasta que se pueda verificar el destino y se reintente a mano.
  - Si se verifica → se muestra el nombre real de la planilla y se exige tocar **CONFIRMAR** (modal `#modalConfirmarDestino`) antes de ejecutar la acción. Tocar **CANCELAR** no ejecuta nada y no deja ninguna acción pendiente colgada.
  - Si `Sync.pendientesCount()` es `0` al tocar **SINCRONIZAR AHORA**, no hay nada para enviar: se omite la verificación/confirmación, se muestra un aviso ("No hay operaciones pendientes para sincronizar") y no pasa nada más.
- **Configuración** muestra, de forma puramente informativa, "Planilla activa: `<nombre>`" (o el motivo si no pudo verificarse) cada vez que se abre el modal.
- **`index.html`**: agrega `#modalConfirmarDestino` (con título dinámico `#confirmarDestinoTitulo`), `#modalBloqueoDestino` y el contenedor `#planillaActivaInfo` dentro de `#modalConfig`.

### Lo que esta versión explícitamente NO hace

- **No repara ni migra** las ~170 ventas del domingo que quedaron en "Mundo Figus 09/2026". Esa migración queda pendiente, a pedido explícito, para una etapa aparte (va a requerir un script de migración del lado del servidor, porque `syncQueue` ya está vacía en la tablet para esas ventas — el servidor viejo ya había respondido `ok:true` — así que no alcanza con solo re-sincronizar desde la tablet).
- **No modifica ni elimina** el Apps Script viejo vinculado a "Mundo Figus 09/2026".

### Puesta en marcha manual pendiente (se hace en conjunto, paso a paso)

1. Crear un proyecto de Apps Script **standalone** (no vinculado a ninguna planilla como contenedor) y pegar `gas/Code.gs`.
2. En ese proyecto: Configuración del proyecto → Propiedades del script → agregar `SPREADSHEET_ID` con el ID de "Mundo Figus 10/2026".
3. Implementar → Nueva implementación → "Aplicación web" (Ejecutar como: Yo; Acceso: Cualquiera con el enlace) → copiar la URL `/exec`.
4. En MF Caja → Configuración → pegar esa URL nueva → Guardar URL.
5. Abrir Configuración de nuevo y confirmar que "Planilla activa" muestra "Mundo Figus 10/2026".
6. Cada mes, a partir de ahora: solo cambiar el valor de `SPREADSHEET_ID` en Script Properties al ID de la planilla nueva. Nada más.

## 14. Sincronización 100% manual (v6) — se elimina toda sincronización automática

A pedido explícito, se simplificó el modelo: en vez de agregar un sistema adicional de "planilla autorizada" encima del automatismo existente, **se elimina directamente todo automatismo de sincronización**. La única forma de enviar operaciones a Google Sheets pasa a ser el botón **SINCRONIZAR AHORA**, con verificación y confirmación obligatoria del destino.

### Mecanismos automáticos eliminados/desactivados

Se revisó el proyecto completo (`grep` de `addEventListener('online'...)`, `setInterval`, `navigator.onLine` y todos los llamadores de `intentarSincronizar` en `js/*.js`) para confirmar que no queda ningún camino automático. Se eliminaron:

- **`js/sync.js` — `encolar(op)`**: ya no llama a `intentarSincronizar()` después de guardar la operación en `syncQueue`. Antes, si había conexión, disparaba el envío inmediatamente después de cada venta/anulación nueva; ahora solo encola y avisa al indicador visual.
- **`js/sync.js` — listener `window.addEventListener('online', ...)`**: eliminado por completo. Reconectarse a Internet ya no dispara ningún envío.
- **`js/sync.js` — `iniciarReintentoPeriodico()` (el `setInterval` de 25 segundos)**: eliminado por completo, junto con la variable `intervaloReintento`.
- **`js/app.js` — `init()`**: eliminado el `if (navigator.onLine) Sync.intentarSincronizar();` que se ejecutaba al abrir la app.

Lo único que sigue corriendo en segundo plano es `setInterval(actualizarBadgeSync, 5000)` en `js/app.js`, que **no sincroniza nada** — solo refresca el número de "Pendientes" en pantalla leyendo `syncQueue` localmente.

El único lugar del código que llama a `Sync.intentarSincronizar()` en todo el proyecto es ahora la acción confirmada de **SINCRONIZAR AHORA** en `js/app.js`.

### Comportamiento nuevo de SINCRONIZAR AHORA

1. Cuenta `Sync.pendientesCount()`.
2. Si es `0` → mensaje "No hay operaciones pendientes para sincronizar." y no hace nada más (no consulta `infoDestino`, no abre ningún modal).
3. Si hay pendientes → consulta `infoDestino`.
4. Si no puede verificarse → bloqueo total (`#modalBloqueoDestino`): "No se pudo verificar la planilla de destino. Las ventas permanecen guardadas en la tablet." No se toca `syncQueue`, no se modifica ninguna venta local, no se envía nada.
5. Si se verifica → modal de confirmación con título **SINCRONIZAR VENTAS** y el detalle:
   > Operaciones pendientes: N
   > Planilla destino: Mundo Figus 10/2026
   
   Con botones **CONFIRMAR** (recién ahí se ejecuta `intentarSincronizar()`) y **CANCELAR** (no se envía nada, todo queda pendiente igual que antes).

### Comportamiento nuevo de ACTUALIZAR CATÁLOGO

Mismo patrón: consulta `infoDestino`; si no se puede verificar, no descarga ni modifica el catálogo local; si se verifica, muestra el modal con título **ACTUALIZAR CATÁLOGO** y "Planilla origen: `<nombre>`", y solo descarga tras **CONFIRMAR**.

### Funcionamiento esperado durante la feria

Las ventas se guardan localmente en `IndexedDB` y se agregan a `syncQueue` exactamente como antes (sin cambios en `js/sales.js`, stock, combos, anulaciones, en espera, idempotencia, historial, resumen de jornada ni detalle para reposición). El contador de pendientes va aumentando con cada venta. MF Caja no intenta sincronizar por su cuenta en ningún momento. Recién cuando se toca **SINCRONIZAR AHORA** (generalmente al cerrar la jornada) se ve la cantidad pendiente y la planilla destino, se confirma, y ahí sí se envían las operaciones.

### Lo que esta versión explícitamente NO hace

- No modifica la lógica de ventas, stock local, combos, anulaciones, en espera, idempotencia, historial, resumen de jornada, detalle para reposición, ni la estructura de IndexedDB o de Google Sheets.
- No repara ni migra las ~170 ventas del domingo sincronizadas contra "Mundo Figus 09/2026" — sigue pendiente para una etapa posterior.
- No modifica ni elimina el Apps Script viejo vinculado a "Mundo Figus 09/2026".
- No agrega ningún mecanismo en MF Caja para cambiar `SPREADSHEET_ID` — ese cambio mensual sigue siendo exclusivamente manual, desde Script Properties en el editor de Apps Script.

### Archivos modificados en esta versión

- **`js/sync.js`**: eliminados `encolar()`'s auto-trigger, el listener `online` y el reintento periódico (ver arriba).
- **`js/app.js`**: `pedirConfirmacionDestino()` ahora acepta `titulo` y `textoConfirmarHtml` (HTML con salto de línea) en vez de un texto plano único; el handler de **SINCRONIZAR AHORA** ya no llama a `intentarSincronizar()` cuando no hay pendientes (solo avisa); se quitó el auto-intento de sincronización en `init()`; el botón CANCELAR del modal de confirmación de destino limpia explícitamente `destinoAccionPendiente`.
- **`index.html`**: `#modalConfirmarDestino` ahora tiene título dinámico (`#confirmarDestinoTitulo`) y su botón de cierre dice "CANCELAR".
- **`service-worker.js`**: `CACHE_NAME` subido a `v6`.
