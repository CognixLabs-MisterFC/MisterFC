-- Tests F2.7 — RLS de capabilities UPDATE
--
-- Verifica que la policy `capabilities_update` (F1.7) cumple:
--   T1. admin del club A SI puede UPDATE cab0 de ayudante en club A.
--   T2. coord del club A NO puede UPDATE (C-1d: no toca capabilities).
--   T3. principal del equipo A1 SI puede UPDATE cab0 de un ayudante de A1.
--   T3b. principal del equipo A2 NO puede UPDATE cab0 de un ayudante que solo es
--       staff de A1 (F14.9: sin equipo compartido → rechazado).
--   T4. el propio ayudante NO puede UPDATE de sus cab0.
--   T5. jugador del club A NO puede UPDATE.
--   T6. admin del club B NO puede UPDATE cab0 de ayudante del club A.
--   T7. principal del equipo A3 con rol de CLUB ayudante SI puede UPDATE cab0 de
--       un ayudante de A3 (autoridad por team_staff, no por memberships.role).
--   T8. ese mismo principal-de-equipo NO puede UPDATE sus PROPIAS cab0
--       (anti-escalada: el helper excluye la auto-edición).
--   X1. capability_name inválida → CHECK rechaza.
\ir helpers/auth_users.sql

begin;

-- Setup compatible con los tests existentes (UUIDs distintos para no colisionar)
insert into public.clubs (id, name, slug) values
  ('cab00000-0000-0000-0000-000000000001', 'Club Alfa Caps', 'alfa-cab0'),
  ('cab00000-0000-0000-0000-000000000002', 'Club Beta Caps', 'beta-cab0');

