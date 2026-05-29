-- Tests del fix de bug capabilities UPSERT (PR fix/capabilities-admin-grant).
--
-- Contexto: el server action `toggleCapability` usaba `.upsert(... onConflict)`,
-- que PostgREST traduce a `INSERT ... ON CONFLICT DO UPDATE`. La policy F1.7
-- solo cubría UPDATE → PG denegaba la operación para CUALQUIER rol con 42501.
-- El pgTAP F2.7 (rls_capabilities_update.sql) hacía UPDATE plano y nunca cazó
-- el problema. Este test reproduce el escenario y verifica la corrección.
--
-- Cubre:
--   U1. admin_club ejecuta INSERT ... ON CONFLICT DO UPDATE → OK.
--   U2. coordinador hace lo mismo → OK.
--   U3. entrenador_principal hace lo mismo → OK.
--   U4. el propio ayudante NO puede hacerlo → 42501.
--   U5. jugador del club NO puede hacerlo → 42501.
--   U6. admin de OTRO club NO puede hacerlo → 42501.
--   U7. UPSERT con capability_name no listado → CHECK rechaza (incluso siendo admin).

begin;

-- Setup (UUIDs nuevos para no colisionar con otros tests del repo).
insert into public.clubs (id, name, slug) values
  ('caf00000-0000-0000-0000-000000000001', 'Club Alfa Upsert', 'alfa-upsert'),
  ('caf00000-0000-0000-0000-000000000002', 'Club Beta Upsert', 'beta-upsert');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('caf01111-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-up@ts.test', now(), '{}'::jsonb, now(), now()),
  ('caf02222-aaaa-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-up@ts.test', now(), '{}'::jsonb, now(), now()),
  ('caf03333-aaaa-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-up@ts.test', now(), '{}'::jsonb, now(), now()),
  ('caf04444-aaaa-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assist-up@ts.test', now(), '{}'::jsonb, now(), now()),
  ('caf05555-aaaa-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-up@ts.test', now(), '{}'::jsonb, now(), now()),
  ('caf06666-bbbb-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-otro-up@ts.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('caf01111-0a00-1111-1111-111111111111', 'caf01111-aaaa-1111-1111-111111111111', 'caf00000-0000-0000-0000-000000000001', 'admin_club'),
  ('caf02222-0a00-2222-2222-222222222222', 'caf02222-aaaa-2222-2222-222222222222', 'caf00000-0000-0000-0000-000000000001', 'coordinador'),
  ('caf03333-0a00-3333-3333-333333333333', 'caf03333-aaaa-3333-3333-333333333333', 'caf00000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('caf04444-0a00-4444-4444-444444444444', 'caf04444-aaaa-4444-4444-444444444444', 'caf00000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('caf05555-0a00-5555-5555-555555555555', 'caf05555-aaaa-5555-5555-555555555555', 'caf00000-0000-0000-0000-000000000001', 'jugador'),
  ('caf06666-0a00-6666-6666-666666666666', 'caf06666-bbbb-6666-6666-666666666666', 'caf00000-0000-0000-0000-000000000002', 'admin_club');

-- El trigger sembró las 9 filas con granted=false para el ayudante caf04444.

-- ─────────────────────────────────────────────────────────────────────────────
-- U1: admin_club ejecuta UPSERT (INSERT ON CONFLICT) → OK
-- Reproduce literalmente la operación de supabase-js .upsert(..., onConflict).
-- Antes del fix esto fallaba con 42501.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"caf01111-aaaa-1111-1111-111111111111","role":"authenticated"}';
do $$
declare current_val boolean;
begin
  insert into public.capabilities (membership_id, capability_name, granted)
  values ('caf04444-0a00-4444-4444-444444444444', 'can_manage_calendar', true)
  on conflict (membership_id, capability_name) do update set granted = excluded.granted;

  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'caf04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_manage_calendar';
  if current_val is distinct from true then
    raise exception 'FAIL [U1]: admin no pudo UPSERT (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- U2: coordinador → OK
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"caf02222-aaaa-2222-2222-222222222222","role":"authenticated"}';
do $$
declare current_val boolean;
begin
  insert into public.capabilities (membership_id, capability_name, granted)
  values ('caf04444-0a00-4444-4444-444444444444', 'can_evaluate', true)
  on conflict (membership_id, capability_name) do update set granted = excluded.granted;

  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'caf04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_evaluate';
  if current_val is distinct from true then
    raise exception 'FAIL [U2]: coord no pudo UPSERT (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- U3: entrenador_principal → OK
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"caf03333-aaaa-3333-3333-333333333333","role":"authenticated"}';
do $$
declare current_val boolean;
begin
  insert into public.capabilities (membership_id, capability_name, granted)
  values ('caf04444-0a00-4444-4444-444444444444', 'can_create_lineups', true)
  on conflict (membership_id, capability_name) do update set granted = excluded.granted;

  reset role;
  select granted into current_val from public.capabilities
   where membership_id = 'caf04444-0a00-4444-4444-444444444444'
     and capability_name = 'can_create_lineups';
  if current_val is distinct from true then
    raise exception 'FAIL [U3]: principal no pudo UPSERT (got=%)', current_val;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- U4: el propio ayudante NO puede
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"caf04444-aaaa-4444-4444-444444444444","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.capabilities (membership_id, capability_name, granted)
    values ('caf04444-0a00-4444-4444-444444444444', 'can_see_medical', true)
    on conflict (membership_id, capability_name) do update set granted = excluded.granted;
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [U4]: ayudante pudo UPSERT (no debería)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- U5: jugador del club → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"caf05555-aaaa-5555-5555-555555555555","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.capabilities (membership_id, capability_name, granted)
    values ('caf04444-0a00-4444-4444-444444444444', 'can_message_families', true)
    on conflict (membership_id, capability_name) do update set granted = excluded.granted;
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [U5]: jugador pudo UPSERT (no debería)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- U6: admin de OTRO club → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"caf06666-bbbb-6666-6666-666666666666","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.capabilities (membership_id, capability_name, granted)
    values ('caf04444-0a00-4444-4444-444444444444', 'can_create_sessions', true)
    on conflict (membership_id, capability_name) do update set granted = excluded.granted;
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [U6]: admin cross-club pudo UPSERT (no debería)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- U7: UPSERT con capability_name fuera del enum (admin) → CHECK rechaza
-- Defensa: el CHECK del nombre es la única barrera real contra capabilities
-- inventadas; sin esto, un admin podría crear filas con capability arbitraria.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"caf01111-aaaa-1111-1111-111111111111","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.capabilities (membership_id, capability_name, granted)
    values ('caf04444-0a00-4444-4444-444444444444', 'can_make_coffee', true)
    on conflict (membership_id, capability_name) do update set granted = excluded.granted;
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [U7]: admin pudo UPSERT capability libre';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS capabilities UPSERT (fix bug) pasaron.'
\echo '──────────────────────────────────────────────'
