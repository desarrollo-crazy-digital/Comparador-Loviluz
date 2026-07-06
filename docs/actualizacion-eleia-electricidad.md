# Actualizacion de tarifas Eleia (electricidad)

Este flujo actualiza solo tarifas de Eleia en `api/data-private/tarifas.v2.json`.
No recalcula comisiones.
No agrega productos nuevos.

## Archivo de entrada

- Usa el Excel de electricidad S2626 de Eleia.
- En 2.0TD, si la potencia viene en `P1` y `P3`, el parser la guarda como `P1` y `P2`.
- La potencia del Excel se convierte a valor diario dividiendo entre `365`.

## Comando

```bash
node scripts/update-eleia-s2026-prices.mjs "/ruta/al/Resumen precios S2626 Electricidad.xlsx"
```

## Que actualiza

- Productos Eleia ya existentes en `tarifas.v2.json`.
- En el estado actual del repo: `TDE*`, `TEE*` y `BOE*`.

## Que no hace

- No toca `api/data-private/comisiones.json`.
- No crea productos nuevos aunque existan en el Excel.
- Si el Excel trae `SIMPLEX`, `TMAE*` o `TRADERPOOL*` y esos productos no existen en `tarifas.v2.json`, se omiten.

## Verificacion minima

1. Ejecuta el script y revisa el resumen.
2. Comprueba la seccion `ELEIA` en `api/data-private/tarifas.v2.json`.
3. Verifica que los nombres de producto actualizados sigan haciendo match con sus claves ya existentes en `api/data-private/comisiones.json`.

## Match con comisiones

- `TDE PLUS`, `TDE0`, `TDE1`, `TDE2`, `TDE3`
- `TEE0`, `TEE1`, `TEE2`, `TEE3`
- `BOE0`, `BOE1`, `BOE2`, `BOE3`

Mientras esos nombres no cambien, las comisiones siguen correspondiendo al producto correcto sin recalcular nada.
