-- Tests F2.7 — RLS de capabilities UPDATE
--
-- Verifica que la policy `capabilities_update` (F1.7) cumple:
--   T1. admin del club A SI puede UPDATE cab0 de ayudante en club A.
--   T2. coord del club A SI puede UPDATE.
--   T3. principal del club A SI puede UPDATE (sin matiz por team — limitación
--       conocida documentada en known-issues.md).
--   T4. el propio ayudante NO puede UPDATE de sus cab0.
--   T5. jugador del club A NO puede UPDATE.
--   T6. admin del club B NO puede UPDATE cab0 de ayudante del club A.
--   X1. capability_name inválida → CHECK rechaza.

begin;

-- Setup compatible con los tests existentes (UUIDs distintos para no colisionar)
insert into public.clubs (id, name, slug) values
  ('cab00000-0000-0000-0000-000000000001', 'Club Alfa Caps', 'alfa-cab0'),
  ('cab00000-0000-0000-0000-000000000002', 'Club Beta Caps', 'beta-cab0');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('cab01111-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-cab0@test', now(), '{}'::jsonb, now(), now()),
  ('cab02222-aaaa-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-cab0@test', now(), '{}'::jsonb, now(), now()),
  ('cab03333-aaaa-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-cab0@test', now(), '{}'::jsonb, now(), now()),
  ('cab04444-aaaa-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assist-cab0@test', now(), '{}'::jsonb, now(), now()),
  ('cab05555-aaaa-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'player-cab0@test', now(), '{}'::jsonb, now(), now()),
  ('cab06666-bbbb-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminb-cab0@test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('cab01111-0a00-1111-1111-111111111111', 'cab01111-aaaa-1111-1111-111111111111', 'cab00000-0000-0000-0000-000000000001', 'admin_club'),
  ('cab02222-0a00-2222-2222-222222222222', 'cab02222-aaaa-2222-2222-222222222222', 'cab00000-0000-0000-0000-000000000001', 'coordinador'),
  ('cab03333-0a00-3333-3333-333333333333', 'cab03333-aaaa-3333-3333-333333333333', 'cab00000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('cab04444-0a00-4444-4444-444444444444', 'cab04444-aaaa-4444-4444-444444444444', 'cab00000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('cab05555-0a00-5555-5555-555555555555', 'cab05555-aaaa-5555-5555-555555555555', 'cab00000-0000-0000-0000-000000000001', 'jugador'),
  ('cab06666-0a00-6666-6666-666666666666', 'cab06666-bbbb-6666-6666-666666666666', 'cab00000-0000-0000-0000-000000000002', 'admin_club');

-- Trigger sembró 8 cab0 con granted=false para el ayudante cab04444.

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
-- T2: coord SÍ puede
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
  if current_val is distinct from true then
    raise exception 'FAIL [T2]: coord no pudo activar cab0 (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: principal SÍ puede (limitación conocida: cross-team)
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
    raise exception 'FAIL [T3]: principal no pudo activar cab0 (got=%)', current_val;
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
