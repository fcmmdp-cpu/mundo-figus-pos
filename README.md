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
