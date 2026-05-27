-- Subfase 1.1 — Schema base: clubs, categories, teams
--
-- Modelo:
--   clubs (1) ──< categories (1) ──< teams
--
-- Notas:
-- - `gen_random_uuid()` viene del módulo pgcrypto, habilitado por defecto en Supabase.
-- - `updated_at` se mantiene vía trigger reusable `set_updated_at()`.
-- - RLS se activa aquí; las policies concretas llegan en la migración 1.7.

-- ─────────────────────────────────────────────────────────────────────────────
-- Función reusable para mantener updated_at
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Trigger BEFORE UPDATE reusable: pone updated_at = now().';

-- ─────────────────────────────────────────────────────────────────────────────
-- clubs
-- ─────────────────────────────────────────────────────────────────────────────

create table public.clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  slug        text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$'),
  locale      text not null default 'es' check (locale in ('es', 'en', 'va')),
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.clubs is
  'Club deportivo. Unidad raíz de aislamiento multi-tenant: todo lo demás cuelga de aquí.';

create trigger clubs_set_updated_at
  before update on public.clubs
  for each row execute function public.set_updated_at();

alter table public.clubs enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- categories
-- ─────────────────────────────────────────────────────────────────────────────

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 80),
  season      text not null check (season ~ '^[0-9]{4}-[0-9]{2}$'),
  order_idx   integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.categories is
  'Categoría dentro de un club y temporada. Ej: "Prebenjamín A" para temporada 2025-26.';
comment on column public.categories.season is
  'Temporada en formato YYYY-YY (ej. 2025-26). Validado por regex.';
comment on column public.categories.order_idx is
  'Orden manual para la UI. Menor primero.';

create index categories_club_season_idx on public.categories (club_id, season);

alter table public.categories enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- teams
-- ─────────────────────────────────────────────────────────────────────────────

create table public.teams (
  id            uuid primary key default gen_random_uuid(),
  category_id   uuid not null references public.categories(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  format        text not null check (format in ('F7', 'F8', 'F11')),
  color         text not null default '#10B981' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at    timestamptz not null default now()
);

comment on table public.teams is
  'Equipo concreto dentro de una categoría. Define el formato de juego y un color para UI.';
comment on column public.teams.format is
  'Formato de juego: F7, F8 (formato regional/canario) o F11.';
comment on column public.teams.color is
  'Color hex para identificar el equipo en calendarios y UI.';

create index teams_category_idx on public.teams (category_id);

alter table public.teams enable row level security;
