# Actualizacion de tarifas Total Energies (electricidad)

Este flujo actualiza solo tarifas ya existentes de `TOTAL ENERGIES` en `api/data-private/tarifas.v2.json`.
No recalcula comisiones.
No agrega productos nuevos.

## Archivos de entrada

- PDF de precios base o resumen vigente de electricidad para peninsula.
- Antes de tocar nada, confirma la fecha de vigencia del PDF.

## Reglas de actualizacion

- Actualiza solo productos que ya existan en `tarifas.v2.json`.
- No toques `api/data-private/comisiones.json`.
- Verifica que el nombre del producto en tarifas siga siendo exactamente el mismo que en comisiones.
- Si el PDF no trae un producto existente, no inventes valores nuevos: deja ese producto como esta.

## Reglas especificas ya validadas

- `CLASICA TE1..TE5`: usar los terminos fijos del bloque `CLASICA`.
- `CLASICA TE1..TE5 UNICA`:
  - usar el termino de energia `P1-P6` del bloque `UNICA`.
  - repetir ese mismo valor en todos los periodos de energia.
  - copiar las potencias de su `CLASICA TE*` correspondiente.
- `SOUL TE3..TE5`:
  - usar la tabla `SOUL TE3`, `SOUL TE4` y `SOUL TE5` del PDF.
  - ignorar cualquier tabla de otros productos indexados del mismo PDF, por ejemplo `JAZZ` o `ROCK`.
  - no mezclar la columna `Di` con el termino de energia.
- Si una potencia de `2.0TD` aparece como `P1` y `P3`, en el JSON debe quedar como `P1` y `P2`.

## Procedimiento recomendado

1. Abre el PDF y localiza los bloques `CLASICA`, `UNICA` y `SOUL`.
2. Convierte los importes de energia de `c€/kWh` a `€/kWh` dividiendo entre `100`.
3. Usa las potencias diarias tal como aparezcan en `€/kWdia`.
4. Actualiza solo los productos existentes dentro de `TOTAL ENERGIES`.
5. Revisa que `CLASICA TE* UNICA` conserve la misma potencia que `CLASICA TE*`.
6. Revisa que `SOUL` no haya sumado `Di` al `PMFi`.

## Verificacion minima

1. Comprueba la seccion `TOTAL ENERGIES` en `api/data-private/tarifas.v2.json`.
2. Verifica que los nombres actualizados sigan haciendo match con `api/data-private/comisiones.json`.
3. Si el PDF no trae un equivalente claro para un producto existente, dejalo sin cambios y documenta esa excepcion en el commit o PR.
