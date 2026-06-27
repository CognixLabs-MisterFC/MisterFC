-- Tests FIX (coherencia) — el STAFF del equipo (principal Y ayudante activos) puede
-- BORRAR una sesión de su equipo; staff de OTRO equipo no; plantilla = owner ∪ admin.
-- Migración 20260812000000 (alinea sessions_delete con user_can_edit_session).
--
-- Escenario: admin crea las sesiones de un equipo; un entrenador (rol de CLUB
-- ayudante) que es principal O ayudante del equipo debe poder borrarlas.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).

begin;

insert into public.clubs (id, name, slug) values
  ('5fc00000-0000-4000-8000-000000000001', 'Club Del A', 'club-del-a');

insert into public.categories (id, club_id, name) values
  ('5fca0000-0000-4000-8000-000000000001', '5fc00000-0000-4000-8000-000000000001', 'Cat A'),
  ('5fca0000-0000-4000-8000-000000000002', '5fc00000-0000-4000-8000-000000000001', 'Cat A2');

insert into public.teams (id, category_id, name, format, color, season) values
  ('5f700000-0000-4000-8000-000000000001', '5fca0000-0000-4000-8000-000000000001', 'Team A',  'F11', '#10B981', '2025-26'),
  ('5f700000-0000-4000-8000-000000000002', '5fca0000-0000-4000-8000-000000000002', 'Team A2', 'F11', '#0EA5E9', '2025-26');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('5fa00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@del.test',  now(), '{}'::jsonb, now(), now()),
  ('5fa00000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'asst@del.test',   now(), '{}'::jsonb, now(), now()),
  ('5fa00000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coachP@del.test', now(), '{}'::jsonb, now(), now()),
  ('5fa00000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coachO@del.test', now(), '{}'::jsonb, now(), now());

-- Todos rol de CLUB = entrenador_ayudante (¡no admin!).
insert into public.memberships (id, profile_id, club_id, role) values
  ('5f550000-0000-4000-8000-00000000000a', '5fa00000-0000-4000-8000-00000000000a', '5fc00000-0000-4000-8000-000000000001', 'admin_club'),
  ('5f550000-0000-4000-8000-00000000000b', '5fa00000-0000-4000-8000-00000000000b', '5fc00000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5f550000-0000-4000-8000-00000000000c', '5fa00000-0000-4000-8000-00000000000c', '5fc00000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5f550000-0000-4000-8000-00000000000d', '5fa00000-0000-4000-8000-00000000000d', '5fc00000-0000-4000-8000-000000000001', 'entrenador_ayudante');

-- coachP = PRINCIPAL de Team A; asst = AYUDANTE de Team A; coachOther = PRINCIPAL de Team A2.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('5f700000-0000-4000-8000-000000000001', '5f550000-0000-4000-8000-00000000000c', 'entrenador_principal'),
  ('5f700000-0000-4000-8000-000000000001', '5f550000-0000-4000-8000-00000000000b', 'entrenador_ayudante'),
  ('5f700000-0000-4000-8000-000000000002', '5f550000-0000-4000-8000-00000000000d', 'entrenador_principal');

-- El ayudante de Team A necesita la capability de sesiones (no es principal de ningún
-- equipo) para superar el prerrequisito user_can_create_sessions. El trigger ya sembró
-- la fila al crear la membership; aquí se concede.
update public.capabilities set granted = true
  where membership_id = '5f550000-0000-4000-8000-00000000000b' and capability_name = 'can_create_sessions';

-- Sesiones de Team A creadas por el ADMIN (owner=admin) + una plantilla (team_id NULL).
alter table public.sessions disable trigger trg_sessions_validate;
insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date, visibility, is_template) values
  ('5f500000-0000-4000-8000-0000000000c1', '5fa00000-0000-4000-8000-00000000000a', '5fc00000-0000-4000-8000-000000000001', '5f700000-0000-4000-8000-000000000001', '2026-10-01', 'staff', false),
  ('5f500000-0000-4000-8000-0000000000c2', '5fa00000-0000-4000-8000-00000000000a', '5fc00000-0000-4000-8000-000000000001', '5f700000-0000-4000-8000-000000000001', '2026-10-02', 'staff', false),
  ('5f500000-0000-4000-8000-0000000000c3', '5fa00000-0000-4000-8000-00000000000a', '5fc00000-0000-4000-8000-000000000001', null, null, 'staff', true);
alter table public.sessions enable trigger trg_sessions_validate;

set local role authenticated;

-- DO0: staff de OTRO equipo (principal Team A2) borra una sesión de Team A → 0 filas.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5fa00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  delete from public.sessions where id = '5f500000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [DO0]: staff de otro equipo borró una sesión ajena'; end if;
end $$;

-- DA: AYUDANTE de Team A (con capability) borra una sesión de Team A → 1 fila.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5fa00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  delete from public.sessions where id = '5f500000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [DA]: el ayudante del equipo no pudo borrar la sesión de su equipo'; end if;
end $$;

-- DP: PRINCIPAL de Team A borra otra sesión de Team A → 1 fila.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5fa00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  delete from public.sessions where id = '5f500000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [DP]: el principal del equipo no pudo borrar la sesión de su equipo'; end if;
end $$;

-- DT: PLANTILLA (team_id NULL) → owner ∪ admin: el principal del equipo NO la borra → 0 filas.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5fa00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  delete from public.sessions where id = '5f500000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [DT]: el staff de equipo borró una plantilla (debe ser owner∪admin)'; end if;
end $$;

-- DAD: regresión — admin (owner) borra la plantilla → 1 fila.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5fa00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  delete from public.sessions where id = '5f500000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [DAD]: el admin/owner no pudo borrar la plantilla'; end if;
end $$;

reset role;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS borrado de sesión por staff del equipo pasaron.'
\echo '──────────────────────────────────────────────'
