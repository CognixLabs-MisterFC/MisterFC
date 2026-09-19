-- BUG 3 · B-2 — verifica club_member_by_email.
-- Migración 20261086000000_club_member_by_email.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club A con admin, entrenador ayudante, una familia (rol 'jugador') y
-- un miembro que YA SE FUE. Club B con su propia familia, para el caso de
-- "existe, pero no aquí".
--
-- Casos:
--   F1. admin de A pregunta por el correo de la familia de A → 1 fila, con su
--       membership, su perfil, su nombre y su rol.
--   F2. el mismo correo con MAYÚSCULAS y espacios → la misma fila.
--   F3. entrenador AYUDANTE de A → también puede preguntar (crea jugadores).
--   G1. correo de alguien de OTRO club → 0 filas (no "existe en otro sitio").
--   G2. correo que no existe → 0 filas. Indistinguible de G1, a propósito.
--   G3. miembro que se fue del club (left_at) → 0 filas: hay que reinvitarle.
--   G4. una familia (rol 'jugador') pregunta → forbidden.
--   G5. alguien que no es del club pregunta → forbidden.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('ce000000-0000-4000-8000-000000000001', 'Club A cme', 'club-a-cme'),
  ('ce000000-0000-4000-8000-000000000002', 'Club B cme', 'club-b-cme');

select pg_temp.new_test_user('ce0a0000-aaaa-4000-8000-000000000001', 'cme-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ce0a0000-eeee-4000-8000-000000000001', 'cme-ayudante@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ce0a0000-ffff-4000-8000-000000000001', 'cme-familia@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ce0a0000-9999-4000-8000-000000000001', 'cme-sefue@test.local', '{}'::jsonb);
select pg_temp.new_test_user('ce0b0000-ffff-4000-8000-000000000001', 'cme-otroclub@test.local', '{}'::jsonb);

insert into public.profiles (id, full_name) values
  ('ce0a0000-aaaa-4000-8000-000000000001', 'Admin A'),
  ('ce0a0000-eeee-4000-8000-000000000001', 'Ayudante A'),
  ('ce0a0000-ffff-4000-8000-000000000001', 'Familia A'),
  ('ce0a0000-9999-4000-8000-000000000001', 'Se Fue'),
  ('ce0b0000-ffff-4000-8000-000000000001', 'Familia B')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role, left_at) values
  ('ce0a0000-aaaa-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'admin_club', null),
  ('ce0a0000-eeee-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null),
  ('ce0a0000-ffff-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'jugador', null),
  ('ce0a0000-9999-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000001', 'entrenador_ayudante', '2026-01-31'),
  ('ce0b0000-ffff-4000-8000-000000000001', 'ce000000-0000-4000-8000-000000000002', 'jugador', null);

-- ── F1. admin de A pregunta por la familia de A ──────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ce0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
declare r record; n int;
begin
  select count(*) into n from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', 'cme-familia@test.local');
  if n <> 1 then
    raise exception 'FAIL [F1]: esperaba 1 fila para un miembro del club, salieron %', n;
  end if;

  select * into r from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', 'cme-familia@test.local');
  if r.profile_id <> 'ce0a0000-ffff-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [F1]: profile_id equivocado (%)', r.profile_id;
  end if;
  if r.full_name <> 'Familia A' then
    raise exception 'FAIL [F1]: full_name equivocado (%)', r.full_name;
  end if;
  if r.role <> 'jugador' then
    raise exception 'FAIL [F1]: role equivocado (%)', r.role;
  end if;
  if not exists (select 1 from public.memberships m
                  where m.id = r.membership_id
                    and m.profile_id = 'ce0a0000-ffff-4000-8000-000000000001'::uuid) then
    raise exception 'FAIL [F1]: membership_id no es el de esa persona';
  end if;
end $$;

-- ── F2. mayúsculas y espacios → la misma fila ────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', '  CME-Familia@Test.Local  ');
  if r.profile_id is distinct from 'ce0a0000-ffff-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [F2]: el correo debería normalizarse (trim + minúsculas)';
  end if;
end $$;

-- ── G1. correo de OTRO club → 0 filas ────────────────────────────────────────
-- ── G2. correo inexistente → 0 filas, indistinguible de G1 ───────────────────
-- ── G3. miembro que se fue → 0 filas ─────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', 'cme-otroclub@test.local');
  if n <> 0 then raise exception 'FAIL [G1]: un miembro de otro club NO debe salir'; end if;

  select count(*) into n from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', 'no-existe-en-ninguna-parte@test.local');
  if n <> 0 then raise exception 'FAIL [G2]: un correo inexistente NO debe salir'; end if;

  select count(*) into n from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', 'cme-sefue@test.local');
  if n <> 0 then raise exception 'FAIL [G3]: quien se fue del club NO debe salir'; end if;

  select count(*) into n from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', '   ');
  if n <> 0 then raise exception 'FAIL [G2b]: un correo vacío NO debe salir'; end if;
end $$;

-- ── F3. el entrenador AYUDANTE también puede preguntar ───────────────────────
set local "request.jwt.claims" = '{"sub":"ce0a0000-eeee-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  select count(*) into n from public.club_member_by_email(
    'ce000000-0000-4000-8000-000000000001', 'cme-familia@test.local');
  if n <> 1 then
    raise exception 'FAIL [F3]: el ayudante crea jugadores, así que debe poder preguntar (salieron %)', n;
  end if;
end $$;

-- ── G4. una familia (rol 'jugador') → forbidden ──────────────────────────────
set local "request.jwt.claims" = '{"sub":"ce0a0000-ffff-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false; n int;
begin
  begin
    select count(*) into n from public.club_member_by_email(
      'ce000000-0000-4000-8000-000000000001', 'cme-admin@test.local');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G4]: una familia NO debería poder preguntar'; end if;
end $$;

-- ── G5. alguien de fuera del club → forbidden ────────────────────────────────
set local "request.jwt.claims" = '{"sub":"ce0b0000-ffff-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false; n int;
begin
  begin
    select count(*) into n from public.club_member_by_email(
      'ce000000-0000-4000-8000-000000000001', 'cme-familia@test.local');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G5]: alguien de otro club NO debería poder preguntar'; end if;
end $$;

reset role;

-- ACL: `anon` no debe poder ejecutarla. El gate de auth.uid() ya lo pararía, pero
-- el permiso es el cinturón de fuera y se comprueba por separado.
do $$
begin
  if has_function_privilege('anon', 'public.club_member_by_email(uuid, text)', 'execute') then
    raise exception 'FAIL [ACL]: anon NO debe poder ejecutar club_member_by_email';
  end if;
  if not has_function_privilege('authenticated', 'public.club_member_by_email(uuid, text)', 'execute') then
    raise exception 'FAIL [ACL]: authenticated SÍ debe poder ejecutarla';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ BUG3-B2: club_member_by_email (contesta solo por miembros VIVOS del club de quien pregunta; normaliza el correo; otro club, inexistente y baja son indistinguibles; gateada al mismo conjunto que crea jugadores; anon sin execute).'
\echo '──────────────────────────────────────────────'
