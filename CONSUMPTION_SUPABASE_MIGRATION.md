# Migracion de la base de consumo a otro proyecto Supabase

Esta migracion deja `stats` como esta y separa solo la tabla de consumo. El endpoint `/api/consumo-anual` pasa a leer desde Supabase y deja de depender de Azure.

## Variables nuevas

Añade estas variables al `.env` del proyecto:

```env
# Proyecto destino para consumo
SUPABASE_CONSUMPTION_URL=https://tu-proyecto-pago.supabase.co
SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY=tu_service_role_key_del_proyecto_pago
SUPABASE_CONSUMPTION_TABLE=comparator_consumption

# Solo para la migracion desde el proyecto antiguo
SUPABASE_CONSUMPTION_SOURCE_URL=https://tu-proyecto-free.supabase.co
SUPABASE_CONSUMPTION_SOURCE_SERVICE_ROLE_KEY=tu_service_role_key_del_proyecto_free
```

Los scripts de consumo priorizan estas variables. Si no existen, hacen fallback a `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.

## Preparar el proyecto nuevo

Ejecuta primero este SQL en el Supabase destino:

```sql
create table if not exists public.comparator_consumption (
  cups text primary key,
  annual_kwh double precision not null
);
```

Tambien lo tienes en [supabase/comparator_consumption.sql](/Users/migueldelgado/Desktop/Comparador%20React/supabase/comparator_consumption.sql).

## Migracion directa entre proyectos

1. Validar accesos sin copiar datos:

```bash
npm run supabase:consumption:migrate -- --dry-run
```

2. Copiar toda la tabla al proyecto nuevo:

```bash
npm run supabase:consumption:migrate -- --truncate-destination
```

## Cargar desde la SQLite local

Si prefieres reconstruir la tabla desde `sips_comparator.sqlite` en vez de copiarla desde Supabase:

```bash
npm run supabase:consumption:upload -- --truncate
```

## Vaciar el destino de consumo

```bash
npm run supabase:consumption:clear
```

## Notas

- `stats` no usa estas variables nuevas.
- `/api/consumo-anual` usa `SUPABASE_CONSUMPTION_URL` y `SUPABASE_CONSUMPTION_SERVICE_ROLE_KEY`.
- La migracion usa `upsert` por `cups`, asi que puedes reintentar sin duplicar filas.
- Si quieres probar por lotes, usa `--max-batches 1`.
- Cuando confirmes que el lookup funciona en Supabase, ya puedes retirar cualquier variable antigua de Azure si todavía existiera en algún despliegue heredado.
