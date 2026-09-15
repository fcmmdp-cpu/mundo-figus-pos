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
- La hoja "Feria Histórico" no se toca en ningún punto del código.