select pg_temp.new_test_user('cab01111-aaaa-1111-1111-111111111111', 'admin-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab02222-aaaa-2222-2222-222222222222', 'coord-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab03333-aaaa-3333-3333-333333333333', 'principal-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab04444-aaaa-4444-4444-444444444444', 'assist-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab05555-aaaa-5555-5555-555555555555', 'player-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab06666-bbbb-6666-6666-666666666666', 'adminb-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab07777-aaaa-7777-7777-777777777777', 'principal-a2-cab0@test', '{}'::jsonb);
select pg_temp.new_test_user('cab08888-aaaa-8888-8888-888888888888', 'principal-a3-club-ayud-cab0@test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('cab01111-0a00-1111-1111-111111111111', 'cab01111-aaaa-1111-1111-111111111111', 'cab00000-0000-0000-0000-000000000001', 'admin_club'),
  ('cab02222-0a00-2222-2222-222222222222', 'cab02222-aaaa-2222-2222-222222222222', 'cab00000-0000-0000-0000-000000000001', 'coordinador'),
  ('cab03333-0a00-3333-3333-333333333333', 'cab03333-aaaa-3333-3333-333333333333', 'cab00000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('cab04444-0a00-4444-4444-444444444444', 'cab04444-aaaa-4444-4444-444444444444', 'cab00000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('cab05555-0a00-5555-5555-555555555555', 'cab05555-aaaa-5555-5555-555555555555', 'cab00000-0000-0000-0000-000000000001', 'jugador'),
  ('cab06666-0a00-6666-6666-666666666666', 'cab06666-bbbb-6666-6666-666666666666', 'cab00000-0000-0000-0000-000000000002', 'admin_club'),
  ('cab07777-0a00-7777-7777-777777777777', 'cab07777-aaaa-7777-7777-777777777777', 'cab00000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('cab08888-0a00-8888-8888-888888888888', 'cab08888-aaaa-8888-8888-888888888888', 'cab00000-0000-0000-0000-000000000001', 'entrenador_ayudante');

-- Trigger sembró caps con granted=false para los ayudantes cab04444 y cab08888.

-- Equipos + team_staff para probar el filtro por equipo (un principal por equipo).
--  A1: principal cab03333, ayudante cab04444.
--  A2: principal cab07777 (cab04444 NO está aquí).
--  A3: principal cab08888 (rol club ayudante), ayudante cab04444.
insert into public.categories (id, club_id, name) values
  ('cabca700-0000-0000-0000-000000000001', 'cab00000-0000-0000-0000-000000000001', 'Cat Caps A');
insert into public.teams (id, category_id, name, format, color, season) values
  ('cab70000-0000-0000-0000-0000000000a1', 'cabca700-0000-0000-0000-000000000001', 'Caps A1', 'F7', '#10B981', '2025-26'),
  ('cab70000-0000-0000-0000-0000000000a2', 'cabca700-0000-0000-0000-000000000001', 'Caps A2', 'F7', '#3B82F6', '2025-26'),
  ('cab70000-0000-0000-0000-0000000000a3', 'cabca700-0000-0000-0000-000000000001', 'Caps A3', 'F7', '#EF4444', '2025-26');
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('cab70000-0000-0000-0000-0000000000a1', 'cab03333-0a00-3333-3333-333333333333', 'entrenador_principal'),
  ('cab70000-0000-0000-0000-0000000000a1', 'cab04444-0a00-4444-4444-444444444444', 'entrenador_ayudante'),
  ('cab70000-0000-0000-0000-0000000000a2', 'cab07777-0a00-7777-7777-777777777777', 'entrenador_principal'),
  ('cab70000-0000-0000-0000-0000000000a3', 'cab08888-0a00-8888-8888-888888888888', 'entrenador_principal'),
  ('cab70000-0000-0000-0000-0000000000a3', 'cab04444-0a00-4444-4444-444444444444', 'entrenador_ayudante');

-- Helper: intenta UPDATE como `p_sub` y devuelve el granted final (NULL si rechazado).
create or replace function pg_temp.try_update_cap(
  p_label text, p_sub text, p_membership uuid, p_cap text, p_target boolean
) returns void language plpgsql as $$
declare
  rows_affected int;
  current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"' || p_sub || '","role":"authenticated"}', true);
  update public.capabilities
     set granted = p_target
   where membership_id = p_membership and capability_name = p_cap;
  get diagnostics rows_affected = row_count;
  reset role;
  select granted into current_val
    from public.capabilities
   where membership_id = p_membership and capability_name = p_cap;
  -- Guardamos para el caller: si rows_affected = 1, debería verse p_target.
  raise notice '[%] rows=% final=%', p_label, rows_affected, current_val;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: admin SÍ puede
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab01111-aaaa-1111-1111-111111111111","role":"authenticated"}', true);
  update public.capabilities set granted = true
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  if current_val is distinct from true then
    raise exception 'FAIL [T1]: admin no pudo activar cab0 (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: coord NO puede
-- CAMBIO DE EXPECTATIVA (C-1d, mig 20261012000000): la policy viva capabilities_update
-- reserva el UPDATE a admin_club ∪ user_is_principal_of_assistant_team. El coordinador
-- ya NO toca la estructura del club (capabilities incluidas). El UPDATE pasa el filtro
-- USING como no-op (0 filas) → la capability sigue en su valor sembrado (false). Antes
-- de C-1d el coordinador sí podía → esperaba true.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab02222-aaaa-2222-2222-222222222222","role":"authenticated"}', true);
  update public.capabilities set granted = true
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_create_lineups';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_create_lineups';
  if current_val is distinct from false then
    raise exception 'FAIL [T2]: coord NO debería poder activar cab0 (C-1d); quedó=%', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: principal del equipo A1 SÍ puede editar a un ayudante de A1
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab03333-aaaa-3333-3333-333333333333","role":"authenticated"}', true);
  update public.capabilities set granted = true
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_register_match_events';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_register_match_events';
  if current_val is distinct from true then
    raise exception 'FAIL [T3]: principal de A1 no pudo activar cab0 de su ayudante (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3b: principal del equipo A2 NO puede editar a un ayudante que solo es de A1
-- (núcleo del fix F14.9: sin equipo compartido → rechazado)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab07777-aaaa-7777-7777-777777777777","role":"authenticated"}', true);
  update public.capabilities set granted = false
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_register_match_events';  -- estaba en true (T3)
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_register_match_events';
  if current_val is distinct from true then
    raise exception 'FAIL [T3b]: principal de A2 pudo editar cab0 de un ayudante de A1 (cross-team, got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: el propio ayudante NO puede
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab04444-aaaa-4444-4444-444444444444","role":"authenticated"}', true);
  update public.capabilities set granted = false
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  -- UPDATE silently no-op cuando policy USING evalúa a false.
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  if current_val is distinct from true then
    raise exception 'FAIL [T4]: ayudante pudo modificar sus propias cab0 (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5: jugador del club A NO puede
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab05555-aaaa-5555-5555-555555555555","role":"authenticated"}', true);
  update public.capabilities set granted = false
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  if current_val is distinct from true then
    raise exception 'FAIL [T5]: jugador pudo modificar cab0 ajenas (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T6: admin de club B NO puede
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab06666-bbbb-6666-6666-666666666666","role":"authenticated"}', true);
  update public.capabilities set granted = false
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  if current_val is distinct from true then
    raise exception 'FAIL [T6]: admin cross-club pudo modificar (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T7: principal del equipo A3 con rol de CLUB ayudante SÍ puede editar a un
-- ayudante de A3 (autoridad por team_staff, no por memberships.role)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab08888-aaaa-8888-8888-888888888888","role":"authenticated"}', true);
  update public.capabilities set granted = true
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_manage_squad';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_manage_squad';
  if current_val is distinct from true then
    raise exception 'FAIL [T7]: principal de equipo (rol club ayudante) no pudo editar a su ayudante (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T8: ese mismo principal-de-equipo NO puede editar sus PROPIAS cab0
-- (anti-escalada: el helper excluye la auto-edición)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare current_val boolean;
begin
  -- Parte de granted=false (sembrado por el trigger para cab08888).
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cab08888-aaaa-8888-8888-888888888888","role":"authenticated"}', true);
  update public.capabilities set granted = true
   where membership_id = 'cab08888-0a00-8888-8888-888888888888'
     and capability_name = 'can_see_medical';
  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'cab08888-0a00-8888-8888-888888888888'
     and capability_name = 'can_see_medical';
  if current_val is distinct from false then
    raise exception 'FAIL [T8]: principal-de-equipo pudo auto-concederse una capability (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- X1: capability_name inválido (intento de upsert nuevo nombre)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.capabilities (membership_id, capability_name, granted)
    values ('cab04444-0a00-4444-4444-444444444444', 'can_make_coffee', true);
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [X1]: capability_name libre debería violar CHECK';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS capabilities_update pasaron.'
\echo '──────────────────────────────────────────────'
