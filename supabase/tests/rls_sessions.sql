-- Tests F12.1 — RLS, autoridad y triggers del planificador de SESIONES
-- (migración 20260716000000_sessions.sql).
--
-- Cubre: INSERT (autoridad: ayudante con/sin capability, principal vía team_staff,
-- coord, jugador, ajeno al club; owner forzado a auth.uid); CHECKs de coherencia
-- plantilla↔fecha/evento/visibilidad; SELECT por rol y por visibility staff|team
-- (jugador/familia del team vs jugador de otro team vs club ajeno); UPDATE/DELETE
-- (owner∪admin, owner inmutable); herencia de visibilidad/edición en las hijas
-- (session_blocks, session_block_exercises) + derivación de club_id/session_id.
--
-- Estilo: aserciones con raise exception (como rls_exercises.sql). Transaccional.
--
-- Mapa de IDs (último segmento del uuid, todo HEX):
--   users: admin a, coord b, principal c, ayudante(cap) d, ayudante(sin cap) e,
--          jugador del team A = f, jugador del team A2 = 9, adminB = ...0a (club B).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('5e550000-0000-4000-8000-000000000001', 'Club Ses A', 'club-ses-a'),
  ('5e550000-0000-4000-8000-000000000002', 'Club Ses B', 'club-ses-b');

insert into public.categories (id, club_id, name) values
  ('5e551000-0000-4000-8000-000000000001', '5e550000-0000-4000-8000-000000000001', 'Cat A'),
  ('5e551000-0000-4000-8000-000000000002', '5e550000-0000-4000-8000-000000000001', 'Cat A2');

insert into public.teams (id, category_id, name, format, color, season) values
  ('5e552000-0000-4000-8000-000000000001', '5e551000-0000-4000-8000-000000000001', 'Team A',  'F11', '#10B981', '2025-26'),
  ('5e552000-0000-4000-8000-000000000002', '5e551000-0000-4000-8000-000000000002', 'Team A2', 'F11', '#0EA5E9', '2025-26');

