-- Bug 2 · 2a — verifica admin_update_staff_profile.
-- Migración 20260712000000_bug2a_admin_update_staff_profile.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club A con admin, coordinador, y un entrenador (target). Club B con su
-- propio admin y un entrenador (para el caso cross-club).
--
-- Casos:
--   F1. admin de A edita el nombre del entrenador de A → full_name actualizado;
--       email en auth.users intacto (solo toca full_name).
--   F2. nombre vacío/espacios → name_required (no cambia nada).
--   G1. coordinador de A → forbidden (solo admin_club).
--   G2. el entrenador (no admin) → forbidden.
--   G3. admin de A intenta editar a un miembro de OTRO club → target_invalid.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('ba000000-0000-4000-8000-000000000001', 'Club A 2a', 'club-a-2a'),
  ('ba000000-0000-4000-8000-000000000002', 'Club B 2a', 'club-b-2a');

select pg_temp.new_test_user('ba0a0000-aaaa-4000-8000-000000000001', 'a-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0a0000-cccc-4000-8000-000000000001', 'a-coord@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0a0000-eeee-4000-8000-000000000001', 'a-coach@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0b0000-aaaa-4000-8000-000000000001', 'b-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0b0000-eeee-4000-8000-000000000001', 'b-coach@test.local', '{}'::jsonb);

-- profiles: el trigger handle_new_user ya los creó al insertar en auth.users
-- (full_name null). Les ponemos nombre vía upsert.
insert into public.profiles (id, full_name) values
  ('ba0a0000-aaaa-4000-8000-000000000001', 'Admin A'),
  ('ba0a0000-cccc-4000-8000-000000000001', 'Coord A'),
  ('ba0a0000-eeee-4000-8000-000000000001', 'Nombre Mal Escrito'),
  ('ba0b0000-aaaa-4000-8000-000000000001', 'Admin B'),
  ('ba0b0000-eeee-4000-8000-000000000001', 'Coach B')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role) values
  ('ba0a0000-aaaa-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'admin_club'),
  ('ba0a0000-cccc-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'coordinador'),
  ('ba0a0000-eeee-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('ba0b0000-aaaa-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002', 'admin_club'),
  ('ba0b0000-eeee-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000002', 'entrenador_principal');

-- ── F1. admin de A edita el nombre del entrenador de A ───────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ba0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.admin_update_staff_profile(
    'ba000000-0000-4000-8000-000000000001',
    'ba0a0000-eeee-4000-8000-000000000001',
    '  Nombre Corregido  '
  );

  if not exists (select 1 from public.profiles
                  where id='ba0a0000-eeee-4000-8000-000000000001'
                    and full_name='Nombre Corregido') then
    raise exception 'FAIL [F1]: el full_name debería quedar trim+actualizado a "Nombre Corregido"';
  end if;
end $$;

-- ── F2. nombre vacío → name_required (no cambia nada) ────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',
      'ba0a0000-eeee-4000-8000-000000000001',
      '   '
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [F2]: nombre vacío debería fallar'; end if;
  if not exists (select 1 from public.profiles
                  where id='ba0a0000-eeee-4000-8000-000000000001' and full_name='Nombre Corregido') then
    raise exception 'FAIL [F2]: el nombre no debería haber cambiado tras el fallo';
  end if;
end $$;

-- ── G1. coordinador de A → forbidden ─────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"ba0a0000-cccc-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',
      'ba0a0000-eeee-4000-8000-000000000001',
      'Hackeo Coord'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: coordinador NO debería poder editar el nombre'; end if;
end $$;

-- ── G2. el entrenador (no admin) → forbidden ─────────────────────────────────
set local "request.jwt.claims" = '{"sub":"ba0a0000-eeee-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',
      'ba0a0000-eeee-4000-8000-000000000001',
      'Auto Hack'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2]: un no-admin NO debería poder editar nombres'; end if;
end $$;

-- ── G3. admin de A → target de OTRO club → target_invalid ────────────────────
set local "request.jwt.claims" = '{"sub":"ba0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',   -- club A
      'ba0b0000-eeee-4000-8000-000000000001',   -- coach de club B
      'Intruso'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G3]: editar a un miembro de otro club debería fallar (target_invalid)'; end if;
end $$;

reset role;

-- G3 (cont.): el perfil del otro club quedó intacto (como superuser, sin RLS).
do $$
begin
  if not exists (select 1 from public.profiles
                  where id='ba0b0000-eeee-4000-8000-000000000001' and full_name='Coach B') then
    raise exception 'FAIL [G3]: el perfil del otro club NO debe cambiar';
  end if;
end $$;

-- F1 (cont.): el email de login (auth.users) quedó intacto — la función solo
-- toca profiles.full_name. Se verifica como superuser (authenticated no puede
-- leer auth.users).
do $$
begin
  if not exists (select 1 from auth.users
                  where id='ba0a0000-eeee-4000-8000-000000000001'
                    and email='a-coach@test.local') then
    raise exception 'FAIL [F1]: el email de login NO debe cambiar';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Bug2a: admin_update_staff_profile (admin edita full_name de su club, solo ese campo, gateado, cross-club y no-admin rechazados).'
\echo '──────────────────────────────────────────────'
