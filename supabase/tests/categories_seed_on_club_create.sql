-- Rework C · C2 — verifica que create_club_with_admin siembra el catálogo estándar.
-- Migración 20260703000000_rework_c2_seed_categories_on_club_create.sql.
--
-- Convención del repo: psql ON_ERROR_STOP=1; asserts con DO + raise exception;
-- BEGIN/ROLLBACK. El contexto de auth (auth.uid()) se simula con role authenticated
-- + request.jwt.claims, igual que rls_clubs_bootstrap.sql.
--
-- Casos:
--   S1. Club creado por la RPC → exactamente 10 categorías is_standard=true.
--   S2. Sin custom (is_standard=false) en el club nuevo.
--   S3. Los 10 kinds canónicos presentes.
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('c2000000-0000-4000-8000-000000000001', 'c2newuser@test.local', '{"full_name":"C2 New"}'::jsonb);

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c2000000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_club_id uuid;
  v_std int;
  v_custom int;
  v_kinds int;
begin
  v_club_id := public.create_club_with_admin('Club C2 Seed', 'club-c2-seed-test', 'es');
  if v_club_id is null then
    raise exception 'FAIL [S0]: la RPC devolvió NULL';
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
\echo '✅ C2: club nuevo nace con las 10 categorías estándar.'
\echo '──────────────────────────────────────────────'
