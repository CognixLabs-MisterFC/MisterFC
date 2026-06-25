-- Tests F13.10a — RLS, autoridad y trigger de DEVELOPMENT_REPORTS + objetivos
-- (migración 20260727000000_development_reports.sql).
--
-- Cubre: INSERT (autoridad D13: admin/coord, principal y AYUDANTE del team OK;
-- jugador, club ajeno y principal de OTRO team rechazados; created_by forzado a
-- auth.uid); trigger (club derivado del team, inmutabilidad created_by/team/period);
-- SELECT por rol y por visibility staff|team con scope TEAM; UPDATE/DELETE (staff
-- del team ∪ admin/coord; jugador no); objetivos (la familia ve individuales y
-- grupales SOLO cuando hay un informe del curso compartido — gate D14).
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- IDs: prefijo d1 (no colisiona con rls_plays, que usa b1).

begin;

insert into public.clubs (id, name, slug) values
  ('d1c00000-0000-4000-8000-000000000001', 'Club DR A', 'club-dr-a'),
  ('d1c00000-0000-4000-8000-000000000002', 'Club DR B', 'club-dr-b');

insert into public.categories (id, club_id, name) values
  ('d1ca0000-0000-4000-8000-000000000001', 'd1c00000-0000-4000-8000-000000000001', 'Cat A'),
  ('d1ca0000-0000-4000-8000-000000000002', 'd1c00000-0000-4000-8000-000000000001', 'Cat A2');

insert into public.teams (id, category_id, name, format, color, season) values
  ('d1700000-0000-4000-8000-000000000001', 'd1ca0000-0000-4000-8000-000000000001', 'Team A',  'F11', '#10B981', '2025-26'),
  ('d1700000-0000-4000-8000-000000000002', 'd1ca0000-0000-4000-8000-000000000002', 'Team A2', 'F11', '#0EA5E9', '2025-26');

