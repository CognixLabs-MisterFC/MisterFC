-- Tests F2.6 — RLS y constraints de team_staff
--
-- Verifica:
--   C1. INSERT con (team_id, membership_id, staff_role) válido → OK.
--   C2. staff_role inválido (text libre) → CHECK rechaza.
--   C3. UNIQUE active: dos filas activas mismo (team, membership) → rechazado.
--   C4. UNIQUE principal activo único por team → rechazado.
--   T1. RLS SELECT: miembro del club ve filas del team de su club; cross-club no.
--   T2. RLS INSERT: admin/coord pueden; entrenador_principal NO; jugador NO.
--   H1. user_is_staff_of_team(team) → true para staff activo del team, false fuera.
--   X1. invitations.team_staff_role + role incoherente → CHECK rechaza.
--   X2. invitations con team_id de otro club → trigger 23514.
\ir helpers/auth_users.sql

begin;

-- Setup
insert into public.clubs (id, name, slug) values
  ('11abcdef-c0c0-0000-0000-000000000001', 'Club Alfa Staff', 'alfa-staff'),
  ('11abcdef-c1c1-0000-0000-000000000001', 'Club Beta Staff', 'beta-staff');

insert into public.categories (id, club_id, name) values
  ('22abcdef-0000-0000-0000-000000000001', '11abcdef-c0c0-0000-0000-000000000001', 'Cat A'),
  ('22abcdef-0000-0000-0000-000000000002', '11abcdef-c1c1-0000-0000-000000000001', 'Cat B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('33abcdef-0000-0000-0000-000000000001', '22abcdef-0000-0000-0000-000000000001', 'Team A', 'F7', '#10B981', '2025-26'),
  ('33abcdef-0000-0000-0000-000000000002', '22abcdef-0000-0000-0000-000000000002', 'Team B', 'F7', '#10B981', '2025-26');

select pg_temp.new_test_user('44abcdef-aaaa-1111-1111-111111111111', 'admin-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44abcdef-aaaa-2222-2222-222222222222', 'coord-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44abcdef-aaaa-3333-3333-333333333333', 'principal-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44abcdef-aaaa-4444-4444-444444444444', 'assistant-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44abcdef-aaaa-5555-5555-555555555555', 'jugador-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44abcdef-bbbb-6666-6666-666666666666', 'admin-b@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55abcdef-aaaa-1111-1111-111111111111', '44abcdef-aaaa-1111-1111-111111111111', '11abcdef-c0c0-0000-0000-000000000001', 'admin_club'),
  ('55abcdef-aaaa-2222-2222-222222222222', '44abcdef-aaaa-2222-2222-222222222222', '11abcdef-c0c0-0000-0000-000000000001', 'coordinador'),
  ('55abcdef-aaaa-3333-3333-333333333333', '44abcdef-aaaa-3333-3333-333333333333', '11abcdef-c0c0-0000-0000-000000000001', 'entrenador_principal'),
  ('55abcdef-aaaa-4444-4444-444444444444', '44abcdef-aaaa-4444-4444-444444444444', '11abcdef-c0c0-0000-0000-000000000001', 'entrenador_ayudante'),
  ('55abcdef-aaaa-5555-5555-555555555555', '44abcdef-aaaa-5555-5555-555555555555', '11abcdef-c0c0-0000-0000-000000000001', 'jugador'),
  ('55abcdef-bbbb-6666-6666-666666666666', '44abcdef-bbbb-6666-6666-666666666666', '11abcdef-c1c1-0000-0000-000000000001', 'admin_club');

-- ─────────────────────────────────────────────────────────────────────────────
-- C1: INSERT válido
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  insert into public.team_staff (team_id, membership_id, staff_role) values
    ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-3333-3333-333333333333', 'entrenador_principal'),
    ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-4444-4444-444444444444', 'entrenador_ayudante');
exception when others then
  raise exception 'FAIL [C1]: insert válido falló: %', sqlerrm;
end $$;

-- C2: staff_role inválido
do $$
declare ok boolean := false;
begin
  begin
    insert into public.team_staff (team_id, membership_id, staff_role)
    values ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-2222-2222-222222222222', 'utillero');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C2]: staff_role libre debería rechazarse';
  end if;
end $$;

-- C3: UNIQUE active → rechazar segundo INSERT con la MISMA (team, membership, staff_role).
-- F15-A2: C-0 (mig 20261008) cambió el unique parcial de (team_id, membership_id) a
-- (team_id, membership_id, staff_role) WHERE left_at is null → una persona SÍ puede
-- tener varios roles activos en el mismo equipo. Por eso el duplicado que debe
-- rechazarse hoy es el de los TRES campos: repetimos el 'entrenador_ayudante' que C1
-- ya dejó activo para el membership 4444 (antes se probaba con 'delegado', que bajo el
-- unique nuevo YA no colisiona y por eso pasaba de largo).
do $$
declare ok boolean := false;
begin
  begin
    insert into public.team_staff (team_id, membership_id, staff_role)
    values ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-4444-4444-444444444444', 'entrenador_ayudante');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C3]: segundo (team, membership, staff_role) activo no debería pasar';
  end if;
end $$;

-- C4: principal único activo por team
do $$
declare ok boolean := false;
begin
  begin
    insert into public.team_staff (team_id, membership_id, staff_role)
    values ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-2222-2222-222222222222', 'entrenador_principal');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C4]: segundo principal activo no debería pasar';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: RLS SELECT por club
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44abcdef-aaaa-4444-4444-444444444444","role":"authenticated"}';
do $$
declare cnt int;
begin
  select count(*) into cnt from public.team_staff
   where team_id = '33abcdef-0000-0000-0000-000000000001';
  if cnt < 2 then
    raise exception 'FAIL [T1.a]: ayudante del club no ve staff del team (cnt=%)', cnt;
  end if;
end $$;

set local "request.jwt.claims" = '{"sub":"44abcdef-bbbb-6666-6666-666666666666","role":"authenticated"}';
do $$
declare cnt int;
begin
  select count(*) into cnt from public.team_staff
   where team_id = '33abcdef-0000-0000-0000-000000000001';
  if cnt <> 0 then
    raise exception 'FAIL [T1.b]: admin de otro club ve staff cross-club (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: RLS INSERT
-- ─────────────────────────────────────────────────────────────────────────────

-- admin del club → puede INSERT
set local "request.jwt.claims" = '{"sub":"44abcdef-aaaa-1111-1111-111111111111","role":"authenticated"}';
do $$
begin
  insert into public.team_staff (team_id, membership_id, staff_role)
  values ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-2222-2222-222222222222', 'preparador_fisico');
exception when others then
  raise exception 'FAIL [T2.a]: admin no pudo INSERT: %', sqlerrm;
end $$;

-- entrenador_principal → no puede INSERT (RLS solo admin/coord)
set local "request.jwt.claims" = '{"sub":"44abcdef-aaaa-3333-3333-333333333333","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.team_staff (team_id, membership_id, staff_role)
    values ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-1111-1111-111111111111', 'delegado');
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [T2.b]: principal pudo INSERT (no debería)';
  end if;
end $$;

-- jugador → no puede INSERT
set local "request.jwt.claims" = '{"sub":"44abcdef-aaaa-5555-5555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.team_staff (team_id, membership_id, staff_role)
    values ('33abcdef-0000-0000-0000-000000000001', '55abcdef-aaaa-5555-5555-555555555555', 'delegado');
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [T2.c]: jugador pudo INSERT (no debería)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- H1: user_is_staff_of_team
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare got boolean;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"44abcdef-aaaa-4444-4444-444444444444","role":"authenticated"}', true);
  select public.user_is_staff_of_team('33abcdef-0000-0000-0000-000000000001') into got;
  if got is distinct from true then
    raise exception 'FAIL [H1.a]: ayudante activo del team no detectado (got=%)', got;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"44abcdef-aaaa-5555-5555-555555555555","role":"authenticated"}', true);
  select public.user_is_staff_of_team('33abcdef-0000-0000-0000-000000000001') into got;
  if got is distinct from false then
    raise exception 'FAIL [H1.b]: jugador no debería ser staff del team (got=%)', got;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- X1: invitations.team_staff_role inconsistente con role membership
--     (principal exige role=entrenador_principal; resto exige ayudante)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (email, club_id, role, team_id, team_staff_role)
    values ('x@x.test', '11abcdef-c0c0-0000-0000-000000000001', 'entrenador_ayudante',
            '33abcdef-0000-0000-0000-000000000001', 'entrenador_principal');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [X1]: invitations con role↔team_staff_role inconsistente debería rechazarse';
  end if;
end $$;

-- X2: invitations con team_id de otro club → trigger
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (email, club_id, role, team_id, team_staff_role)
    values ('x2@x.test', '11abcdef-c0c0-0000-0000-000000000001', 'entrenador_ayudante',
            '33abcdef-0000-0000-0000-000000000002', 'delegado');
  exception when others then
    if sqlstate = '23514' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [X2]: invitations con team de otro club debería disparar trigger same_club';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS team_staff + capabilities pasaron.'
\echo '──────────────────────────────────────────────'
