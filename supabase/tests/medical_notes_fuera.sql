-- `players.medical_notes` ya no existe, y la médica solo vive en `player_medical`.
-- Migración 20261093000000.
--
-- Cubre:
--   [1] La columna NO está en `players` — con ancla positiva: la tabla y el resto de
--       columnas siguen ahí. Una ausencia sola no afirma nada: si el fixture midiera
--       mal (otro esquema, tabla renombrada), "no está" saldría verde por el motivo
--       equivocado.
--   [2] No queda ningún privilegio de columna a su nombre. Es consecuencia del DROP,
--       no un paso aparte, pero es justo el privilegio que abría el agujero
--       (SELECT para `authenticated` sobre una columna de salud) y conviene que
--       quede escrito.
--   [3] Nadie del esquema la nombra: ninguna función y ninguna vista. Esto es el
--       guard de verdad — caza que una migración futura la reintroduzca de rebote.
--   [4] El único sitio donde caben datos de salud sigue CERRADO: `player_medical`
--       con RLS activa, 0 policies y sin privilegios para `authenticated`. Si esto
--       se rompiera, borrar la columna no habría servido de nada.
--
-- Estilo: aserciones con raise exception. Privilegios con has_*_privilege, NUNCA
-- provocando el 42501. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ── [1] La columna no está; la tabla sí ──────────────────────────────────────
do $$
begin
  -- Ancla positiva PRIMERO: medimos la tabla correcta.
  if to_regclass('public.players') is null then
    raise exception '[1] no existe public.players: el test no esta midiendo lo que cree';
  end if;
  if not exists (
    select 1 from pg_attribute
    where attrelid = 'public.players'::regclass and attname = 'first_name' and not attisdropped
  ) then
    raise exception '[1] players.first_name no esta: el fixture mide mal, la ausencia de medical_notes no prueba nada';
  end if;

  if exists (
    select 1 from pg_attribute
    where attrelid = 'public.players'::regclass and attname = 'medical_notes' and not attisdropped
  ) then
    raise exception '[1] players.medical_notes sigue existiendo';
  end if;
end $$;

-- ── [2] Sin privilegios de columna a su nombre ───────────────────────────────
do $$
declare v_cols text[];
begin
  select coalesce(array_agg(distinct grantee::text || ' (' || privilege_type::text || ')'), '{}')
    into v_cols
  from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'players' and column_name = 'medical_notes';

  if array_length(v_cols, 1) > 0 then
    raise exception '[2] quedan privilegios sobre players.medical_notes: %', v_cols;
  end if;

  -- Ancla positiva: el grant por columna de `players` sigue vivo para lo que sí se lee.
  if not has_column_privilege('authenticated', 'public.players'::regclass, 'first_name', 'SELECT') then
    raise exception '[2] authenticated ya no puede leer players.first_name: se ha quitado de mas';
  end if;
end $$;

-- ── [3] Nadie la nombra en el esquema vivo ───────────────────────────────────
do $$
declare
  v_funcs text[];
  v_views text[];
begin
  select coalesce(array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text), '{}')
    into v_funcs
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc ~* 'medical_notes';

  if array_length(v_funcs, 1) > 0 then
    raise exception '[3] funciones que siguen nombrando medical_notes: %', v_funcs;
  end if;

  select coalesce(array_agg(c.relname::text order by c.relname::text), '{}')
    into v_views
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm')
    and pg_get_viewdef(c.oid) ~* 'medical_notes';

  if array_length(v_views, 1) > 0 then
    raise exception '[3] vistas que siguen nombrando medical_notes: %', v_views;
  end if;

  -- Ancla positiva: el barrido encuentra código. Si no, no está probando nada.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'player_medical'
  ) then
    raise exception '[3] el barrido no encuentra ni player_medical: el lector esta roto';
  end if;
end $$;

-- ── [4] `player_medical` sigue siendo el único sitio, y cerrado ──────────────
do $$
declare
  v_policies int;
  v_privs text[];
begin
  if to_regclass('public.player_medical') is null then
    raise exception '[4] no existe public.player_medical: la medica no tiene donde vivir';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.player_medical'::regclass) then
    raise exception '[4] player_medical tiene la RLS APAGADA';
  end if;

  select count(*) into v_policies from pg_policies
  where schemaname = 'public' and tablename = 'player_medical';
  if v_policies <> 0 then
    raise exception '[4] player_medical ha ganado % policies: deja de estar cerrada al cliente', v_policies;
  end if;

  select coalesce(array_agg(p.priv order by p.priv), '{}') into v_privs
  from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
  where has_table_privilege('authenticated', 'public.player_medical'::regclass, p.priv);
  if array_length(v_privs, 1) > 0 then
    raise exception '[4] authenticated ha ganado privilegios en player_medical: %', v_privs;
  end if;

  -- Ancla positiva: la puerta legítima sigue abierta.
  if not has_function_privilege('authenticated', 'public.get_player_medical(uuid,text,text)', 'EXECUTE') then
    raise exception '[4] authenticated no puede ejecutar get_player_medical: la unica puerta se ha cerrado';
  end if;
end $$;

rollback;
