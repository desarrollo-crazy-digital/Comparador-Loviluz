create table if not exists public.comparator_consumption (
  cups text primary key,
  annual_kwh double precision not null
);
