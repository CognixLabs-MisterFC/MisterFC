-- Verifica `club_pending_invitation_by_email` — mig 20261095000000.
--
-- La pregunta que faltaba: «¿ese correo ya tiene invitación PENDIENTE aquí?».
-- Hermana de `club_member_by_email` (mig 86) y con el mismo gate; lo que cambia es
-- dónde mira: `invitations` en vez de `memberships`. Existe porque la membership
-- NACE AL ACEPTAR, así que entre invitar y aceptar la otra función no ve nada.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception; la sesión
-- con `set local role authenticated` + `request.jwt.claims`.
--
-- Setup: club A con admin, entrenador ayudante y una familia (rol 'jugador'), y
-- club B con un miembro propio. En A, dos jugadores y cinco invitaciones para el
-- mismo correo de tutor, cada una en un estado distinto.
--
-- Casos:
--   F1. admin de A pregunta por el correo con UNA pendiente → 1 fila, con su
--       invitación, su jugador y su rol.
--   F2. el mismo correo con MAYÚSCULAS y espacios → la misma fila.
--   F3. dos pendientes del mismo correo (dos hermanos) → 2 filas, en orden de
--       creación: la primera es el ancla del correo que se mandó.
--   F4. entrenador AYUDANTE → también puede preguntar (crea jugadores).
--   F5. una pendiente de STAFF (sin jugador) también sale, con player_id NULL: la
--       pregunta es por el correo, no por el rol.
--   G1. invitación ya ACEPTADA → 0 filas. Ya no cubre a nadie.
--   G2. invitación CADUCADA → 0 filas. Su enlace ya no vale.
--   G3. pendiente en OTRO club → 0 filas.
--   G4. correo sin invitaciones, y correo vacío → 0 filas.
--   G5. una familia (rol 'jugador') pregunta → forbidden.
--   G6. alguien de fuera del club pregunta → forbidden.
--   ACL. anon no puede ejecutarla; authenticated sí.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('cb000000-0000-4000-8000-000000000001', 'Club A cpi', 'club-a-cpi'),
  ('cb000000-0000-4000-8000-000000000002', 'Club B cpi', 'club-b-cpi');

select pg_temp.new_test_user('cb0a0000-aaaa-4000-8000-000000000001', 'cpi-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cb0a0000-eeee-4000-8000-000000000001', 'cpi-ayudante@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cb0a0000-ffff-4000-8000-000000000001', 'cpi-familia@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cb0b0000-ffff-4000-8000-000000000001', 'cpi-otroclub@test.local', '{}'::jsonb);

