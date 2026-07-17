-- Test de RLS en clubs INSERT: la tabla clubs está cerrada a INSERT directo.
--
-- ⚠️ PODADO en F15-C2-followup (eliminación del autoservicio de crear club): este
-- fixture tenía además T2/T3/T4 que ejercitaban la RPC create_club_with_admin.
-- Esa RPC se ELIMINÓ (migración 20261028) porque el autoservicio de crear club es
-- un vestigio de la era pre-F14D: los clubes los crea Jose desde la consola
-- (platform_create_club) y el admin entra por invitación. NO reintroducir T2/T3/T4
-- ni la RPC: ya no existe ninguna vía de autoservicio y sería reabrir la deuda.
--
-- Lo que SIGUE siendo válido y se conserva:
--   T1. INSERT directo en clubs desde authenticated está BLOQUEADO (policy
--       clubs_insert_forbidden). La creación legítima va por platform_create_club
--       (SECURITY DEFINER, gate is_superadmin), que bypassa esta policy.
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('dddddddd-dddd-dddd-dddd-dddddddddddd', 'newuser@test.local', '{"full_name":"NewUser"}'::jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: INSERT directo en clubs bloqueado para authenticated
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.clubs (name, slug) values ('Direct Insert', 'direct-insert-test');
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T1]: INSERT directo en clubs debería estar bloqueado';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ clubs INSERT directo bloqueado (creación solo por platform_create_club).'
\echo '──────────────────────────────────────────────'