insert into public.seasons (id, club_id, label, status) values
  ('d15ea000-0000-4000-8000-000000000001', 'd1c00000-0000-4000-8000-000000000001', '2025-26', 'active');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('d1500000-0000-4000-8000-00000000000f', 'd1c00000-0000-4000-8000-000000000001', 'Fede', 'Team', '2012-01-01'),
  ('d1500000-0000-4000-8000-000000000009', 'd1c00000-0000-4000-8000-000000000001', 'Gael', 'Otro', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('d1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-00000000000f', '2025-09-01'),
  ('d1700000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000009', '2025-09-01');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('d1a00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@dr.test',      now(), '{}'::jsonb, now(), now()),
  ('d1a00000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord@dr.test',      now(), '{}'::jsonb, now(), now()),
  ('d1a00000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principalA@dr.test', now(), '{}'::jsonb, now(), now()),
  ('d1a00000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayudA@dr.test',      now(), '{}'::jsonb, now(), now()),
  ('d1a00000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principalA2@dr.test',now(), '{}'::jsonb, now(), now()),
  ('d1a00000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugA@dr.test',       now(), '{}'::jsonb, now(), now()),
  ('d1a00000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugA2@dr.test',      now(), '{}'::jsonb, now(), now()),
  ('d1b00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminB@dr.test',     now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('d1550000-0000-4000-8000-00000000000a', 'd1a00000-0000-4000-8000-00000000000a', 'd1c00000-0000-4000-8000-000000000001', 'admin_club'),
  ('d1550000-0000-4000-8000-00000000000b', 'd1a00000-0000-4000-8000-00000000000b', 'd1c00000-0000-4000-8000-000000000001', 'coordinador'),
  ('d1550000-0000-4000-8000-00000000000c', 'd1a00000-0000-4000-8000-00000000000c', 'd1c00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('d1550000-0000-4000-8000-00000000000d', 'd1a00000-0000-4000-8000-00000000000d', 'd1c00000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('d1550000-0000-4000-8000-000000000007', 'd1a00000-0000-4000-8000-000000000007', 'd1c00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('d1550000-0000-4000-8000-00000000000f', 'd1a00000-0000-4000-8000-00000000000f', 'd1c00000-0000-4000-8000-000000000001', 'jugador'),
  ('d1550000-0000-4000-8000-000000000009', 'd1a00000-0000-4000-8000-000000000009', 'd1c00000-0000-4000-8000-000000000001', 'jugador'),
  ('d1b50000-0000-4000-8000-0000000000ba', 'd1b00000-0000-4000-8000-00000000000a', 'd1c00000-0000-4000-8000-000000000002', 'admin_club');

-- team_staff: principal c + ayudante d en Team A; principal 7 en Team A2.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('d1700000-0000-4000-8000-000000000001', 'd1550000-0000-4000-8000-00000000000c', 'entrenador_principal'),
  ('d1700000-0000-4000-8000-000000000001', 'd1550000-0000-4000-8000-00000000000d', 'entrenador_ayudante'),
  ('d1700000-0000-4000-8000-000000000002', 'd1550000-0000-4000-8000-000000000007', 'entrenador_principal');

-- jugadorA ↔ f (Team A); jugadorA2 ↔ 9 (Team A2).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('d1500000-0000-4000-8000-00000000000f', 'd1a00000-0000-4000-8000-00000000000f', 'self'),
  ('d1500000-0000-4000-8000-000000000009', 'd1a00000-0000-4000-8000-000000000009', 'self');

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT / autoridad (D13: admin/coord + principal + AYUDANTE del team)
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- I1: AYUDANTE (team_staff de Team A, sin capability) crea informe → OK (D13)
do $$
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, created_by)
  values ('d1e00000-0000-4000-8000-000000000001', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
          'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'inicial',
          'd1a00000-0000-4000-8000-00000000000d');
exception when others then
  raise exception 'FAIL [I1]: ayudante no pudo crear informe: %', sqlerrm;
end $$;

-- I2: principal crea (otro periodo del mismo jugador) → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.development_reports (club_id, team_id, player_id, season_id, period, created_by)
  values ('d1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
          'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'diciembre',
          'd1a00000-0000-4000-8000-00000000000c');
exception when others then
  raise exception 'FAIL [I2]: principal no pudo crear: %', sqlerrm;
end $$;

-- I3: jugador crea → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.development_reports (club_id, team_id, player_id, season_id, period, created_by)
    values ('d1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
            'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'marzo',
            'd1a00000-0000-4000-8000-00000000000f');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I3]: jugador pudo crear informe'; end if;
end $$;

-- I4: admin de club B crea en Team A (club A) → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1b00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.development_reports (club_id, team_id, player_id, season_id, period, created_by)
    values ('d1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
            'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'junio',
            'd1b00000-0000-4000-8000-00000000000a');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I4]: admin ajeno creó informe en club A'; end if;
end $$;

-- I5: principal de Team A2 NO puede crear en Team A (team-scoped) → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-000000000007","role":"authenticated"}';
  begin
    insert into public.development_reports (club_id, team_id, player_id, season_id, period, created_by)
    values ('d1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
            'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'junio',
            'd1a00000-0000-4000-8000-000000000007');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I5]: principal de otro team creó en Team A'; end if;
end $$;

-- I6: created_by forzado a auth.uid — d inserta con created_by = e → queda d
do $$
declare v_owner uuid;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, created_by)
  values ('d1e00000-0000-4000-8000-0000000000aa', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
          'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'marzo',
          'd1a00000-0000-4000-8000-000000000007');
  select created_by into v_owner from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000aa';
  if v_owner <> 'd1a00000-0000-4000-8000-00000000000d' then
    raise exception 'FAIL [I6]: created_by no se forzó a auth.uid (quedó %)', v_owner;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: club_id derivado + inmutables
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- T1: club_id derivado del team (pasamos club B a propósito → debe quedar club A)
do $$
declare v_club uuid;
begin
  insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, created_by)
  values ('d1e00000-0000-4000-8000-0000000000d1', 'd1c00000-0000-4000-8000-000000000002', 'd1700000-0000-4000-8000-000000000001',
          'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'junio',
          'd1a00000-0000-4000-8000-00000000000a');
  select club_id into v_club from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000d1';
  if v_club <> 'd1c00000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [T1]: club_id no se derivó del team (quedó %)', v_club;
  end if;