-- jugadorF en Team A (vinculado a f); jugador9 en Team A2 (vinculado a 9).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5e553000-0000-4000-8000-00000000000f', '5e550000-0000-4000-8000-000000000001', 'Fede', 'Team', '2012-01-01'),
  ('5e553000-0000-4000-8000-000000000009', '5e550000-0000-4000-8000-000000000001', 'Gael', 'Otro', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('5e552000-0000-4000-8000-000000000001', '5e553000-0000-4000-8000-00000000000f', '2025-09-01'),
  ('5e552000-0000-4000-8000-000000000002', '5e553000-0000-4000-8000-000000000009', '2025-09-01');

select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000a', 'admin@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000b', 'coord@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000c', 'principal@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000d', 'ayud-cap@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000e', 'ayud-nocap@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000f', 'jugF@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5ea00000-0000-4000-8000-000000000009', 'jug9@ses.test', '{}'::jsonb);
select pg_temp.new_test_user('5eb00000-0000-4000-8000-00000000000a', 'adminB@ses.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('5e555000-0000-4000-8000-00000000000a', '5ea00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', 'admin_club'),
  ('5e555000-0000-4000-8000-00000000000b', '5ea00000-0000-4000-8000-00000000000b', '5e550000-0000-4000-8000-000000000001', 'coordinador'),
  ('5e555000-0000-4000-8000-00000000000c', '5ea00000-0000-4000-8000-00000000000c', '5e550000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('5e555000-0000-4000-8000-00000000000d', '5ea00000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5e555000-0000-4000-8000-00000000000e', '5ea00000-0000-4000-8000-00000000000e', '5e550000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5e555000-0000-4000-8000-00000000000f', '5ea00000-0000-4000-8000-00000000000f', '5e550000-0000-4000-8000-000000000001', 'jugador'),
  ('5e555000-0000-4000-8000-000000000009', '5ea00000-0000-4000-8000-000000000009', '5e550000-0000-4000-8000-000000000001', 'jugador'),
  ('5eb00000-0000-4000-8000-0000000000ba', '5eb00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000002', 'admin_club');

-- Principal en team_staff de Team A (autoridad de creación vía rol de team).
-- coord es COORDINADOR (team_staff) del Team A: tras C-1b (mig 20261010) el coordinador
-- solo crea sesión de un equipo que coordina (sessions_insert: rol=coordinador exige
-- is_template OR user_coordinates_team(team_id)). Habilita I4. NOTA: coordinar Team A lo
-- convierte en user_is_staff_of_team(Team A) → gana autoridad UPDATE/DELETE/bloques sobre
-- las sesiones de Team A; por eso las sesiones "ajenas" de U3/B5/D3 pasan a ser de Team A2
-- (que NO coordina), no de Team A (ver más abajo).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('5e552000-0000-4000-8000-000000000001', '5e555000-0000-4000-8000-00000000000c', 'entrenador_principal'),
  ('5e552000-0000-4000-8000-000000000001', '5e555000-0000-4000-8000-00000000000b', 'coordinador');

-- jugadorF ↔ f (del Team A); jugador9 ↔ 9 (de Team A2, otro team del club).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('5e553000-0000-4000-8000-00000000000f', '5ea00000-0000-4000-8000-00000000000f', 'self'),
  ('5e553000-0000-4000-8000-000000000009', '5ea00000-0000-4000-8000-000000000009', 'self');

-- Un ejercicio del club A para las tareas (con trigger desactivado, sin ciclo).
alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status) values
  ('5e9e0000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', 'Rondo 5v2', 'published');
alter table public.exercises enable trigger trg_exercises_validate;

-- ── H1: el trigger sembró can_create_sessions para los ayudantes ─────────────
do $$
declare n int;
begin
  select count(*) into n from public.capabilities
   where membership_id = '5e555000-0000-4000-8000-00000000000d'
     and capability_name = 'can_create_sessions';
  if n <> 1 then raise exception 'FAIL [H1]: el ayudante no tiene fila can_create_sessions'; end if;
end $$;

-- ayudante D: capability concedida; ayudante E: sin capability.
update public.capabilities set granted = true
  where membership_id = '5e555000-0000-4000-8000-00000000000d' and capability_name = 'can_create_sessions';
update public.capabilities set granted = false
  where membership_id = '5e555000-0000-4000-8000-00000000000e' and capability_name = 'can_create_sessions';

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT / autoridad
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- I1: ayudante CON capability crea sesión → OK
set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
do $$
begin
  insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date)
  values ('5e500000-0000-4000-8000-000000000001', '5ea00000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-09-10');
exception when others then
  raise exception 'FAIL [I1]: ayudante con cap no pudo crear sesión: %', sqlerrm;
end $$;

-- I2: ayudante SIN capability crea → RLS lo rechaza
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000e","role":"authenticated"}';
  begin
    insert into public.sessions (owner_profile_id, club_id, team_id, session_date)
    values ('5ea00000-0000-4000-8000-00000000000e', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-09-10');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I2]: ayudante sin cap pudo insertar'; end if;
end $$;

-- I3: principal (vía team_staff) crea → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.sessions (owner_profile_id, club_id, team_id, session_date)
  values ('5ea00000-0000-4000-8000-00000000000c', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-09-11');
exception when others then
  raise exception 'FAIL [I3]: principal no pudo crear: %', sqlerrm;
end $$;

-- I4: coord crea sesión de un equipo que COORDINA (Team A) → OK (C-1b).
do $$
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  insert into public.sessions (owner_profile_id, club_id, team_id, session_date)
  values ('5ea00000-0000-4000-8000-00000000000b', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-09-12');
exception when others then
  raise exception 'FAIL [I4]: coord (coordina Team A) no pudo crear sesión de su equipo: %', sqlerrm;
end $$;

-- I5: jugador crea → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.sessions (owner_profile_id, club_id, team_id, session_date)
    values ('5ea00000-0000-4000-8000-00000000000f', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-09-12');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I5]: jugador pudo insertar'; end if;
end $$;

-- I6: admin de club B inserta en club A → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5eb00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.sessions (owner_profile_id, club_id, session_date)
    values ('5eb00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', '2026-09-12');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I6]: admin ajeno pudo insertar en club A'; end if;
end $$;

-- I7: owner forzado a auth.uid — d inserta con owner = e → la fila queda con owner d
do $$
declare v_owner uuid;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.sessions (id, owner_profile_id, club_id, session_date)
  values ('5e500000-0000-4000-8000-0000000000aa', '5ea00000-0000-4000-8000-00000000000e', '5e550000-0000-4000-8000-000000000001', '2026-09-13');
  select owner_profile_id into v_owner from public.sessions where id = '5e500000-0000-4000-8000-0000000000aa';
  if v_owner <> '5ea00000-0000-4000-8000-00000000000d' then
    raise exception 'FAIL [I7]: owner no se forzó a auth.uid (quedó %)', v_owner;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- CHECKs de coherencia plantilla↔fecha/evento/visibilidad
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- C1: plantilla CON fecha → check_violation
do $$
declare ok boolean := false;
begin
  begin
    insert into public.sessions (owner_profile_id, club_id, is_template, session_date)
    values ('5ea00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', true, '2026-09-10');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [C1]: plantilla con fecha no fue rechazada'; end if;
end $$;

-- C2: sesión real SIN fecha → check_violation
do $$
declare ok boolean := false;
begin
  begin
    insert into public.sessions (owner_profile_id, club_id, is_template, session_date)
    values ('5ea00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', false, null);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [C2]: sesión real sin fecha no fue rechazada'; end if;
end $$;

-- C3: plantilla con visibility='team' → check_violation
do $$
declare ok boolean := false;
begin
  begin
    insert into public.sessions (owner_profile_id, club_id, is_template, session_date, visibility)
    values ('5ea00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', true, null, 'team');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [C3]: plantilla con visibility=team no fue rechazada'; end if;
end $$;

-- C4: plantilla válida (sin fecha, staff) → OK
do $$
begin
  insert into public.sessions (id, owner_profile_id, club_id, is_template, session_date, title)
  values ('5e500000-0000-4000-8000-0000000000bb', '5ea00000-0000-4000-8000-00000000000a', '5e550000-0000-4000-8000-000000000001', true, null, 'Plantilla micro');
exception when others then
  raise exception 'FAIL [C4]: plantilla válida no se pudo crear: %', sqlerrm;
end $$;

reset role;

-- ── Semilla de sesiones para SELECT/hijas (trigger off para fijar owner/visib.) ──
-- c1 = sesión staff · c2 = sesión team · c3 = plantilla.
alter table public.sessions disable trigger trg_sessions_validate;
insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date, visibility, is_template) values
  ('5e500000-0000-4000-8000-0000000000c1', '5ea00000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-10-01', 'staff', false),
  ('5e500000-0000-4000-8000-0000000000c2', '5ea00000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000001', '2026-10-02', 'team',  false),
  ('5e500000-0000-4000-8000-0000000000c3', '5ea00000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-000000000001', null, null, 'staff', true),
  -- c4: sesión de Team A2 (equipo que el coordinador NO coordina), owner = ayudante d.
  -- Es la sesión "ajena" al coordinador para U3/B5/D3: coord no es owner, ni admin, ni
  -- staff de Team A2 → no puede editar/borrar/añadir bloques. (Antes esos casos usaban
  -- c1/c2 de Team A, pero ahora el coord SÍ coordina Team A y tendría autoridad.)
  ('5e500000-0000-4000-8000-0000000000c4', '5ea00000-0000-4000-8000-00000000000d', '5e550000-0000-4000-8000-000000000001', '5e552000-0000-4000-8000-000000000002', '2026-10-03', 'staff', false);
alter table public.sessions enable trigger trg_sessions_validate;

-- Bloques (1 por sesión real) + 1 tarea en la sesión team. El trigger deriva club_id.
insert into public.session_blocks (id, session_id, club_id, block_type, order_idx) values
  ('5e5b0000-0000-4000-8000-0000000000c1', '5e500000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-000000000001', 'principal', 0),
  ('5e5b0000-0000-4000-8000-0000000000c2', '5e500000-0000-4000-8000-0000000000c2', '5e550000-0000-4000-8000-000000000001', 'principal', 0);
insert into public.session_block_exercises (id, block_id, session_id, club_id, exercise_id, order_idx, duration_min, series) values
  ('5e5e0000-0000-4000-8000-0000000000c2', '5e5b0000-0000-4000-8000-0000000000c2', '5e500000-0000-4000-8000-0000000000c2', '5e550000-0000-4000-8000-000000000001', '5e9e0000-0000-4000-8000-000000000001', 0, 18, '2 x 8''');

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT por rol / visibility
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- S1: staff (coord) ve sesión staff + team + plantilla.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.sessions
   where id in ('5e500000-0000-4000-8000-0000000000c1','5e500000-0000-4000-8000-0000000000c2','5e500000-0000-4000-8000-0000000000c3');
  if n <> 3 then raise exception 'FAIL [S1]: el staff no ve las 3 sesiones (vio %)', n; end if;
end $$;

-- S2: jugador del team ve SOLO la sesión team (no staff, no plantilla).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.sessions where id = '5e500000-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FAIL [S2a]: jugador del team no ve la sesión team'; end if;
  select count(*) into n from public.sessions
   where id in ('5e500000-0000-4000-8000-0000000000c1','5e500000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S2b]: jugador del team ve sesión staff/plantilla'; end if;
end $$;

-- S3: jugador de OTRO team (9) no ve la sesión team de Team A.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-000000000009","role":"authenticated"}';
  select count(*) into n from public.sessions where id = '5e500000-0000-4000-8000-0000000000c2';
  if n <> 0 then raise exception 'FAIL [S3]: jugador de otro team ve la sesión team ajena'; end if;
end $$;

-- S4: admin de club B no ve nada de club A.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5eb00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.sessions
   where id in ('5e500000-0000-4000-8000-0000000000c1','5e500000-0000-4000-8000-0000000000c2','5e500000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S4]: admin ajeno ve sesiones de club A'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE / DELETE
-- ─────────────────────────────────────────────────────────────────────────────

-- U1: owner edita su sesión → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.sessions set title = 'Editada' where id = '5e500000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U1]: owner no pudo editar su sesión'; end if;
end $$;

-- U2: admin (no owner) edita → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.sessions set title = 'Admin edit' where id = '5e500000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U2]: admin no pudo editar sesión ajena'; end if;
end $$;

-- U3: coord (no owner, no admin, NO coordina Team A2) edita c4 → 0 filas (RLS)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  update public.sessions set title = 'hack' where id = '5e500000-0000-4000-8000-0000000000c4';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U3]: coord editó sesión de un equipo que no coordina (Team A2)'; end if;
end $$;

-- U4: owner inmutable → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    update public.sessions set owner_profile_id = '5ea00000-0000-4000-8000-00000000000a'
     where id = '5e500000-0000-4000-8000-0000000000c2';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U4]: se pudo cambiar el owner'; end if;
end $$;

-- U5: jugador del team NO puede editar la sesión team → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  update public.sessions set title = 'hack jugador' where id = '5e500000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U5]: jugador editó la sesión team'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Hijas: herencia de visibilidad/edición + derivación de club_id/session_id
-- ─────────────────────────────────────────────────────────────────────────────

-- B1: staff (coord) ve los bloques de ambas sesiones.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.session_blocks
   where id in ('5e5b0000-0000-4000-8000-0000000000c1','5e5b0000-0000-4000-8000-0000000000c2');
  if n <> 2 then raise exception 'FAIL [B1]: staff no ve los 2 bloques (vio %)', n; end if;
end $$;

-- B2: jugador del team ve el bloque de la sesión team, NO el de la staff.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FAIL [B2a]: jugador no ve el bloque de la sesión team'; end if;
  select count(*) into n from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000c1';
  if n <> 0 then raise exception 'FAIL [B2b]: jugador ve el bloque de la sesión staff'; end if;
end $$;

-- B3: owner inserta un bloque en su sesión y el trigger DERIVA club_id correcto
-- (pasamos club B a propósito; debe quedar el club del padre = club A).
do $$
declare v_club uuid;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.session_blocks (id, session_id, club_id, block_type, order_idx)
  values ('5e5b0000-0000-4000-8000-0000000000d3', '5e500000-0000-4000-8000-0000000000c1', '5e550000-0000-4000-8000-000000000002', 'calentamiento', 1);
  select club_id into v_club from public.session_blocks where id = '5e5b0000-0000-4000-8000-0000000000d3';
  if v_club <> '5e550000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [B3]: club_id no se derivó del padre (quedó %)', v_club;
  end if;
end $$;

-- B4: jugador del team NO puede insertar bloques en la sesión team → 42501
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.session_blocks (session_id, club_id, block_type, order_idx)
    values ('5e500000-0000-4000-8000-0000000000c2', '5e550000-0000-4000-8000-000000000001', 'principal', 5);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [B4]: jugador insertó un bloque'; end if;
end $$;

-- B5: coord (no coordina Team A2) NO puede insertar bloques en la sesión c4 → 42501
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  begin
    insert into public.session_blocks (session_id, club_id, block_type, order_idx)
    values ('5e500000-0000-4000-8000-0000000000c4', '5e550000-0000-4000-8000-000000000001', 'principal', 7);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [B5]: coord insertó un bloque en sesión de un equipo que no coordina'; end if;
end $$;

-- X1: owner inserta una tarea; el trigger deriva session_id+club_id del bloque
-- (pasamos session/club equivocados; deben corregirse desde el bloque).
do $$
declare v_session uuid; v_club uuid;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.session_block_exercises (id, block_id, session_id, club_id, exercise_id, order_idx)
  values ('5e5e0000-0000-4000-8000-0000000000e2', '5e5b0000-0000-4000-8000-0000000000c1', '5e500000-0000-4000-8000-0000000000c2', '5e550000-0000-4000-8000-000000000002', '5e9e0000-0000-4000-8000-000000000001', 0);
  select session_id, club_id into v_session, v_club from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000e2';
  if v_session <> '5e500000-0000-4000-8000-0000000000c1' or v_club <> '5e550000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [X1]: no se derivaron session_id/club_id del bloque (% / %)', v_session, v_club;
  end if;
end $$;

-- X2: jugador del team ve la tarea de la sesión team (herencia vía session_id).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FAIL [X2]: jugador no ve la tarea de la sesión team'; end if;
end $$;

-- D1: owner borra su sesión (cascada a bloques/tareas) → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  delete from public.sessions where id = '5e500000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D1]: owner no pudo borrar su sesión'; end if;
  select count(*) into n from public.session_blocks where session_id = '5e500000-0000-4000-8000-0000000000c1';
  if n <> 0 then raise exception 'FAIL [D1b]: los bloques no cayeron en cascada'; end if;
end $$;

-- D2: admin borra una sesión ajena → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  delete from public.sessions where id = '5e500000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D2]: admin no pudo borrar plantilla ajena'; end if;
end $$;

-- D3: coord (no coordina Team A2) borra c4 → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  delete from public.sessions where id = '5e500000-0000-4000-8000-0000000000c4';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [D3]: coord borró sesión de un equipo que no coordina (Team A2)'; end if;
end $$;

reset role;

rollback;
