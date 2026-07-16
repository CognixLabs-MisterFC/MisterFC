-- F1B — Suite RLS consolidada del rol "director" + "owner único" de club.
--
-- Reúne en una sola red de pruebas los invariantes que las piezas F1B-0…F1B-3
-- verificaron por separado, más los dos invariantes críticos que se añadieron a
-- posteriori (anti-regresión del owner y aceptación de invitación bajo el
-- contexto real del invitee). Sustituye a los ficheros sueltos
-- rls_director_data_parity.sql / rls_owner_high_roles.sql /
-- rls_high_role_invite_only.sql.
--
-- Secciones:
--   1. AISLAMIENTO   — un director/owner del club A no ve ni escribe datos de B.
--   2. EQUIVALENCIA  — director del club A gestiona los mismos datos que admin_club.
--   3. JERARQUÍA     — solo el owner invita/gestiona director/admin; director mueve
--                      roles bajos pero no altos; altos SOLO por invitación (para
--                      NADIE, ni el owner); owner inmutable; último admin protegido.
--   4. ANTI-REGRESIÓN DEL OWNER (lección VERTEX) — aceptar una invitación de
--      director N deja INTACTOS clubs.owner_profile_id, la membership del owner y
--      su fila auth; ninguna vía de alta de director toca a otros usuarios.
--   5. ACEPTACIÓN DE INVITACIÓN bajo el CONTEXTO REAL DEL INVITEE (rol
--      authenticated, no admin) — crea la membership para TODOS los roles. Red
--      contra la regresión que se coló en F1B-2 (fix #280): sustituir
--      current_user_email() por acceso inline a auth.users rompía este INSERT.
--
-- Estilo house (rls_events.sql): begin … set local jwt.claims … do $$ raise on
-- fail $$ … rollback. Corre por psql contra el remoto (pgTAP no va en CI).
-- Al insertar en auth.users, el trigger on_auth_user_created crea el profile.
\ir helpers/auth_users.sql

begin;

-- ═════════════════════════════════════════════════════════════════════════════
-- FIXTURE 1 — Clubs A y B (aislamiento, equivalencia, owner-safety, aceptación).
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.new_test_user('f1b40000-0001-0000-0000-000000000001', 'ownerA@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-0002-0000-0000-000000000001', 'dirA@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-0004-0000-0000-000000000001', 'jugA@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-0005-0000-0000-000000000001', 'ownerB@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-0003-0000-0000-000000000001', 'dirB@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-1001-0000-0000-000000000001', 'inv-dir@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-1002-0000-0000-000000000001', 'inv-coord@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-1003-0000-0000-000000000001', 'inv-princ@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-1004-0000-0000-000000000001', 'inv-ayud@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-1005-0000-0000-000000000001', 'inv-jug@f1b4.test', '{}'::jsonb);

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('f1b40000-aaaa-0000-0000-000000000001', 'Club A F1B4', 'club-a-f1b4', 'f1b40000-0001-0000-0000-000000000001'),
  ('f1b40000-bbbb-0000-0000-000000000001', 'Club B F1B4', 'club-b-f1b4', 'f1b40000-0005-0000-0000-000000000001');

insert into public.club_settings (club_id) values
  ('f1b40000-aaaa-0000-0000-000000000001'),
  ('f1b40000-bbbb-0000-0000-000000000001')
on conflict (club_id) do nothing;

insert into public.categories (id, club_id, name) values
  ('f1b40000-c0a1-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'Cat A'),
  ('f1b40000-c0b1-0000-0000-000000000001', 'f1b40000-bbbb-0000-0000-000000000001', 'Cat B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('f1b40000-7ea1-0000-0000-000000000001', 'f1b40000-c0a1-0000-0000-000000000001', 'Team A', 'F7', '#10B981', '2025-26'),
  ('f1b40000-7eb1-0000-0000-000000000001', 'f1b40000-c0b1-0000-0000-000000000001', 'Team B', 'F7', '#EF4444', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f1b40000-9111-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'Player', 'A', '2012-01-01'),
  ('f1b40000-9222-0000-0000-000000000001', 'f1b40000-bbbb-0000-0000-000000000001', 'Player', 'B', '2012-01-01');

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1b40000-5001-0000-0000-000000000001', 'f1b40000-0001-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'admin_club'),  -- ownerA
  ('f1b40000-5002-0000-0000-000000000001', 'f1b40000-0002-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'director'),    -- dirA
  ('f1b40000-5004-0000-0000-000000000001', 'f1b40000-0004-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'jugador'),     -- jugA
  ('f1b40000-5005-0000-0000-000000000001', 'f1b40000-0005-0000-0000-000000000001', 'f1b40000-bbbb-0000-0000-000000000001', 'admin_club'),  -- ownerB
  ('f1b40000-5003-0000-0000-000000000001', 'f1b40000-0003-0000-0000-000000000001', 'f1b40000-bbbb-0000-0000-000000000001', 'director');    -- dirB

-- Invitaciones PENDIENTES en el club A (una por rol) — para la sección 5.
insert into public.invitations (email, role, club_id, created_by, expires_at) values
  ('inv-dir@f1b4.test',   'director',             'f1b40000-aaaa-0000-0000-000000000001', 'f1b40000-0001-0000-0000-000000000001', now()+interval '7 days'),
  ('inv-coord@f1b4.test', 'coordinador',          'f1b40000-aaaa-0000-0000-000000000001', 'f1b40000-0001-0000-0000-000000000001', now()+interval '7 days'),
  ('inv-princ@f1b4.test', 'entrenador_principal', 'f1b40000-aaaa-0000-0000-000000000001', 'f1b40000-0001-0000-0000-000000000001', now()+interval '7 days'),
  ('inv-ayud@f1b4.test',  'entrenador_ayudante',  'f1b40000-aaaa-0000-0000-000000000001', 'f1b40000-0001-0000-0000-000000000001', now()+interval '7 days'),
  ('inv-jug@f1b4.test',   'jugador',              'f1b40000-aaaa-0000-0000-000000000001', 'f1b40000-0001-0000-0000-000000000001', now()+interval '7 days');

-- ═════════════════════════════════════════════════════════════════════════════
-- FIXTURE 2 — Club H (jerarquía: owner + admin no-owner + director + coord + peón).
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.new_test_user('f1b40000-2001-0000-0000-000000000001', 'h-owner@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-2002-0000-0000-000000000001', 'h-admin2@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-2003-0000-0000-000000000001', 'h-dir@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-2004-0000-0000-000000000001', 'h-coord@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-2005-0000-0000-000000000001', 'h-pawn@f1b4.test', '{}'::jsonb);

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('f1b40000-cccc-0000-0000-000000000001', 'Club H F1B4', 'club-h-f1b4', 'f1b40000-2001-0000-0000-000000000001');

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1b40000-6001-0000-0000-000000000001', 'f1b40000-2001-0000-0000-000000000001', 'f1b40000-cccc-0000-0000-000000000001', 'admin_club'),   -- h-owner
  ('f1b40000-6002-0000-0000-000000000001', 'f1b40000-2002-0000-0000-000000000001', 'f1b40000-cccc-0000-0000-000000000001', 'admin_club'),   -- h-admin2 (no-owner)
  ('f1b40000-6003-0000-0000-000000000001', 'f1b40000-2003-0000-0000-000000000001', 'f1b40000-cccc-0000-0000-000000000001', 'director'),     -- h-dir
  ('f1b40000-6004-0000-0000-000000000001', 'f1b40000-2004-0000-0000-000000000001', 'f1b40000-cccc-0000-0000-000000000001', 'coordinador'),  -- h-coord
  ('f1b40000-6005-0000-0000-000000000001', 'f1b40000-2005-0000-0000-000000000001', 'f1b40000-cccc-0000-0000-000000000001', 'jugador');      -- h-pawn

-- ═════════════════════════════════════════════════════════════════════════════
-- FIXTURE 3 — Club L (guarda del ÚLTIMO admin en aislamiento). owner = un director
-- para poder pasar forbidden_requires_owner y alcanzar would_remove_last_admin con
-- un único admin_club. En el modelo estándar (owner = admin) esta protección queda
-- SUBSUMIDA por la inmutabilidad del owner (el owner es admin permanente); este
-- club artificial ejercita el guard #8 de admin_update_staff_role en solitario.
-- ═════════════════════════════════════════════════════════════════════════════
select pg_temp.new_test_user('f1b40000-3001-0000-0000-000000000001', 'l-ownerdir@f1b4.test', '{}'::jsonb);
select pg_temp.new_test_user('f1b40000-3002-0000-0000-000000000001', 'l-admin@f1b4.test', '{}'::jsonb);

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('f1b40000-dddd-0000-0000-000000000001', 'Club L F1B4', 'club-l-f1b4', 'f1b40000-3001-0000-0000-000000000001');

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1b40000-7001-0000-0000-000000000001', 'f1b40000-3001-0000-0000-000000000001', 'f1b40000-dddd-0000-0000-000000000001', 'director'),    -- l-ownerdir (owner, no admin)
  ('f1b40000-7002-0000-0000-000000000001', 'f1b40000-3002-0000-0000-000000000001', 'f1b40000-dddd-0000-0000-000000000001', 'admin_club'); -- l-admin (único admin)

set local role authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. AISLAMIENTO — director del club A NO ve ni escribe datos del club B.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b40000-0002-0000-0000-000000000001","role":"authenticated"}';

-- 1.1 helper: director A NO es admin_or_director de B (pero sí de A).
do $$
begin
  if public.user_is_admin_or_director('f1b40000-bbbb-0000-0000-000000000001') then
    raise exception 'FAIL [1.1]: director de A pasa como admin_or_director de B';
  end if;
  if not public.user_is_admin_or_director('f1b40000-aaaa-0000-0000-000000000001') then
    raise exception 'FAIL [1.1]: director de A NO pasa como admin_or_director de A';
  end if;
end $$;

-- 1.2 SELECT cross-club = 0 (categorías, jugadores, club_settings de B).
do $$
declare c int;
begin
  select count(*) into c from public.categories where club_id = 'f1b40000-bbbb-0000-0000-000000000001';
  if c <> 0 then raise exception 'FAIL [1.2]: director A ve categorías de B (%).', c; end if;
  select count(*) into c from public.players where club_id = 'f1b40000-bbbb-0000-0000-000000000001';
  if c <> 0 then raise exception 'FAIL [1.2]: director A ve jugadores de B (%).', c; end if;
  select count(*) into c from public.club_settings where club_id = 'f1b40000-bbbb-0000-0000-000000000001';
  if c <> 0 then raise exception 'FAIL [1.2]: director A ve club_settings de B (%).', c; end if;
end $$;

-- 1.3 INSERT cross-club rechazado (categoría en B).
do $$
begin
  insert into public.categories (club_id, name) values ('f1b40000-bbbb-0000-0000-000000000001', 'Cat B intrusa');
  raise exception 'FAIL [1.3]: director A pudo INSERT categoría en B';
exception when insufficient_privilege or check_violation then null; end $$;

-- 1.4 UPDATE cross-club sin efecto (players de B: 0 filas).
do $$
declare n int;
begin
  update public.players set first_name = 'HACK' where club_id = 'f1b40000-bbbb-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [1.4]: director A actualizó % jugador(es) de B', n; end if;
end $$;

-- 1.5 UPDATE cross-club sin efecto (metadata del club B: 0 filas).
do $$
declare n int;
begin
  update public.clubs set name = 'HACK B' where id = 'f1b40000-bbbb-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [1.5]: director A actualizó el club B (% filas)', n; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. EQUIVALENCIA — director del club A gestiona igual que admin del club A.
-- ═════════════════════════════════════════════════════════════════════════════

-- 2.1 INSERT categoría en A.
do $$
begin
  insert into public.categories (id, club_id, name)
  values ('f1b40000-c0a2-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'Cat A2 por director');
exception when others then
  raise exception 'FAIL [2.1]: director A no pudo INSERT categoría en A: % (%).', sqlerrm, sqlstate;
end $$;

-- 2.2 INSERT equipo en A.
do $$
begin
  insert into public.teams (id, category_id, name, format, color, season)
  values ('f1b40000-7ea2-0000-0000-000000000001', 'f1b40000-c0a2-0000-0000-000000000001', 'Team A2', 'F7', '#000000', '2025-26');
exception when others then
  raise exception 'FAIL [2.2]: director A no pudo INSERT equipo en A: % (%).', sqlerrm, sqlstate;
end $$;

-- 2.3 UPDATE jugador en A.
do $$
declare n int;
begin
  update public.players set first_name = 'PlayerEditado' where id = 'f1b40000-9111-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [2.3]: director A no actualizó al jugador de A (% filas)', n; end if;
end $$;

-- 2.4 INSERT season en A (era admin-only).
do $$
begin
  insert into public.seasons (club_id, label) values ('f1b40000-aaaa-0000-0000-000000000001', '2026-27');
exception when others then
  raise exception 'FAIL [2.4]: director A no pudo INSERT season en A: % (%).', sqlerrm, sqlstate;
end $$;

-- 2.5 SELECT + UPDATE club_settings en A (era admin-only).
do $$
declare n int; c int;
begin
  select count(*) into c from public.club_settings where club_id = 'f1b40000-aaaa-0000-0000-000000000001';
  if c <> 1 then raise exception 'FAIL [2.5]: director A no ve club_settings de A (%).', c; end if;
  update public.club_settings set evaluations_player_visibility = true where club_id = 'f1b40000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [2.5]: director A no actualizó club_settings de A (% filas)', n; end if;
end $$;

-- 2.6 crear SESIÓN en A (owner = director; user_can_create_sessions).
do $$
begin
  insert into public.sessions (club_id, team_id, owner_profile_id, title, session_date)
  values ('f1b40000-aaaa-0000-0000-000000000001', 'f1b40000-7ea1-0000-0000-000000000001',
          'f1b40000-0002-0000-0000-000000000001', 'Sesión por director', '2026-05-01');
exception when others then
  raise exception 'FAIL [2.6]: director A no pudo crear sesión en A: % (%).', sqlerrm, sqlstate;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. JERARQUÍA — gestión de roles altos = owner; altos SOLO por invitación.
--    (fixture 2, club H). Savepoints por caller para no arrastrar mutaciones.
-- ═════════════════════════════════════════════════════════════════════════════

-- 3.A — DIRECTOR caller: mueve roles bajos; nunca sube a alto; no degrada altos.
savepoint s_hier_dir;
set local "request.jwt.claims" = '{"sub":"f1b40000-2003-0000-0000-000000000001","role":"authenticated"}';

-- 3.A.1 director invita rol BAJO (coordinador) → OK.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b40000-cccc-0000-0000-000000000001', 'new-coord@f1b4.test', 'coordinador', 'f1b40000-2003-0000-0000-000000000001');
exception when others then raise exception 'FAIL [3.A.1]: director no pudo invitar coordinador: % (%).', sqlerrm, sqlstate; end $$;

-- 3.A.2 director invita DIRECTOR → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b40000-cccc-0000-0000-000000000001', 'x-dir@f1b4.test', 'director', 'f1b40000-2003-0000-0000-000000000001');
  raise exception 'FAIL [3.A.2]: director pudo invitar a un director';
exception when insufficient_privilege or check_violation then null; end $$;

-- 3.A.3 director invita ADMIN_CLUB → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b40000-cccc-0000-0000-000000000001', 'x-adm@f1b4.test', 'admin_club', 'f1b40000-2003-0000-0000-000000000001');
  raise exception 'FAIL [3.A.3]: director pudo invitar a un admin';
exception when insufficient_privilege or check_violation then null; end $$;

-- 3.A.4 director cambia rol BAJO (peón jugador→coordinador) vía RPC → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2005-0000-0000-000000000001', 'coordinador');
  select role into r from public.memberships where profile_id='f1b40000-2005-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  if r <> 'coordinador' then raise exception 'FAIL [3.A.4]: rol bajo no cambió (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [3.A.4]: director no pudo mover rol bajo: % (%).', sqlerrm, sqlstate;
end $$;

-- 3.A.5 director sube peón a DIRECTOR → high_role_invite_only.
do $$
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2005-0000-0000-000000000001', 'director');
  raise exception 'FAIL [3.A.5]: director pudo subir a director por cambio de rol';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [3.A.5]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- 3.A.6 director degrada al admin no-owner → forbidden_requires_owner.
do $$
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2002-0000-0000-000000000001', 'coordinador');
  raise exception 'FAIL [3.A.6]: director pudo degradar a un admin';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then raise exception 'FAIL [3.A.6]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- 3.A.7 director ELIMINA membership de admin (alto) vía RLS → 0 filas.
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b40000-2002-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [3.A.7]: director eliminó una membership de admin (% filas)', n; end if;
end $$;

-- 3.A.8 director ELIMINA membership BAJA (coord) vía RLS → 1 fila.
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b40000-2004-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [3.A.8]: director no eliminó una membership baja (% filas)', n; end if;
end $$;

rollback to savepoint s_hier_dir;

-- 3.N — ADMIN no-owner caller: mueve bajos; no sube a alto; no toca altos.
savepoint s_hier_adm;
set local "request.jwt.claims" = '{"sub":"f1b40000-2002-0000-0000-000000000001","role":"authenticated"}';

-- 3.N.1 admin no-owner invita DIRECTOR → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b40000-cccc-0000-0000-000000000001', 'n1@f1b4.test', 'director', 'f1b40000-2002-0000-0000-000000000001');
  raise exception 'FAIL [3.N.1]: admin no-owner pudo invitar a un director';
exception when insufficient_privilege or check_violation then null; end $$;

-- 3.N.2 admin no-owner mueve coord→entrenador_principal (bajo↔bajo) → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2004-0000-0000-000000000001', 'entrenador_principal');
  select role into r from public.memberships where profile_id='f1b40000-2004-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  if r <> 'entrenador_principal' then raise exception 'FAIL [3.N.2]: bajo↔bajo no cambió (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [3.N.2]: admin no pudo mover rol bajo: % (%).', sqlerrm, sqlstate;
end $$;

-- 3.N.3 admin no-owner sube peón a DIRECTOR → high_role_invite_only.
do $$
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2005-0000-0000-000000000001', 'director');
  raise exception 'FAIL [3.N.3]: admin no-owner pudo subir a director';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [3.N.3]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- 3.N.4 admin no-owner degrada al director → forbidden_requires_owner.
do $$
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2003-0000-0000-000000000001', 'jugador');
  raise exception 'FAIL [3.N.4]: admin no-owner degradó a un director';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then raise exception 'FAIL [3.N.4]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

rollback to savepoint s_hier_adm;

-- 3.O — OWNER caller: invita altos; NUNCA sube a alto por cambio de rol; degrada altos.
savepoint s_hier_own;
set local "request.jwt.claims" = '{"sub":"f1b40000-2001-0000-0000-000000000001","role":"authenticated"}';

-- 3.O.1 owner invita DIRECTOR → OK.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b40000-cccc-0000-0000-000000000001', 'o1-dir@f1b4.test', 'director', 'f1b40000-2001-0000-0000-000000000001');
exception when others then raise exception 'FAIL [3.O.1]: owner no pudo invitar director: % (%).', sqlerrm, sqlstate; end $$;

-- 3.O.2 owner invita ADMIN_CLUB → OK.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b40000-cccc-0000-0000-000000000001', 'o2-adm@f1b4.test', 'admin_club', 'f1b40000-2001-0000-0000-000000000001');
exception when others then raise exception 'FAIL [3.O.2]: owner no pudo invitar admin: % (%).', sqlerrm, sqlstate; end $$;

-- 3.O.3 owner sube peón a DIRECTOR por cambio de rol → high_role_invite_only (¡ni el owner!).
do $$
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2005-0000-0000-000000000001', 'director');
  raise exception 'FAIL [3.O.3]: el owner pudo subir a director por cambio de rol';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [3.O.3]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- 3.O.4 owner DEGRADA al director → entrenador_principal → OK (potestad del owner).
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2003-0000-0000-000000000001', 'entrenador_principal');
  select role into r from public.memberships where profile_id='f1b40000-2003-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  if r <> 'entrenador_principal' then raise exception 'FAIL [3.O.4]: owner no degradó al director (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [3.O.4]: owner no pudo degradar a un director: % (%).', sqlerrm, sqlstate;
end $$;

-- 3.O.5 owner ELIMINA la membership del director → OK (1 fila).
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b40000-2003-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [3.O.5]: owner no eliminó al director (% filas)', n; end if;
end $$;

-- 3.O.6 owner se degrada a sí mismo → owner_immutable.
do $$
begin
  perform public.admin_update_staff_role('f1b40000-cccc-0000-0000-000000000001', 'f1b40000-2001-0000-0000-000000000001', 'coordinador');
  raise exception 'FAIL [3.O.6]: el owner pudo degradarse a sí mismo';
exception when others then
  if sqlerrm not like '%owner_immutable%' then raise exception 'FAIL [3.O.6]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

rollback to savepoint s_hier_own;

-- 3.P — OWNER inmutable por RLS directa (no editable ni eliminable por un admin).
savepoint s_hier_p;
-- 3.P.1 admin no-owner NO elimina la membership del owner → 0 filas.
set local "request.jwt.claims" = '{"sub":"f1b40000-2002-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b40000-2001-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [3.P.1]: se eliminó la membership del owner (% filas)', n; end if;
end $$;
-- 3.P.2 ni el propio owner edita su membership vía RLS → 0 filas.
set local "request.jwt.claims" = '{"sub":"f1b40000-2001-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  update public.memberships set role='coordinador' where profile_id='f1b40000-2001-0000-0000-000000000001' and club_id='f1b40000-cccc-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [3.P.2]: el owner editó su propia membership (% filas)', n; end if;
end $$;
rollback to savepoint s_hier_p;

-- 3.L — ÚLTIMO ADMIN protegido (guard #8, club L con owner=director).
savepoint s_hier_l;
set local "request.jwt.claims" = '{"sub":"f1b40000-3001-0000-0000-000000000001","role":"authenticated"}';
-- 3.L.1 el owner(director) degrada al ÚNICO admin_club → would_remove_last_admin.
do $$
begin
  perform public.admin_update_staff_role('f1b40000-dddd-0000-0000-000000000001', 'f1b40000-3002-0000-0000-000000000001', 'coordinador');
  raise exception 'FAIL [3.L.1]: se pudo degradar al último admin del club';
exception when others then
  if sqlerrm not like '%would_remove_last_admin%' then raise exception 'FAIL [3.L.1]: inesperado (esperaba would_remove_last_admin): % (%).', sqlerrm, sqlstate; end if;
end $$;
rollback to savepoint s_hier_l;

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. ACEPTACIÓN DE INVITACIÓN bajo el CONTEXTO REAL DEL INVITEE (rol authenticated).
--    Red anti-regresión del fix #280: cada invitee inserta su PROPIA membership.
--    Un acceso ilegal a auth.users en la policy fallaría aquí (permission denied).
--    Se ejecuta ANTES de la sección 4 (que comprueba el owner tras el alta N).
-- ═════════════════════════════════════════════════════════════════════════════

-- 5.1 DIRECTOR — invitee inserta su membership 'director' en A → OK.
set local "request.jwt.claims" = '{"sub":"f1b40000-1001-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('f1b40000-1001-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'director');
exception when others then
  raise exception 'FAIL [5.1]: aceptación DIRECTOR falló: % (%).', sqlerrm, sqlstate;
end $$;

-- 5.2 COORDINADOR.
set local "request.jwt.claims" = '{"sub":"f1b40000-1002-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('f1b40000-1002-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'coordinador');
exception when others then
  raise exception 'FAIL [5.2]: aceptación COORDINADOR falló: % (%).', sqlerrm, sqlstate;
end $$;

-- 5.3 ENTRENADOR_PRINCIPAL.
set local "request.jwt.claims" = '{"sub":"f1b40000-1003-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('f1b40000-1003-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'entrenador_principal');
exception when others then
  raise exception 'FAIL [5.3]: aceptación ENTRENADOR_PRINCIPAL falló: % (%).', sqlerrm, sqlstate;
end $$;

-- 5.4 ENTRENADOR_AYUDANTE.
set local "request.jwt.claims" = '{"sub":"f1b40000-1004-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('f1b40000-1004-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'entrenador_ayudante');
exception when others then
  raise exception 'FAIL [5.4]: aceptación ENTRENADOR_AYUDANTE falló: % (%).', sqlerrm, sqlstate;
end $$;

-- 5.5 JUGADOR.
set local "request.jwt.claims" = '{"sub":"f1b40000-1005-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('f1b40000-1005-0000-0000-000000000001', 'f1b40000-aaaa-0000-0000-000000000001', 'jugador');
exception when others then
  raise exception 'FAIL [5.5]: aceptación JUGADOR falló: % (%).', sqlerrm, sqlstate;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. ANTI-REGRESIÓN DEL OWNER — tras el alta del director N (5.1) y el resto de
--    altas, el owner del club A queda INTACTO y no se tocó a ningún otro usuario.
--    Se lee como superusuario (verdad de suelo, sin RLS).
-- ═════════════════════════════════════════════════════════════════════════════
reset role;
do $$
declare v_owner uuid; v_role text; v_cnt int;
begin
  -- 4.1 clubs.owner_profile_id de A sigue siendo ownerA.
  select owner_profile_id into v_owner from public.clubs where id='f1b40000-aaaa-0000-0000-000000000001';
  if v_owner is distinct from 'f1b40000-0001-0000-0000-000000000001' then
    raise exception 'FAIL [4.1]: owner_profile_id de A cambió (%).', v_owner;
  end if;
  -- 4.2 la membership del owner sigue intacta (misma fila, role admin_club).
  select role into v_role from public.memberships where id='f1b40000-5001-0000-0000-000000000001';
  if v_role is distinct from 'admin_club' then
    raise exception 'FAIL [4.2]: la membership del owner cambió de rol (%).', v_role;
  end if;
  -- 4.3 el owner sigue con EXACTAMENTE una membership (no se le duplicó/movió).
  select count(*) into v_cnt from public.memberships where profile_id='f1b40000-0001-0000-0000-000000000001';
  if v_cnt <> 1 then raise exception 'FAIL [4.3]: el owner tiene % memberships (esperaba 1).', v_cnt; end if;
  -- 4.4 la fila auth del owner sigue intacta (email sin cambios).
  perform 1 from auth.users where id='f1b40000-0001-0000-0000-000000000001' and email='ownerA@f1b4.test';
  if not found then raise exception 'FAIL [4.4]: la fila auth del owner cambió'; end if;
  -- 4.5 el otro miembro previo (dirA) sigue intacto — el alta N no tocó a terceros.
  select role into v_role from public.memberships where id='f1b40000-5002-0000-0000-000000000001';
  if v_role is distinct from 'director' then
    raise exception 'FAIL [4.5]: la membership de dirA (tercero) cambió (%).', v_role;
  end if;
  -- 4.6 la membership del director N (5.1) SÍ se creó.
  select count(*) into v_cnt from public.memberships
   where profile_id='f1b40000-1001-0000-0000-000000000001' and club_id='f1b40000-aaaa-0000-0000-000000000001' and role='director';
  if v_cnt <> 1 then raise exception 'FAIL [4.6]: la membership del director N no se creó (%).', v_cnt; end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────────────────────'
\echo '✅ F1B suite consolidada: aislamiento + equivalencia + jerarquía'
\echo '   + anti-regresión del owner + aceptación por invitee OK.'
\echo '──────────────────────────────────────────────────────────────'