insert into public.profiles (id, full_name) values
  ('cb0a0000-aaaa-4000-8000-000000000001', 'Admin A cpi'),
  ('cb0a0000-eeee-4000-8000-000000000001', 'Ayudante A cpi'),
  ('cb0a0000-ffff-4000-8000-000000000001', 'Familia A cpi'),
  ('cb0b0000-ffff-4000-8000-000000000001', 'Familia B cpi')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role, left_at) values
  ('cb0a0000-aaaa-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin_club', null),
  ('cb0a0000-eeee-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null),
  ('cb0a0000-ffff-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'jugador', null),
  ('cb0b0000-ffff-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000002', 'jugador', null);

-- Dos hermanos en A, y un tercer jugador en B.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('cb0a0000-1111-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'Hermano', 'Mayor', '2014-03-01'),
  ('cb0a0000-1111-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'Hermana', 'Menor', '2016-05-02'),
  ('cb0b0000-1111-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000002', 'Ajeno', 'DeB', '2015-01-01');

-- Las cinco invitaciones del mismo correo de tutor, una por estado. `created_at`
-- explícito y separado para que el orden de F3 sea el del acto, no el del azar.
insert into public.invitations
  (id, email, role, club_id, player_id, player_relation, created_by, created_at, expires_at, accepted_at) values
  -- pendiente vigente, hermano mayor → la que cubre al correo (ancla)
  ('cb01ffff-0000-4000-8000-000000000001', 'cpi-tutor@test.local', 'jugador',
   'cb000000-0000-4000-8000-000000000001', 'cb0a0000-1111-4000-8000-000000000001', 'parent',
   'cb0a0000-aaaa-4000-8000-000000000001', now() - interval '2 days', now() + interval '5 days', null),
  -- ACEPTADA (G1)
  ('cb01ffff-0000-4000-8000-000000000002', 'cpi-tutor@test.local', 'jugador',
   'cb000000-0000-4000-8000-000000000001', 'cb0a0000-1111-4000-8000-000000000002', 'parent',
   'cb0a0000-aaaa-4000-8000-000000000001', now() - interval '9 days', now() + interval '1 day', now() - interval '8 days'),
  -- CADUCADA (G2)
  ('cb01ffff-0000-4000-8000-000000000003', 'cpi-tutor@test.local', 'jugador',
   'cb000000-0000-4000-8000-000000000001', 'cb0a0000-1111-4000-8000-000000000002', 'parent',
   'cb0a0000-aaaa-4000-8000-000000000001', now() - interval '30 days', now() - interval '1 day', null),
  -- pendiente en OTRO club (G3)
  ('cb01ffff-0000-4000-8000-000000000004', 'cpi-tutor@test.local', 'jugador',
   'cb000000-0000-4000-8000-000000000002', 'cb0b0000-1111-4000-8000-000000000001', 'parent',
   null, now() - interval '1 day', now() + interval '6 days', null);

-- Pendiente de STAFF (sin jugador) con su propio correo (F5).
insert into public.invitations
  (id, email, role, club_id, created_by, created_at, expires_at) values
  ('cb01ffff-0000-4000-8000-000000000005', 'cpi-staff@test.local', 'entrenador_ayudante',
   'cb000000-0000-4000-8000-000000000001', 'cb0a0000-aaaa-4000-8000-000000000001',
   now() - interval '1 day', now() + interval '6 days');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cb0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

-- ── F1 + G1 + G2 + G3: de las cuatro del mismo correo, solo sale la vigente ──
do $$
declare r record; n int;
begin
  select count(*) into n from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', 'cpi-tutor@test.local');
  if n <> 1 then
    raise exception 'FAIL [F1]: esperaba 1 pendiente vigente y salieron % (aceptada, caducada o de otro club coladas)', n;
  end if;

  select * into r from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', 'cpi-tutor@test.local');
  if r.invitation_id <> 'cb01ffff-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [F1]: invitation_id equivocado (%)', r.invitation_id;
  end if;
  if r.player_id <> 'cb0a0000-1111-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [F1]: player_id equivocado (%)', r.player_id;
  end if;
  if r.role <> 'jugador' then
    raise exception 'FAIL [F1]: role equivocado (%)', r.role;
  end if;
end $$;

-- ── F2. mayúsculas y espacios → la misma fila ────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', '  CPI-Tutor@Test.Local  ');
  if r.invitation_id is distinct from 'cb01ffff-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [F2]: el correo debería normalizarse (trim + minúsculas)';
  end if;
end $$;

-- ── F3. dos hermanos pendientes → 2 filas en orden de creación ───────────────
-- La PRIMERA es el ancla: el correo que se mandó lleva a esa invitación. Por eso
-- la función ordena y no deja el orden al azar.
do $$
declare ids uuid[];
begin
  insert into public.invitations
    (id, email, role, club_id, player_id, player_relation, created_by, created_at, expires_at)
  values
    ('cb01ffff-0000-4000-8000-000000000006', 'cpi-tutor@test.local', 'jugador',
     'cb000000-0000-4000-8000-000000000001', 'cb0a0000-1111-4000-8000-000000000002', 'parent',
     'cb0a0000-aaaa-4000-8000-000000000001', now() - interval '1 hour', now() + interval '7 days');

  select array_agg(invitation_id order by created_at) into ids
    from public.club_pending_invitation_by_email(
      'cb000000-0000-4000-8000-000000000001', 'cpi-tutor@test.local');

  if array_length(ids, 1) <> 2 then
    raise exception 'FAIL [F3]: esperaba las 2 pendientes del correo, salieron %', coalesce(array_length(ids, 1), 0);
  end if;
  if ids[1] <> 'cb01ffff-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [F3]: la primera debe ser la más antigua (el ancla), salió %', ids[1];
  end if;
end $$;

-- ── F5. una pendiente de staff también sale, con player_id NULL ──────────────
do $$
declare r record; n int;
begin
  select count(*) into n from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', 'cpi-staff@test.local');
  if n <> 1 then
    raise exception 'FAIL [F5]: la pendiente de staff también cubre ese correo (salieron %)', n;
  end if;
  select * into r from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', 'cpi-staff@test.local');
  if r.player_id is not null then
    raise exception 'FAIL [F5]: una invitación de staff no lleva jugador (player_id=%)', r.player_id;
  end if;
  if r.role <> 'entrenador_ayudante' then
    raise exception 'FAIL [F5]: role equivocado (%)', r.role;
  end if;
end $$;

-- ── G4. correo sin invitaciones, y correo vacío → 0 filas ────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', 'no-invitado-jamas@test.local');
  if n <> 0 then raise exception 'FAIL [G4]: un correo sin invitaciones NO debe salir'; end if;

  select count(*) into n from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', '   ');
  if n <> 0 then raise exception 'FAIL [G4b]: un correo vacío NO debe salir'; end if;
end $$;

-- ── F4. el entrenador AYUDANTE también puede preguntar ───────────────────────
set local "request.jwt.claims" = '{"sub":"cb0a0000-eeee-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from public.club_pending_invitation_by_email(
    'cb000000-0000-4000-8000-000000000001', 'cpi-tutor@test.local');
  if n <> 2 then
    raise exception 'FAIL [F4]: el ayudante crea jugadores, así que debe poder preguntar (salieron %)', n;
  end if;
end $$;

-- ── G5. una familia (rol 'jugador') → forbidden ──────────────────────────────
set local "request.jwt.claims" = '{"sub":"cb0a0000-ffff-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false; n int;
begin
  begin
    select count(*) into n from public.club_pending_invitation_by_email(
      'cb000000-0000-4000-8000-000000000001', 'cpi-tutor@test.local');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G5]: una familia NO debería poder preguntar'; end if;
end $$;

-- ── G6. alguien de fuera del club → forbidden ────────────────────────────────
set local "request.jwt.claims" = '{"sub":"cb0b0000-ffff-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false; n int;
begin
  begin
    select count(*) into n from public.club_pending_invitation_by_email(
      'cb000000-0000-4000-8000-000000000001', 'cpi-tutor@test.local');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G6]: alguien de otro club NO debería poder preguntar'; end if;
end $$;

reset role;

-- ACL: `anon` no debe poder ejecutarla. El gate de auth.uid() ya lo pararía, pero
-- el permiso es el cinturón de fuera y se comprueba por separado.
do $$
begin
  if has_function_privilege('anon', 'public.club_pending_invitation_by_email(uuid, text)', 'execute') then
    raise exception 'FAIL [ACL]: anon NO debe poder ejecutar club_pending_invitation_by_email';
  end if;
  if not has_function_privilege('authenticated', 'public.club_pending_invitation_by_email(uuid, text)', 'execute') then
    raise exception 'FAIL [ACL]: authenticated SÍ debe poder ejecutarla';
  end if;
end $$;

rollback;
