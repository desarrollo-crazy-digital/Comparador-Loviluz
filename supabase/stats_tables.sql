-- Script para crear las tablas de estadísticas y comparativas en Supabase.
-- Ejecuta este script en el SQL Editor de tu proyecto de Supabase.

-- 1. Tabla de comparativas (comparisons)
CREATE TABLE IF NOT EXISTS public.comparisons (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    commercial_code text,
    client_name text,
    cups text,
    energy_type text,
    tariff_type text,
    supplier text,
    product_name text,
    total double precision,
    savings double precision,
    annual_savings double precision,
    commission double precision,
    savings_percent double precision,
    current_bill double precision,
    offers jsonb
);

-- Habilitar acceso de lectura y escritura (RLS) según tus necesidades, o desactivar RLS temporalmente
ALTER TABLE public.comparisons DISABLE ROW LEVEL SECURITY;

-- 2. Tabla de contratos (contracts)
CREATE TABLE IF NOT EXISTS public.contracts (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    comparison_id text,
    commercial_code text,
    supplier text,
    product_name text,
    energy_type text,
    tariff_type text,
    total double precision,
    savings double precision,
    annual_savings double precision,
    commission double precision
);

ALTER TABLE public.contracts DISABLE ROW LEVEL SECURITY;

-- 3. Tabla de acumulados (comparison_rollups)
CREATE TABLE IF NOT EXISTS public.comparison_rollups (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    period_type text NOT NULL,
    period_start text NOT NULL,
    totals jsonb DEFAULT '{}'::jsonb,
    counts jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT comparison_rollups_period_unique UNIQUE (period_type, period_start)
);

ALTER TABLE public.comparison_rollups DISABLE ROW LEVEL SECURITY;
