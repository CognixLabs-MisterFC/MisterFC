-- F7.6c — Régimen de sustituciones por CATEGORÍA + DIVISIÓN.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md §7.6c.
--
-- Sustituye el flag temporal categories.allow_reentry (7.6) por un modelo real:
-- la regla de cambios sale de (categoría, división) del equipo.
--   1. categories.kind: grupo de edad normalizado (querubín…veterano) — para
--      resolver el régimen sin depender del nombre libre en runtime.
--   2. teams.division: división en la que juega el equipo (slug).
--   3. substitution_regimes: FUENTE ÚNICA (categoría_kind + división → régimen
--      {tipo, max_cambios, reentrada}). También es el catálogo de divisiones por
--      categoría (el selector del alta/edición de equipo lee de aquí).
--   4. Se RETIRA categories.allow_reentry.

create extension if not exists unaccent;

-- 1. categories.kind ──────────────────────────────────────────────────────────
alter table public.categories add column kind text;

comment on column public.categories.kind is
  'F7.6c — grupo de edad normalizado (querubin/prebenjamin/benjamin/alevin/infantil/cadete/juvenil/amateur/senior/veterano). Backfill por nombre. Resuelve el régimen de cambios junto con teams.division.';

do $$
declare c record; norm text; k text;
begin
  for c in select id, name from public.categories loop
    norm := lower(unaccent(c.name));
    k := case
      when norm like 'querubin%'     then 'querubin'
      when norm like 'prebenjamin%'  then 'prebenjamin'
      when norm like 'benjamin%'     then 'benjamin'
      when norm like 'alevin%'       then 'alevin'
      when norm like 'infantil%'     then 'infantil'
      when norm like 'cadete%'       then 'cadete'
      when norm like 'juvenil%'      then 'juvenil'
      when norm like 'amateur%'      then 'amateur'
      when norm like 'senior%'       then 'senior'
      when norm like 'veterano%'     then 'veterano'
      else null
    end;
    if k is not null then
      update public.categories set kind = k where id = c.id;
    end if;
  end loop;
end $$;

-- 2. substitution_regimes (fuente única: catálogo de divisiones + régimen) ──────
create table public.substitution_regimes (
  category_kind text    not null,
  division      text    not null,
  ordinal       smallint not null default 0,          -- orden en el selector
  regime_type   text    not null check (regime_type in ('rolling','limited')),
  max_subs      smallint check (max_subs is null or max_subs > 0),
  allow_reentry boolean not null,
  primary key (category_kind, division),
  -- Coherencia: corrido = ilimitado+reentrada; limitado = tope+sin reentrada.
  constraint substitution_regimes_shape check (
    (regime_type = 'rolling' and max_subs is null and allow_reentry = true)
    or (regime_type = 'limited' and max_subs is not null and allow_reentry = false))
);

comment on table public.substitution_regimes is
  'F7.6c — datos de referencia: por (categoría_kind, división) el régimen de cambios {rolling ilimitado+reentrada | limited tope+sin reentrada}. Fuente única; también enumera las divisiones disponibles por categoría para el selector del equipo.';

-- Seed (tabla de la spec 7.6c). rolling = corrido; limited 7 = competición.
insert into public.substitution_regimes (category_kind, division, ordinal, regime_type, max_subs, allow_reentry) values
  -- Querubín: cualquier división → corrido.
  ('querubin',    'unica',      1, 'rolling', null, true),
  -- Prebenjamín 1ª,2ª → corrido.
  ('prebenjamin', 'primera',    4, 'rolling', null, true),
  ('prebenjamin', 'segunda',    5, 'rolling', null, true),
  -- Benjamín 1ª,2ª → corrido.
  ('benjamin',    'primera',    4, 'rolling', null, true),
  ('benjamin',    'segunda',    5, 'rolling', null, true),
  -- Alevín preferente,1ª,2ª → corrido.
  ('alevin',      'preferente', 3, 'rolling', null, true),
  ('alevin',      'primera',    4, 'rolling', null, true),
  ('alevin',      'segunda',    5, 'rolling', null, true),
  -- Infantil: 1ª,2ª corrido; autonómica,preferente → 7 cambios.
  ('infantil',    'autonomica', 2, 'limited', 7,    false),
  ('infantil',    'preferente', 3, 'limited', 7,    false),
  ('infantil',    'primera',    4, 'rolling', null, true),
  ('infantil',    'segunda',    5, 'rolling', null, true),
  -- Cadete: 1ª,2ª corrido; autonómica,preferente → 7 cambios.
  ('cadete',      'autonomica', 2, 'limited', 7,    false),
  ('cadete',      'preferente', 3, 'limited', 7,    false),
  ('cadete',      'primera',    4, 'rolling', null, true),
  ('cadete',      'segunda',    5, 'rolling', null, true),
  -- Juvenil: 3ª corrido; honor,autonómica,preferente,1ª,2ª → 7 cambios.
  ('juvenil',     'honor',      1, 'limited', 7,    false),
  ('juvenil',     'autonomica', 2, 'limited', 7,    false),
  ('juvenil',     'preferente', 3, 'limited', 7,    false),
  ('juvenil',     'primera',    4, 'limited', 7,    false),
  ('juvenil',     'segunda',    5, 'limited', 7,    false),
  ('juvenil',     'tercera',    6, 'rolling', null, true);

alter table public.substitution_regimes enable row level security;
-- Datos de referencia: lectura para cualquier usuario autenticado; sin escritura
-- por API (el seed se gestiona por migración).
create policy substitution_regimes_select on public.substitution_regimes
  for select to authenticated using (true);

-- 3. teams.division ───────────────────────────────────────────────────────────
alter table public.teams add column division text;

comment on column public.teams.division is
  'F7.6c — división en la que juega el equipo (slug; ver substitution_regimes). Define el régimen de cambios junto con categories.kind. Null si la categoría no tiene divisiones cargadas (p.ej. adultas).';

-- Backfill: a cada equipo existente, una división CORRIDA por defecto de su
-- categoría (la de menor tier disponible). El Alevín de prueba → división de
-- Alevín (corrido), como pide la spec. Equipos sin kind con régimen → null.
update public.teams t set division = (
  select sr.division
    from public.substitution_regimes sr
    join public.categories c on c.id = t.category_id
   where sr.category_kind = c.kind
     and sr.regime_type = 'rolling'
   order by sr.ordinal desc
   limit 1
);

-- 4. Retirar el flag temporal de 7.6 ──────────────────────────────────────────
alter table public.categories drop column allow_reentry;
