-- INVARIANTE DE PRODUCTO — un club nuevo nace con el catálogo estándar completo.
-- Reork C · C2 (seed en seed_standard_categories, mig 20260702/20260703).
--
-- ⚠️ REAPUNTADO en F15-C2-followup (#373): el invariante se probaba a través de
-- create_club_with_admin (self-serve, ELIMINADA en mig 20261028). El seed NO vivía
-- en esa RPC: vive en seed_standard_categories, que hoy invoca el ÚNICO vehículo de
-- alta de club que queda, platform_create_club (consola, gate is_superadmin). Este
-- test se conserva reapuntado a ese camino — el invariante sigue cubierto donde de
-- verdad importa. NO probamos aquí la RPC borrada.
--
-- Convención del repo: psql ON_ERROR_STOP=1; asserts con DO + raise exception;
-- BEGIN/ROLLBACK. El contexto de auth (auth.uid()) se simula con role authenticated
-- + request.jwt.claims. platform_create_club exige is_superadmin() → el caller se
-- siembra en platform_admins (como postgres, antes del cambio de rol).
--
-- Casos:
--   S1. Club creado por platform_create_club → exactamente 10 categorías is_standard=true.
--   S2. Sin custom (is_standard=false) en el club nuevo.
--   S3. Los 10 kinds canónicos presentes.
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('c2000000-0000-4000-8000-000000000001', 'c2super@test.local', '{"full_name":"C2 Super"}'::jsonb);
-- El caller es SUPERADMIN de plataforma (bypass RLS al insertar como postgres).
insert into public.platform_admins (profile_id) values ('c2000000-0000-4000-8000-000000000001');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_club_id uuid;
  v_std int;
  v_custom int;
  v_kinds int;
begin
  v_club_id := public.platform_create_club('Club C2 Seed', 'club-c2-seed-test', 'es');
  if v_club_id is null then
    raise exception 'FAIL [S0]: platform_create_club devolvió NULL';
  end if;

  -- S1. 10 estándar.
  select count(*) into v_std from public.categories
   where club_id = v_club_id and is_standard;
  if v_std <> 10 then
    raise exception 'FAIL [S1]: club nuevo debería tener 10 estándar, tiene %', v_std;
  end if;

  -- S2. Sin custom.
  select count(*) into v_custom from public.categories
   where club_id = v_club_id and not is_standard;
  if v_custom <> 0 then
    raise exception 'FAIL [S2]: club nuevo no debería tener custom, tiene %', v_custom;
  end if;

  -- S3. Los 10 kinds canónicos.
  select count(*) into v_kinds from public.categories
   where club_id = v_club_id
     and kind in ('querubin','prebenjamin','benjamin','alevin','infantil',
                  'cadete','juvenil','amateur','senior','veterano');
  if v_kinds <> 10 then
    raise exception 'FAIL [S3]: faltan kinds canónicos, hay %', v_kinds;
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ C2: club nuevo (platform_create_club) nace con las 10 categorías estándar.'
\echo '──────────────────────────────────────────────'
