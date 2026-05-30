-- F2.6 hotfix 2026-05-30 — tests del policy `invitations_delete_managers`.
--
-- Cobertura (6 casos, según spec):
--   D1. admin_club borra invitación de su club → OK.
--   D2. coordinador borra invitación de su club → OK.
--   D3. entrenador_principal del team borra invitación con ese team_id → OK.
--   D4. inviter (created_by = auth.uid()) borra su propia invitación → OK.
--   D5. jugador NO puede borrar invitaciones del club → rechazado por RLS.
--   D6. admin_club de OTRO club NO puede borrar (aislamiento multi-tenant) → rechazado.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup: dos clubs (A y B), un team en A, y usuarios con distintos roles.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('11abcdef-d000-0000-0000-000000000a01', 'Club A Del', 'club-a-del'),
  ('11abcdef-d000-0000-0000-000000000b01', 'Club B Del', 'club-b-del');

insert into public.categories (id, club_id, name, season) values
  ('22abcdef-d000-0000-0000-000000000a01', '11abcdef-d000-0000-0000-000000000a01', 'Cat A', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('33abcdef-d000-0000-0000-000000000a01', '22abcdef-d000-0000-0000-000000000a01', 'Team A', 'F7', '#10B981');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44abcdef-d000-0000-0000-000000000a01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@del.test', now(), '{}'::jsonb, now(), now()),
  ('44abcdef-d000-0000-0000-000000000a02', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-a@del.test', now(), '{}'::jsonb, now(), now()),
  ('44abcdef-d000-0000-0000-000000000a03', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-a@del.test', now(), '{}'::jsonb, now(), now()),
  ('44abcdef-d000-0000-0000-000000000a04', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inviter-a@del.test', now(), '{}'::jsonb, now(), now()),
  ('44abcdef-d000-0000-0000-000000000a05', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-a@del.test', now(), '{}'::jsonb, now(), now()),
  ('44abcdef-d000-0000-0000-000000000b01', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@del.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55abcdef-d000-0000-0000-000000000a01', '44abcdef-d000-0000-0000-000000000a01', '11abcdef-d000-0000-0000-000000000a01', 'admin_club'),
  ('55abcdef-d000-0000-0000-000000000a02', '44abcdef-d000-0000-0000-000000000a02', '11abcdef-d000-0000-0000-000000000a01', 'coordinador'),
  ('55abcdef-d000-0000-0000-000000000a03', '44abcdef-d000-0000-0000-000000000a03', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_principal'),
  -- inviter es un coordinador segundo (mismo club). Distinto del coord principal D2.
  ('55abcdef-d000-0000-0000-000000000a04', '44abcdef-d000-0000-0000-000000000a04', '11abcdef-d000-0000-0000-000000000a01', 'coordinador'),
  ('55abcdef-d000-0000-0000-000000000a05', '44abcdef-d000-0000-0000-000000000a05', '11abcdef-d000-0000-0000-000000000a01', 'jugador'),
  ('55abcdef-d000-0000-0000-000000000b01', '44abcdef-d000-0000-0000-000000000b01', '11abcdef-d000-0000-0000-000000000b01', 'admin_club');

-- Vínculo team_staff: principal-a es entrenador_principal del Team A.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33abcdef-d000-0000-0000-000000000a01', '55abcdef-d000-0000-0000-000000000a03', 'entrenador_principal');

-- 4 invitaciones distintas (una por test que borra OK + 2 que comparten para D5/D6).
-- created_by varía para cubrir el caso "inviter".
insert into public.invitations (id, token, email, club_id, role, team_id, expires_at, created_by) values
  -- D1: la borra el admin del club.
  ('a0d00001-0000-0000-0000-000000000001', gen_random_uuid(),
   'invitee1@del.test', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_ayudante',
   null, now() + interval '7 days', '44abcdef-d000-0000-0000-000000000a01'),
  -- D2: la borra el coordinador del club.
  ('a0d00002-0000-0000-0000-000000000002', gen_random_uuid(),
   'invitee2@del.test', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_ayudante',
   null, now() + interval '7 days', '44abcdef-d000-0000-0000-000000000a01'),
  -- D3: invitación a Team A — la borra el principal del team.
  ('a0d00003-0000-0000-0000-000000000003', gen_random_uuid(),
   'invitee3@del.test', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_ayudante',
   '33abcdef-d000-0000-0000-000000000a01', now() + interval '7 days',
   '44abcdef-d000-0000-0000-000000000a01'),
  -- D4: la borra el inviter (created_by = inviter-a).
  ('a0d00004-0000-0000-0000-000000000004', gen_random_uuid(),
   'invitee4@del.test', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_ayudante',
   null, now() + interval '7 days', '44abcdef-d000-0000-0000-000000000a04'),
  -- D5 / D6: víctimas que NO deben poder borrarse desde el contexto equivocado.
  ('a0d00005-0000-0000-0000-000000000005', gen_random_uuid(),
   'invitee5@del.test', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_ayudante',
   null, now() + interval '7 days', '44abcdef-d000-0000-0000-000000000a01'),
  ('a0d00006-0000-0000-0000-000000000006', gen_random_uuid(),
   'invitee6@del.test', '11abcdef-d000-0000-0000-000000000a01', 'entrenador_ayudante',
   null, now() + interval '7 days', '44abcdef-d000-0000-0000-000000000a01');

-- ─────────────────────────────────────────────────────────────────────────────
-- D1: admin_club del club borra → debe quedar 0 filas en la inv 001.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_remaining int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44abcdef-d000-0000-0000-000000000a01","role":"authenticated"}';
  delete from public.invitations where id = 'a0d00001-0000-0000-0000-000000000001';
  reset role;
  select count(*) into v_remaining from public.invitations where id = 'a0d00001-0000-0000-0000-000000000001';
  if v_remaining <> 0 then
    raise exception 'FAIL [D1]: admin_club no pudo borrar (quedaron % filas)', v_remaining;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2: coordinador del club borra inv 002.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_remaining int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44abcdef-d000-0000-0000-000000000a02","role":"authenticated"}';
  delete from public.invitations where id = 'a0d00002-0000-0000-0000-000000000002';
  reset role;
  select count(*) into v_remaining from public.invitations where id = 'a0d00002-0000-0000-0000-000000000002';
  if v_remaining <> 0 then
    raise exception 'FAIL [D2]: coordinador no pudo borrar (quedaron % filas)', v_remaining;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D3: entrenador_principal del team borra inv 003 (con team_id apuntando a su team).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_remaining int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44abcdef-d000-0000-0000-000000000a03","role":"authenticated"}';
  delete from public.invitations where id = 'a0d00003-0000-0000-0000-000000000003';
  reset role;
  select count(*) into v_remaining from public.invitations where id = 'a0d00003-0000-0000-0000-000000000003';
  if v_remaining <> 0 then
    raise exception 'FAIL [D3]: entrenador_principal del team no pudo borrar (quedaron % filas)', v_remaining;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D4: inviter (created_by = auth.uid()) borra inv 004.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_remaining int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44abcdef-d000-0000-0000-000000000a04","role":"authenticated"}';
  delete from public.invitations where id = 'a0d00004-0000-0000-0000-000000000004';
  reset role;
  select count(*) into v_remaining from public.invitations where id = 'a0d00004-0000-0000-0000-000000000004';
  if v_remaining <> 0 then
    raise exception 'FAIL [D4]: inviter no pudo borrar su propia invitación (quedaron % filas)', v_remaining;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D5: jugador del club NO puede borrar inv 005 (rol sin permiso).
--     Bajo RLS, el DELETE no lanza error sino que pasa por el filtro USING y
--     no afecta ninguna fila — count debe seguir siendo 1.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_remaining int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44abcdef-d000-0000-0000-000000000a05","role":"authenticated"}';
  delete from public.invitations where id = 'a0d00005-0000-0000-0000-000000000005';
  reset role;
  select count(*) into v_remaining from public.invitations where id = 'a0d00005-0000-0000-0000-000000000005';
  if v_remaining <> 1 then
    raise exception 'FAIL [D5]: jugador pudo borrar (quedaron % filas, esperaba 1)', v_remaining;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D6: admin de OTRO club NO puede borrar inv 006 (aislamiento multi-tenant).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_remaining int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44abcdef-d000-0000-0000-000000000b01","role":"authenticated"}';
  delete from public.invitations where id = 'a0d00006-0000-0000-0000-000000000006';
  reset role;
  select count(*) into v_remaining from public.invitations where id = 'a0d00006-0000-0000-0000-000000000006';
  if v_remaining <> 1 then
    raise exception 'FAIL [D6]: admin de OTRO club pudo borrar (quedaron % filas, esperaba 1)', v_remaining;
  end if;
end $$;

rollback;

select 'OK rls_invitations_delete' as result;
