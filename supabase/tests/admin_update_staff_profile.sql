-- Bug 2 · 2a — verifica admin_update_staff_profile.
-- Migración 20260712000000_bug2a_admin_update_staff_profile.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club A con admin, DIRECTOR, coordinador, y un entrenador (target). Club B
-- con su propio admin y un entrenador (para el caso cross-club).
--
-- Casos:
--   F1. admin de A edita el nombre del entrenador de A → full_name actualizado;
--       email en auth.users intacto (solo toca full_name).
--   F2. nombre vacío/espacios → name_required (no cambia nada).
--   F3. DIRECTOR de A edita el nombre → igual que el admin (mig 20261085000000).
--   G1. coordinador de A → forbidden (dirección sí, coordinación no).
--   G2. el entrenador (no admin) → forbidden.
--   G3. admin de A intenta editar a un miembro de OTRO club → target_invalid.
--
-- W-7 (mig 20261111000000) — «no sobre uno mismo», que hasta entonces solo vivía en
-- la pantalla:
--   T0. La migración está aplicada (si no, W1/W2 pasarían por el motivo equivocado).
--   W1. El admin de A se edita A SÍ MISMO → forbidden, y su nombre NO cambia.
--       Es el caso que ANTES funcionaba: pasa el gate de rol y el de target.
--   W2. El DIRECTOR de A se edita a sí mismo → forbidden también (no es cosa de un
--       rol concreto).
--   W3. El candado va ANTES del gate de rol: se comprueba por el MENSAJE, que es
--       'forbidden' y no 'target_invalid', con un target que no es miembro del club.
\ir helpers/auth_users.sql

begin;

-- ── T0. ¿Está aplicada la 20261111000000? ───────────────────────────────────
-- Sin esto, W1 y W2 podrían pasar por cualquier otro motivo y el test mentiría.
do $$
begin
  if position('p_target_profile_id = v_uid' in
              pg_get_functiondef('public.admin_update_staff_profile(uuid,uuid,text)'::regprocedure)) = 0 then
    raise exception 'FAIL [T0]: admin_update_staff_profile no lleva el candado de W-7 — la migración 20261111000000 no está aplicada en esta BD';
  end if;
end $$;

insert into public.clubs (id, name, slug) values
  ('ba000000-0000-4000-8000-000000000001', 'Club A 2a', 'club-a-2a'),
  ('ba000000-0000-4000-8000-000000000002', 'Club B 2a', 'club-b-2a');

select pg_temp.new_test_user('ba0a0000-aaaa-4000-8000-000000000001', 'a-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0a0000-dddd-4000-8000-000000000001', 'a-dir@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0a0000-cccc-4000-8000-000000000001', 'a-coord@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0a0000-eeee-4000-8000-000000000001', 'a-coach@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0b0000-aaaa-4000-8000-000000000001', 'b-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ba0b0000-eeee-4000-8000-000000000001', 'b-coach@test.local', '{}'::jsonb);

