-- F5 Lote A — Tests RLS de `announcements`.
--
-- Cobertura:
--   A1. Miembro del club (jugador) SELECT anuncio del team → OK.
--   A2. Admin de OTRO club SELECT → 0 rows (multi-tenant).
--   A3. INSERT con can_message_families granted (ayudante) → OK.
--   A4. INSERT sin capability (ayudante sin grant) → ❌ (RLS bloquea).
--   A5. DELETE por autor → OK.
--   A6. DELETE por admin del club (no autor) → OK.
--   A7. UPDATE author_profile_id → trigger rechaza (autor inmutable).

begin;

insert into public.clubs (id, name, slug) values
  ('11111111-1111-4111-8111-1111111100b1', 'Club Ann A', 'club-ann-a'),
  ('11111111-1111-4111-8111-1111111100b2', 'Club Ann B', 'club-ann-b');

insert into public.categories (id, club_id, name, season) values
  ('22222222-2222-4222-8222-2222222200b1', '11111111-1111-4111-8111-1111111100b1', 'Cat A', '2025-26'),
  ('22222222-2222-4222-8222-2222222200b2', '11111111-1111-4111-8111-1111111100b2', 'Cat B', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('33333333-3333-4333-8333-3333333300b1', '22222222-2222-4222-8222-2222222200b1', 'Team A', 'F7', '#10B981'),
  ('33333333-3333-4333-8333-3333333300b2', '22222222-2222-4222-8222-2222222200b2', 'Team B', 'F7', '#10B981');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44444444-4444-4444-8444-4444444400b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-ann@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-ann@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400b3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayud-ann@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400b4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jug-ann@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400b5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b-ann@msg.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55555555-5555-4555-8555-5555555500b1', '44444444-4444-4444-8444-4444444400b1', '11111111-1111-4111-8111-1111111100b1', 'admin_club'),
  ('55555555-5555-4555-8555-5555555500b2', '44444444-4444-4444-8444-4444444400b2', '11111111-1111-4111-8111-1111111100b1', 'entrenador_principal'),
  ('55555555-5555-4555-8555-5555555500b3', '44444444-4444-4444-8444-4444444400b3', '11111111-1111-4111-8111-1111111100b1', 'entrenador_ayudante'),
  ('55555555-5555-4555-8555-5555555500b4', '44444444-4444-4444-8444-4444444400b4', '11111111-1111-4111-8111-1111111100b1', 'jugador'),
  ('55555555-5555-4555-8555-5555555500b5', '44444444-4444-4444-8444-4444444400b5', '11111111-1111-4111-8111-1111111100b2', 'admin_club');

-- Capability ayudante: por defecto granted=true al sembrar (trigger).
-- Para A4 vamos a desactivarla; para A3 dejarla on.
-- Comprobación: el trigger ensure_assistant_capabilities siembra TODAS las
-- caps en granted=true al crear membership ayudante. Confirmamos y luego
-- modificamos.
do $$
declare v_granted boolean;
begin
  select granted into v_granted from public.capabilities
   where membership_id = '55555555-5555-4555-8555-5555555500b3'
     and capability_name = 'can_message_families';
  if v_granted is null or not v_granted then
    raise notice 'cap default no-grant; seed manual';
    insert into public.capabilities (membership_id, capability_name, granted) values
      ('55555555-5555-4555-8555-5555555500b3', 'can_message_families', true)
    on conflict (membership_id, capability_name) do update set granted = true;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A1: jugador del club ve anuncio del team
-- ─────────────────────────────────────────────────────────────────────────────
-- Sembrar 1 announcement por principal del Team A.
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b2","role":"authenticated"}';
  insert into public.announcements (id, team_id, author_profile_id, title, body) values
    ('99999999-9999-4999-8999-9999999900b1',
     '33333333-3333-4333-8333-3333333300b1',
     '44444444-4444-4444-8444-4444444400b2',
     'Calentamiento mañana', 'A las 17:30 en pista B');
  reset role;
end $$;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b4","role":"authenticated"}';
  select count(*) into v_count from public.announcements
   where id = '99999999-9999-4999-8999-9999999900b1';
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL [A1]: jugador del club no ve anuncio (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A2: admin de OTRO club → 0 rows
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b5","role":"authenticated"}';
  select count(*) into v_count from public.announcements
   where id = '99999999-9999-4999-8999-9999999900b1';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL [A2]: admin de otro club ve anuncio (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A3: ayudante con cap on INSERT → OK
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_ann_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b3","role":"authenticated"}';
  insert into public.announcements (team_id, author_profile_id, title, body) values
    ('33333333-3333-4333-8333-3333333300b1',
     '44444444-4444-4444-8444-4444444400b3',
     'Mensaje del ayudante', 'Recordatorio de equipación')
  returning id into v_ann_id;
  reset role;
  if v_ann_id is null then
    raise exception 'FAIL [A3]: ayudante con cap no pudo insertar anuncio';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A4: ayudante con cap OFF → ❌
-- ─────────────────────────────────────────────────────────────────────────────
update public.capabilities set granted = false
 where membership_id = '55555555-5555-4555-8555-5555555500b3'
   and capability_name = 'can_message_families';

do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b3","role":"authenticated"}';
  begin
    insert into public.announcements (team_id, author_profile_id, title, body) values
      ('33333333-3333-4333-8333-3333333300b1',
       '44444444-4444-4444-8444-4444444400b3',
       't-off', 'b-off');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [A4]: ayudante sin cap pudo insertar';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A5: DELETE por autor (principal) → OK
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b2","role":"authenticated"}';
  delete from public.announcements where id = '99999999-9999-4999-8999-9999999900b1';
  reset role;
  select count(*) into v_count from public.announcements where id = '99999999-9999-4999-8999-9999999900b1';
  if v_count <> 0 then
    raise exception 'FAIL [A5]: autor no pudo borrar su anuncio (quedan %)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A6: DELETE por admin del club (no autor) — sembrar de nuevo
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b2","role":"authenticated"}';
  insert into public.announcements (id, team_id, author_profile_id, title, body) values
    ('99999999-9999-4999-8999-9999999900b9',
     '33333333-3333-4333-8333-3333333300b1',
     '44444444-4444-4444-8444-4444444400b2',
     'Otro', 'Otro body');
  reset role;
end $$;

do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b1","role":"authenticated"}';
  delete from public.announcements where id = '99999999-9999-4999-8999-9999999900b9';
  reset role;
  select count(*) into v_count from public.announcements where id = '99999999-9999-4999-8999-9999999900b9';
  if v_count <> 0 then
    raise exception 'FAIL [A6]: admin no pudo borrar anuncio ajeno (quedan %)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- A7: UPDATE author_profile_id → trigger rechaza (autor inmutable)
-- ─────────────────────────────────────────────────────────────────────────────
-- Sembramos un nuevo announcement primero.
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b2","role":"authenticated"}';
  insert into public.announcements (id, team_id, author_profile_id, title, body) values
    ('99999999-9999-4999-8999-9999999900b7',
     '33333333-3333-4333-8333-3333333300b1',
     '44444444-4444-4444-8444-4444444400b2',
     'Inmutable', 'autor inmutable test');
  reset role;
end $$;

do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400b1","role":"authenticated"}';
  begin
    update public.announcements
       set author_profile_id = '44444444-4444-4444-8444-4444444400b1'
     where id = '99999999-9999-4999-8999-9999999900b7';
  exception when check_violation then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [A7]: author_profile_id no fue protegido por trigger';
  end if;
end $$;

rollback;

select 'OK rls_announcements' as result;
