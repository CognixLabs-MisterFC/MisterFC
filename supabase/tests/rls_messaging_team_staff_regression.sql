-- F5 Lote A hotfix — regresión de Bugs B+C (PR #31 review).
--
-- Caso real: user con memberships.role = 'entrenador_ayudante' a nivel club,
-- PERO team_staff.staff_role = 'entrenador_principal' de un team. Debe poder:
--   T1. Iniciar conversación con un player del club (RLS INSERT en
--       conversations cubre rama principal-by-team_staff).
--   T2. Publicar un anuncio en SU team (RLS INSERT en announcements cubre
--       rama principal-by-team_staff del team).
--
-- Y debe seguir BLOQUEADO si:
--   T3. Ayudante club que NO es principal de team_staff de NINGÚN team y
--       no tiene capability granted → INSERT conversation falla.
--   T4. Ayudante club principal de team A intenta publicar anuncio en
--       team B (no suyo): si no tiene cap on, falla; si tiene cap on,
--       pasa por la rama capability. Cubrimos el sin-cap.
--
-- Feature D — anuncios globales:
--   T5. Admin del club crea anuncio club-wide (team_id NULL) → OK.
--   T6. Principal del club NO puede crear anuncio club-wide (solo admin/coord).
--   T7. Trigger same_club: anuncio con team_id de otro club → rechazado.

begin;

-- Setup multi-rol del mismo user.
insert into public.clubs (id, name, slug) values
  ('11111111-1111-4111-8111-11111111c001', 'Club TS A', 'club-ts-a'),
  ('11111111-1111-4111-8111-11111111c002', 'Club TS B', 'club-ts-b');

insert into public.categories (id, club_id, name) values
  ('22222222-2222-4222-8222-22222222c001', '11111111-1111-4111-8111-11111111c001', 'Cat A'),
  ('22222222-2222-4222-8222-22222222c002', '11111111-1111-4111-8111-11111111c002', 'Cat B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('33333333-3333-4333-8333-33333333c001', '22222222-2222-4222-8222-22222222c001', 'Team A1', 'F7', '#10B981', '2025-26'),
  ('33333333-3333-4333-8333-33333333c002', '22222222-2222-4222-8222-22222222c001', 'Team A2', 'F7', '#10B981', '2025-26'),
  ('33333333-3333-4333-8333-33333333c003', '22222222-2222-4222-8222-22222222c002', 'Team B1', 'F7', '#10B981', '2025-26');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44444444-4444-4444-8444-44444444c001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-ts@x.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-44444444c002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-club@x.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-44444444c003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayud-principal-ts@x.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-44444444c004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayud-puro@x.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55555555-5555-4555-8555-55555555c001', '44444444-4444-4444-8444-44444444c001', '11111111-1111-4111-8111-11111111c001', 'admin_club'),
  ('55555555-5555-4555-8555-55555555c002', '44444444-4444-4444-8444-44444444c002', '11111111-1111-4111-8111-11111111c001', 'entrenador_principal'),
  -- El caso REPORTADO: ayudante club + principal team_staff.
  ('55555555-5555-4555-8555-55555555c003', '44444444-4444-4444-8444-44444444c003', '11111111-1111-4111-8111-11111111c001', 'entrenador_ayudante'),
  -- Ayudante "puro" (T3).
  ('55555555-5555-4555-8555-55555555c004', '44444444-4444-4444-8444-44444444c004', '11111111-1111-4111-8111-11111111c001', 'entrenador_ayudante');

-- ayud-principal-ts es principal de Team A1 via team_staff.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33333333-3333-4333-8333-33333333c001', '55555555-5555-4555-8555-55555555c003', 'entrenador_principal');

-- Forzamos las caps a OFF para que la única razón para que pasen las RLS
-- sea la nueva rama principal-by-team_staff (no la cap que tendría granted
-- por defecto el trigger ensure_assistant_capabilities).
update public.capabilities set granted = false
 where membership_id in ('55555555-5555-4555-8555-55555555c003', '55555555-5555-4555-8555-55555555c004');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66666666-6666-4666-8666-66666666c001', '11111111-1111-4111-8111-11111111c001', 'Test', 'Player', '2012-01-01');

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: ayudante club + principal team_staff (cap OFF) → puede crear conversation
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_conv_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c003","role":"authenticated"}';
  insert into public.conversations (club_id, player_id, coach_profile_id) values
    ('11111111-1111-4111-8111-11111111c001',
     '66666666-6666-4666-8666-66666666c001',
     '44444444-4444-4444-8444-44444444c003')
  returning id into v_conv_id;
  reset role;
  if v_conv_id is null then
    raise exception 'FAIL [T1]: principal-by-team_staff no pudo crear conversation';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: mismo user publica anuncio en SU team A1 → OK
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_ann_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c003","role":"authenticated"}';
  insert into public.announcements (team_id, club_id, author_profile_id, title, body) values
    ('33333333-3333-4333-8333-33333333c001',
     '11111111-1111-4111-8111-11111111c001',
     '44444444-4444-4444-8444-44444444c003',
     'Recordatorio', 'Equipación A')
  returning id into v_ann_id;
  reset role;
  if v_ann_id is null then
    raise exception 'FAIL [T2]: principal-by-team_staff no pudo publicar anuncio en su team';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: ayudante "puro" (sin cap, sin team_staff principal) → INSERT conv falla
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c004","role":"authenticated"}';
  begin
    insert into public.conversations (club_id, player_id, coach_profile_id) values
      ('11111111-1111-4111-8111-11111111c001',
       '66666666-6666-4666-8666-66666666c001',
       '44444444-4444-4444-8444-44444444c004');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [T3]: ayudante puro pudo crear conversation sin cap';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: ayud-principal-ts (cap OFF) intenta publicar en Team A2 (no suyo) → falla
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c003","role":"authenticated"}';
  begin
    insert into public.announcements (team_id, club_id, author_profile_id, title, body) values
      ('33333333-3333-4333-8333-33333333c002',
       '11111111-1111-4111-8111-11111111c001',
       '44444444-4444-4444-8444-44444444c003',
       't', 'b');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [T4]: principal del Team A1 pudo publicar en Team A2';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5: admin del club crea anuncio club-wide (team_id NULL) → OK
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_ann_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c001","role":"authenticated"}';
  insert into public.announcements (team_id, club_id, author_profile_id, title, body) values
    (null,
     '11111111-1111-4111-8111-11111111c001',
     '44444444-4444-4444-8444-44444444c001',
     'Bienvenidos', 'Empieza la temporada')
  returning id into v_ann_id;
  reset role;
  if v_ann_id is null then
    raise exception 'FAIL [T5]: admin no pudo crear club-wide';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T6: entrenador_principal del club NO puede crear club-wide
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c002","role":"authenticated"}';
  begin
    insert into public.announcements (team_id, club_id, author_profile_id, title, body) values
      (null,
       '11111111-1111-4111-8111-11111111c001',
       '44444444-4444-4444-8444-44444444c002',
       't', 'b');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [T6]: entrenador_principal del club pudo crear club-wide';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T7: trigger same_club — anuncio con team_id de otro club → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444c001","role":"authenticated"}';
  begin
    insert into public.announcements (team_id, club_id, author_profile_id, title, body) values
      ('33333333-3333-4333-8333-33333333c003', -- team del club B
       '11111111-1111-4111-8111-11111111c001', -- club_id del club A
       '44444444-4444-4444-8444-44444444c001',
       't', 'b');
  exception when check_violation then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [T7]: trigger same_club no bloqueó cross-club';
  end if;
end $$;

rollback;

select 'OK rls_messaging_team_staff_regression' as result;