-- profiles: el trigger handle_new_user ya los creó al insertar en auth.users
-- (full_name null). Les ponemos nombre vía upsert.
insert into public.profiles (id, full_name) values
  ('ba0a0000-aaaa-4000-8000-000000000001', 'Admin A'),
  ('ba0a0000-dddd-4000-8000-000000000001', 'Dir A'),
  ('ba0a0000-cccc-4000-8000-000000000001', 'Coord A'),
  ('ba0a0000-eeee-4000-8000-000000000001', 'Nombre Mal Escrito'),
  ('ba0b0000-aaaa-4000-8000-000000000001', 'Admin B'),
  ('ba0b0000-eeee-4000-8000-000000000001', 'Coach B')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role) values
  ('ba0a0000-aaaa-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'admin_club'),
  ('ba0a0000-dddd-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'director'),
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

-- ── F3. el DIRECTOR de A edita el nombre, igual que el admin ────────────────
-- Antes de la migración 20261085000000 esto era `forbidden`: la condición se
-- escribió con un rol suelto (`role = 'admin_club'`) en vez de con la dirección
-- del club, y el director cayó fuera sin que nadie lo decidiera.
set local "request.jwt.claims" = '{"sub":"ba0a0000-dddd-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.admin_update_staff_profile(
    'ba000000-0000-4000-8000-000000000001',
    'ba0a0000-eeee-4000-8000-000000000001',
    '  Nombre Del Director  '
  );

  if not exists (select 1 from public.profiles
                  where id='ba0a0000-eeee-4000-8000-000000000001'
                    and full_name='Nombre Del Director') then
    raise exception 'FAIL [F3]: el director debería poder editar el nombre, igual que el admin';
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

-- ── W1. el admin de A se edita a SÍ MISMO ───────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ba0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_msg text := '';
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',   -- club A
      'ba0a0000-aaaa-4000-8000-000000000001',   -- ÉL MISMO
      'Me Cambio El Nombre'
    );
  exception when others then v_msg := sqlerrm; end;
  -- Se comprueba el MENSAJE, no solo que falle: un `when others` a secas dejaría
  -- pasar un fallo por cualquier otro motivo y el test valdría lo mismo roto.
  if v_msg <> 'forbidden' then
    raise exception 'FAIL [W1]: editarse a uno mismo debe dar forbidden; dio %', coalesce(nullif(v_msg,''),'(ningún error)');
  end if;
end $$;

-- ── W2. el DIRECTOR de A se edita a sí mismo ────────────────────────────────
set local "request.jwt.claims" = '{"sub":"ba0a0000-dddd-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_msg text := '';
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',
      'ba0a0000-dddd-4000-8000-000000000001',   -- ÉL MISMO
      'Dir Se Renombra'
    );
  exception when others then v_msg := sqlerrm; end;
  if v_msg <> 'forbidden' then
    raise exception 'FAIL [W2]: el director tampoco puede editarse; dio %', coalesce(nullif(v_msg,''),'(ningún error)');
  end if;
end $$;

-- ── W3. el candado va ANTES del gate de target ──────────────────────────────
-- El admin de B pide sobre el club A y con ÉL MISMO como target: no es miembro de
-- A, así que si el candado fuera después vendría 'forbidden' del gate de rol... que
-- es el mismo mensaje. Lo que de verdad ordena esto es el caso de arriba (W1), donde
-- el actor SÍ pasa rol y target. Aquí solo se fija que un self nunca devuelve
-- 'target_invalid', que es lo que saldría si el candado estuviera al final.
set local "request.jwt.claims" = '{"sub":"ba0b0000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_msg text := '';
begin
  begin
    perform public.admin_update_staff_profile(
      'ba000000-0000-4000-8000-000000000001',   -- club A (no es el suyo)
      'ba0b0000-aaaa-4000-8000-000000000001',   -- ÉL MISMO
      'Nombre'
    );
  exception when others then v_msg := sqlerrm; end;
  if v_msg = 'target_invalid' then
    raise exception 'FAIL [W3]: un self no debe llegar al gate de target; el candado va antes';
  end if;
  if v_msg <> 'forbidden' then
    raise exception 'FAIL [W3]: esperaba forbidden; dio %', coalesce(nullif(v_msg,''),'(ningún error)');
  end if;
end $$;

reset role;

-- W1/W2 (cont.): ninguno de los dos nombres cambió (como superuser, sin RLS).
do $$
begin
  if not exists (select 1 from public.profiles
                  where id='ba0a0000-aaaa-4000-8000-000000000001' and full_name='Admin A') then
    raise exception 'FAIL [W1]: el nombre del admin NO debe cambiar';
  end if;
  if not exists (select 1 from public.profiles
                  where id='ba0a0000-dddd-4000-8000-000000000001' and full_name='Dir A') then
    raise exception 'FAIL [W2]: el nombre del director NO debe cambiar';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Bug2a: admin_update_staff_profile (la DIRECCIÓN —admin y director— edita full_name de su club, solo ese campo, gateado; coordinador, no-admin y cross-club rechazados; W-7: NO sobre uno mismo).'
\echo '──────────────────────────────────────────────'