end $$;

-- T2: period inmutable → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  begin
    update public.development_reports set period = 'inicial' where id = 'd1e00000-0000-4000-8000-0000000000d1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [T2]: se pudo cambiar el period'; end if;
end $$;

reset role;

-- ── Semilla para SELECT/objetivos (trigger off para fijar visibility/team) ──────
-- r_staff = Team A staff · r_team = Team A team (player f) · r_a2 = Team A2 staff (player 9).
alter table public.development_reports disable trigger trg_development_reports_validate;
delete from public.development_reports;  -- limpia los insertados arriba para fijar el set
insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, visibility, created_by) values
  ('d1e00000-0000-4000-8000-0000000000c1', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'inicial',   'staff', 'd1a00000-0000-4000-8000-00000000000d'),
  ('d1e00000-0000-4000-8000-0000000000c2', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'diciembre', 'team',  'd1a00000-0000-4000-8000-00000000000d'),
  ('d1e00000-0000-4000-8000-0000000000c3', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000009', 'd15ea000-0000-4000-8000-000000000001', 'inicial',   'staff', 'd1a00000-0000-4000-8000-000000000007');
alter table public.development_reports enable trigger trg_development_reports_validate;

-- objetivos: po_f (player f, Team A) · to_a (Team A) · po_9 (player 9, Team A2, SIN informe compartido) · to_a2 (Team A2, SIN compartir)
insert into public.player_objectives (id, club_id, team_id, player_id, season_id, title, status, created_period) values
  ('d10b0000-0000-4000-8000-0000000000f1', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'Mejorar el pase', 'open', 'inicial'),
  ('d10b0000-0000-4000-8000-000000000091', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000002', 'd1500000-0000-4000-8000-000000000009', 'd15ea000-0000-4000-8000-000000000001', 'Objetivo A2',     'open', 'inicial');
insert into public.team_objectives (id, club_id, team_id, season_id, title, status) values
  ('d10c0000-0000-4000-8000-0000000000a1', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd15ea000-0000-4000-8000-000000000001', 'Salida de balón', 'open'),
  ('d10c0000-0000-4000-8000-0000000000a2', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000002', 'd15ea000-0000-4000-8000-000000000001', 'Objetivo grupo A2', 'open');

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT por rol / visibility / scope-team
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- S1: coord ve los 3 informes (todo el club).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.development_reports
   where id in ('d1e00000-0000-4000-8000-0000000000c1','d1e00000-0000-4000-8000-0000000000c2','d1e00000-0000-4000-8000-0000000000c3');
  if n <> 3 then raise exception 'FAIL [S1]: coord no ve los 3 informes (vio %)', n; end if;
end $$;

-- S2: principal de Team A ve r_staff+r_team (su team), NO r_a2.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select count(*) into n from public.development_reports where id in ('d1e00000-0000-4000-8000-0000000000c1','d1e00000-0000-4000-8000-0000000000c2');
  if n <> 2 then raise exception 'FAIL [S2a]: staff Team A no ve sus 2 informes (vio %)', n; end if;
  select count(*) into n from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000c3';
  if n <> 0 then raise exception 'FAIL [S2b]: staff Team A ve informe de Team A2'; end if;
end $$;

-- S3: jugador de Team A ve SOLO el informe team (r_team), no el staff.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FAIL [S3a]: jugador no ve su informe compartido'; end if;
  select count(*) into n from public.development_reports where id in ('d1e00000-0000-4000-8000-0000000000c1','d1e00000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S3b]: jugador ve informe staff/otro team'; end if;
end $$;

-- S4: jugador de Team A2 no ve nada de Team A.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-000000000009","role":"authenticated"}';
  select count(*) into n from public.development_reports
   where id in ('d1e00000-0000-4000-8000-0000000000c1','d1e00000-0000-4000-8000-0000000000c2');
  if n <> 0 then raise exception 'FAIL [S4]: jugador de Team A2 ve informes de Team A'; end if;
end $$;

-- S5: admin de club B no ve nada de club A.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1b00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.development_reports
   where id in ('d1e00000-0000-4000-8000-0000000000c1','d1e00000-0000-4000-8000-0000000000c2','d1e00000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S5]: admin ajeno ve informes de club A'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Objetivos: gate de la familia (D14) — ven SOLO si hay informe del curso compartido
-- ─────────────────────────────────────────────────────────────────────────────

-- O1: jugador f ve su objetivo individual (hay r_team compartido para f).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.player_objectives where id = 'd10b0000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL [O1]: jugador no ve su objetivo con informe compartido'; end if;
end $$;

-- O2: jugador f ve el objetivo grupal de Team A (hay informe del team compartido).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.team_objectives where id = 'd10c0000-0000-4000-8000-0000000000a1';
  if n <> 1 then raise exception 'FAIL [O2]: jugador no ve el objetivo grupal con informe compartido'; end if;
end $$;

-- O3: jugador 9 (Team A2) NO ve su objetivo: no hay informe compartido de A2 (gate).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-000000000009","role":"authenticated"}';
  select count(*) into n from public.player_objectives where id = 'd10b0000-0000-4000-8000-000000000091';
  if n <> 0 then raise exception 'FAIL [O3]: jugador A2 ve su objetivo SIN informe compartido (gate roto)'; end if;
  select count(*) into n from public.team_objectives where id = 'd10c0000-0000-4000-8000-0000000000a2';
  if n <> 0 then raise exception 'FAIL [O3b]: jugador A2 ve objetivo grupal SIN informe compartido'; end if;
end $$;

-- O4: staff (principal A) ve los objetivos de su team (sin gate).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select count(*) into n from public.player_objectives where id = 'd10b0000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL [O4a]: staff no ve objetivo individual de su team'; end if;
  select count(*) into n from public.team_objectives where id = 'd10c0000-0000-4000-8000-0000000000a1';
  if n <> 1 then raise exception 'FAIL [O4b]: staff no ve objetivo grupal de su team'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE / DELETE (staff del team ∪ admin/coord; jugador no)
-- ─────────────────────────────────────────────────────────────────────────────

-- U1: ayudante (staff de Team A) edita r_staff → OK (CRUD de staff del team)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.development_reports set comment_overall = 'edit ok' where id = 'd1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U1]: staff del team no pudo editar informe'; end if;
end $$;

-- U2: jugador del team NO edita el informe team → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  update public.development_reports set comment_overall = 'hack' where id = 'd1e00000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U2]: jugador editó el informe team'; end if;
end $$;

-- O-W: jugador NO puede crear objetivo → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.player_objectives (club_id, team_id, player_id, season_id, title, created_period)
    values ('d1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'hack', 'inicial');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [O-W]: jugador pudo crear objetivo'; end if;
end $$;

-- D1: principal de Team A borra r_a2? No (otro team) → 0; borra r_staff → 1
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  delete from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000c3';  -- Team A2
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [D1a]: staff de Team A borró informe de Team A2'; end if;
  delete from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000c1';  -- su team
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D1b]: staff del team no pudo borrar su informe'; end if;
end $$;

-- D2: jugador NO borra el informe team → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  delete from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [D2]: jugador borró el informe team'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- VALORACIÓN DE EQUIPO (team_development_reports) + ENLACE team_report_id
-- ─────────────────────────────────────────────────────────────────────────────

-- TR1: AYUDANTE (staff Team A) crea valoración de equipo → OK (D13)
do $$
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.team_development_reports (id, club_id, team_id, season_id, period, created_by)
  values ('d1f00000-0000-4000-8000-000000000001', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd15ea000-0000-4000-8000-000000000001', 'marzo', 'd1a00000-0000-4000-8000-00000000000d');
exception when others then
  raise exception 'FAIL [TR1]: ayudante no pudo crear valoración de equipo: %', sqlerrm;
end $$;

-- TR2: jugador crea valoración de equipo → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.team_development_reports (club_id, team_id, season_id, period, created_by)
    values ('d1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd15ea000-0000-4000-8000-000000000001', 'junio', 'd1a00000-0000-4000-8000-00000000000f');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [TR2]: jugador pudo crear valoración de equipo'; end if;
end $$;

-- TR3: backfill — al crear la valoración de equipo de 'diciembre', el informe
-- individual c2 (player f, diciembre) enlaza su team_report_id (trigger AFTER INSERT).
do $$
declare v_link uuid;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  insert into public.team_development_reports (id, club_id, team_id, season_id, period, created_by)
  values ('d1f00000-0000-4000-8000-000000000002', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd15ea000-0000-4000-8000-000000000001', 'diciembre', 'd1a00000-0000-4000-8000-00000000000a');
  select team_report_id into v_link from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000c2';
  if v_link is distinct from 'd1f00000-0000-4000-8000-000000000002' then
    raise exception 'FAIL [TR3]: backfill no enlazó team_report_id (quedó %)', v_link;
  end if;
end $$;

-- TR4: al INSERTAR un informe individual cuando ya existe la valoración de equipo
-- de ese periodo ('inicial'), el trigger del individual enlaza team_report_id.
do $$
declare v_link uuid;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  insert into public.team_development_reports (id, club_id, team_id, season_id, period, visibility, created_by)
  values ('d1f00000-0000-4000-8000-000000000003', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd15ea000-0000-4000-8000-000000000001', 'inicial', 'team', 'd1a00000-0000-4000-8000-00000000000a');
  insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, created_by)
  values ('d1e00000-0000-4000-8000-0000000000e1', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'inicial', 'd1a00000-0000-4000-8000-00000000000a');
  select team_report_id into v_link from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000e1';
  if v_link is distinct from 'd1f00000-0000-4000-8000-000000000003' then
    raise exception 'FAIL [TR4]: el individual no enlazó la valoración de equipo (quedó %)', v_link;
  end if;
end $$;

-- TR5: visibility — jugador de Team A ve la valoración de equipo 'inicial' (team)
-- pero NO la de 'marzo' (staff).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.team_development_reports where id = 'd1f00000-0000-4000-8000-000000000003';
  if n <> 1 then raise exception 'FAIL [TR5a]: jugador no ve la valoración de equipo compartida'; end if;
  select count(*) into n from public.team_development_reports where id = 'd1f00000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [TR5b]: jugador ve valoración de equipo staff'; end if;
end $$;

-- TR6: admin de club B no ve valoraciones de equipo de club A.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1b00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.team_development_reports where team_id = 'd1700000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [TR6]: admin ajeno ve valoraciones de equipo de club A'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F13.10d — Compartir: SELECT scope-JUGADOR (no team-wide) + bloque de equipo
-- visible para la familia vía informe individual publicado (helper).
-- ─────────────────────────────────────────────────────────────────────────────
reset role;  -- fixtures nuevos como owner (sin RLS)

-- jugador B en Team A, con cuenta familiar jugB (misma familia-tier que jugA, otro jugador)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('d1a00000-0000-4000-8000-0000000000eb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugB@dr.test', now(), '{}'::jsonb, now(), now());
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('d1500000-0000-4000-8000-0000000000eb', 'd1c00000-0000-4000-8000-000000000001', 'Bruno', 'B', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('d1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-0000000000eb', '2025-09-01');
insert into public.memberships (id, profile_id, club_id, role) values
  ('d1550000-0000-4000-8000-0000000000eb', 'd1a00000-0000-4000-8000-0000000000eb', 'd1c00000-0000-4000-8000-000000000001', 'jugador');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('d1500000-0000-4000-8000-0000000000eb', 'd1a00000-0000-4000-8000-0000000000eb', 'self');

-- informe publicado (team) de B en Team A (trigger off para fijar visibility)
alter table public.development_reports disable trigger trg_development_reports_validate;
insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, visibility, created_by) values
  ('d1e00000-0000-4000-8000-0000000000eb', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001', 'd1500000-0000-4000-8000-0000000000eb', 'd15ea000-0000-4000-8000-000000000001', 'junio', 'team', 'd1a00000-0000-4000-8000-00000000000d');
alter table public.development_reports enable trigger trg_development_reports_validate;
set local role authenticated;

-- SH1: jugA (familia de A) NO ve el informe publicado de B (estrechamiento scope-jugador).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000eb';
  if n <> 0 then raise exception 'FAIL [SH1]: familia de A ve informe publicado de OTRO jugador del equipo (sobre-exposición)'; end if;
end $$;

-- SH2: jugB (familia de B) SÍ ve su informe publicado.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-0000000000eb","role":"authenticated"}';
  select count(*) into n from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000eb';
  if n <> 1 then raise exception 'FAIL [SH2]: familia de B no ve su informe publicado'; end if;
end $$;

-- SH3-setup: publicamos un informe individual de A en 'marzo' (se enlaza a la
-- valoración de equipo de marzo d1f1, que es 'staff').
do $$
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.development_reports (id, club_id, team_id, player_id, season_id, period, visibility, created_by)
  values ('d1e00000-0000-4000-8000-0000000000ec', 'd1c00000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001',
          'd1500000-0000-4000-8000-00000000000f', 'd15ea000-0000-4000-8000-000000000001', 'marzo', 'team',
          'd1a00000-0000-4000-8000-00000000000d');
exception when others then raise exception 'FAIL [SH3-setup]: no se pudo crear informe marzo: %', sqlerrm;
end $$;

-- SH3: la familia de A ve la valoración de equipo (staff) de marzo SOLO por tener
-- su informe individual publicado y enlazado (helper user_can_see_team_report_via_published).
do $$
declare n int; v_link uuid;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  select team_report_id into v_link from public.development_reports where id = 'd1e00000-0000-4000-8000-0000000000ec';
  if v_link is distinct from 'd1f00000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [SH3-link]: el informe de marzo no se enlazó a la valoración de equipo (quedó %)', v_link;
  end if;
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.team_development_reports where id = 'd1f00000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [SH3]: la familia no ve la valoración de equipo enlazada a su informe publicado'; end if;
end $$;

-- SH4: jugB, sin informe publicado en marzo, NO ve la valoración de equipo de marzo.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-0000000000eb","role":"authenticated"}';
  select count(*) into n from public.team_development_reports where id = 'd1f00000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [SH4]: familia sin informe publicado ve la valoración de equipo (helper demasiado abierto)'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- F13.10h-1 — review_comment + created_period en team_objectives
-- ─────────────────────────────────────────────────────────────────────────────

-- H1: team_objectives.created_period backfillea a 'inicial' (insert seed sin valor)
do $$
declare v text;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select created_period into v from public.team_objectives where id = 'd10c0000-0000-4000-8000-0000000000a1';
  if v is distinct from 'inicial' then
    raise exception 'FAIL [H1]: created_period de team_objective no quedó en inicial (quedó %)', v;
  end if;
end $$;

-- H2: created_period inmutable en team_objectives (trigger lo bloquea)
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    update public.team_objectives set created_period = 'junio'
     where id = 'd10c0000-0000-4000-8000-0000000000a1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [H2]: se pudo cambiar created_period de un team_objective'; end if;
end $$;

-- H3: staff del team puede fijar review_comment en objetivo individual y grupal
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.player_objectives set review_comment = 'ha mejorado el pase'
   where id = 'd10b0000-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [H3a]: staff no pudo fijar review_comment individual'; end if;
  update public.team_objectives set review_comment = 'mejor salida de balón'
   where id = 'd10c0000-0000-4000-8000-0000000000a1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [H3b]: staff no pudo fijar review_comment grupal'; end if;
end $$;

-- H4: review_comment vacío ('') viola el check de longitud (1..2000)
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"d1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    update public.player_objectives set review_comment = ''
     where id = 'd10b0000-0000-4000-8000-0000000000f1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [H4]: se aceptó review_comment vacío'; end if;
end $$;

reset role;

rollback;
