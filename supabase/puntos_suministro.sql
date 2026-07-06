-- Extiende la tabla de puntos de suministro para guardar metadatos de localización.
-- Ejecuta esto en el SQL Editor del proyecto Supabase donde viva la tabla.

ALTER TABLE public.puntos_suministro
  ADD COLUMN IF NOT EXISTS referencia_catastral text;

ALTER TABLE public.puntos_suministro
  ADD COLUMN IF NOT EXISTS direccion text;

COMMENT ON COLUMN public.puntos_suministro.referencia_catastral
  IS 'Referencia catastral del punto de suministro desde referenciaCatastralPS.';

COMMENT ON COLUMN public.puntos_suministro.direccion
  IS 'Direccion construida desde tipoViaPS, viaPS y numFincaPS.';
