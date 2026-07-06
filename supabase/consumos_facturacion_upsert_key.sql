-- Clave opcional para acelerar/permitir upserts directos de consumos sin borrar datos.
-- El importador actual compara antes de escribir, asi que no depende de este indice.
-- Si ya existen duplicados exactos por esta clave, este indice fallara y habra que deduplicar primero.

CREATE UNIQUE INDEX IF NOT EXISTS consumos_facturacion_upsert_key
  ON public.consumos_facturacion (cups, fecha_inicio, fecha_fin, tipo_lectura);
