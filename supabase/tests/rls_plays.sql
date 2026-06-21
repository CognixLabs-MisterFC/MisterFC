-- Tests F13.1b — RLS, autoridad y trigger de PLAYS (playbook del equipo)
-- (migración 20260723000000_plays.sql).
--
-- Cubre: INSERT (autoridad: ayudante con/sin capability can_create_plays,
-- principal vía team_staff, coord, jugador, club ajeno, principal de OTRO team
-- del mismo club; owner forzado a auth.uid); trigger (club derivado del team,
-- forma ligera del jsonb, inmutabilidad owner/club/team); SELECT por rol y por
-- visibility staff|team con scope TEAM (staff del equipo vs staff de otro equipo
-- vs jugador/familia del team vs club ajeno); UPDATE/DELETE (autor∪admin/coord).
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
--
-- Mapa de IDs (último segmento, HEX):
--   users club A: admin a, coord b, principalA c, ayud(cap) d, ayud(sin cap) e,
--                 principalA2 7, jugadorA f, jugadorA2 9; club B: adminB ...0a.

begin;

insert into public.clubs (id, name, slug) values
  ('b1c00000-0000-4000-8000-000000000001', 'Club Play A', 'club-play-a'),
  ('b1c00000-0000-4000-8000-000000000002', 'Club Play B', 'club-play-b');

insert into public.categories (id, club_id, name) values
  ('b1ca0000-0000-4000-8000-000000000001', 'b1c00000-0000-4000-8000-000000000001', 'Cat A'),
  ('b1ca0000-0000-4000-8000-000000000002', 'b1c00000-0000-4000-8000-000000000001', 'Cat A2');

insert into public.teams (id, category_id, name, format, color, season) values
  ('b1700000-0000-4000-8000-000000000001', 'b1ca0000-0000-4000-8000-000000000001', 'Team A',  'F11', '#10B981', '2025-26'),
  ('b1700000-0000-4000-8000-000000000002', 'b1ca0000-0000-4000-8000-000000000002', 'Team A2', 'F11', '#0EA5E9', '2025-26');

-- jugadorA en Team A (vinculado a f); jugadorA2 en Team A2 (vinculado a 9).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('b1500000-0000-4000-8000-00000000000f', 'b1c00000-0000-4000-8000-000000000001', 'Fede', 'Team', '2012-01-01'),
  ('b1500000-0000-4000-8000-000000000009', 'b1c00000-0000-4000-8000-000000000001', 'Gael', 'Otro', '2012-01-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('b1700000-0000-4000-8000-000000000001', 'b1500000-0000-4000-8000-00000000000f', '2025-09-01'),
  ('b1700000-0000-4000-8000-000000000002', 'b1500000-0000-4000-8000-000000000009', '2025-09-01');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('b1a00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@play.test',     now(), '{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord@play.test',     now(), '{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principalA@play.test', now(), '{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayud-cap@play.test',  now(), '{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayud-nocap@play.test',now(), '{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principalA2@play.test',now(),'{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugA@play.test',      now(), '{}'::jsonb, now(), now()),
  ('b1a00000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugA2@play.test',     now(), '{}'::jsonb, now(), now()),
  ('b1b00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminB@play.test',    now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('b1550000-0000-4000-8000-00000000000a', 'b1a00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000001', 'admin_club'),
  ('b1550000-0000-4000-8000-00000000000b', 'b1a00000-0000-4000-8000-00000000000b', 'b1c00000-0000-4000-8000-000000000001', 'coordinador'),
  ('b1550000-0000-4000-8000-00000000000c', 'b1a00000-0000-4000-8000-00000000000c', 'b1c00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('b1550000-0000-4000-8000-00000000000d', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('b1550000-0000-4000-8000-00000000000e', 'b1a00000-0000-4000-8000-00000000000e', 'b1c00000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('b1550000-0000-4000-8000-000000000007', 'b1a00000-0000-4000-8000-000000000007', 'b1c00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('b1550000-0000-4000-8000-00000000000f', 'b1a00000-0000-4000-8000-00000000000f', 'b1c00000-0000-4000-8000-000000000001', 'jugador'),
  ('b1550000-0000-4000-8000-000000000009', 'b1a00000-0000-4000-8000-000000000009', 'b1c00000-0000-4000-8000-000000000001', 'jugador'),
  ('b1b50000-0000-4000-8000-0000000000ba', 'b1b00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000002', 'admin_club');

-- team_staff: principal c + ayudantes d,e en Team A; principal 7 en Team A2.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('b1700000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000c', 'entrenador_principal'),
  ('b1700000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000d', 'entrenador_ayudante'),
  ('b1700000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000e', 'entrenador_ayudante'),
  ('b1700000-0000-4000-8000-000000000002', 'b1550000-0000-4000-8000-000000000007', 'entrenador_principal');

-- jugadorA ↔ f (Team A); jugadorA2 ↔ 9 (Team A2).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('b1500000-0000-4000-8000-00000000000f', 'b1a00000-0000-4000-8000-00000000000f', 'self'),
  ('b1500000-0000-4000-8000-000000000009', 'b1a00000-0000-4000-8000-000000000009', 'self');

-- ── H1: el trigger sembró can_create_plays para los ayudantes ─────────────────
do $$
declare n int;
begin
  select count(*) into n from public.capabilities
   where membership_id = 'b1550000-0000-4000-8000-00000000000d'
     and capability_name = 'can_create_plays';
  if n <> 1 then raise exception 'FAIL [H1]: el ayudante no tiene fila can_create_plays'; end if;
end $$;

-- ayudante d: capability concedida; ayudante e: sin capability.
update public.capabilities set granted = true
  where membership_id = 'b1550000-0000-4000-8000-00000000000d' and capability_name = 'can_create_plays';
update public.capabilities set granted = false
  where membership_id = 'b1550000-0000-4000-8000-00000000000e' and capability_name = 'can_create_plays';

-- jsonb de jugada válido (1 frame vacío) reutilizable.
-- (contrato core 13.1a: { version, field, frames[] })

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT / autoridad
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- I1: ayudante CON capability crea jugada en Team A → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.plays (id, owner_profile_id, club_id, team_id, name, play)
  values ('b1e00000-0000-4000-8000-000000000001', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
          'Jugada 1', '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
exception when others then
  raise exception 'FAIL [I1]: ayudante con cap no pudo crear jugada: %', sqlerrm;
end $$;

-- I2: ayudante SIN capability crea → RLS lo rechaza
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000e","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, team_id, play)
    values ('b1a00000-0000-4000-8000-00000000000e', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
            '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I2]: ayudante sin cap pudo insertar'; end if;
end $$;

-- I3: principal (vía team_staff de Team A) crea → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.plays (owner_profile_id, club_id, team_id, play)
  values ('b1a00000-0000-4000-8000-00000000000c', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
          '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
exception when others then
  raise exception 'FAIL [I3]: principal no pudo crear: %', sqlerrm;
end $$;

-- I4: coord crea → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  insert into public.plays (owner_profile_id, club_id, team_id, play)
  values ('b1a00000-0000-4000-8000-00000000000b', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
          '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
exception when others then
  raise exception 'FAIL [I4]: coord no pudo crear: %', sqlerrm;
end $$;

-- I5: jugador crea → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, team_id, play)
    values ('b1a00000-0000-4000-8000-00000000000f', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
            '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I5]: jugador pudo insertar'; end if;
end $$;

-- I6: admin de club B inserta en Team A (club A) → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1b00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, team_id, play)
    values ('b1b00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
            '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I6]: admin ajeno pudo insertar en club A'; end if;
end $$;

-- I7: principal de Team A2 NO puede crear en Team A (autoridad team-scoped) → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-000000000007","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, team_id, play)
    values ('b1a00000-0000-4000-8000-000000000007', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
            '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I7]: principal de otro team creó jugada en Team A'; end if;
end $$;

-- I8: ese mismo principal SÍ crea en su Team A2 → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-000000000007","role":"authenticated"}';
  insert into public.plays (owner_profile_id, club_id, team_id, play)
  values ('b1a00000-0000-4000-8000-000000000007', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000002',
          '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
exception when others then
  raise exception 'FAIL [I8]: principal A2 no pudo crear en su team: %', sqlerrm;
end $$;

-- I9: owner forzado a auth.uid — d inserta con owner = e → la fila queda con owner d
do $$
declare v_owner uuid;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.plays (id, owner_profile_id, club_id, team_id, play)
  values ('b1e00000-0000-4000-8000-0000000000aa', 'b1a00000-0000-4000-8000-00000000000e', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
          '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
  select owner_profile_id into v_owner from public.plays where id = 'b1e00000-0000-4000-8000-0000000000aa';
  if v_owner <> 'b1a00000-0000-4000-8000-00000000000d' then
    raise exception 'FAIL [I9]: owner no se forzó a auth.uid (quedó %)', v_owner;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: derivación de club_id + forma ligera del jsonb + inmutables
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';

-- T1: club_id derivado del team (pasamos club B a propósito → debe quedar club A)
do $$
declare v_club uuid;
begin
  insert into public.plays (id, owner_profile_id, club_id, team_id, play)
  values ('b1e00000-0000-4000-8000-0000000000d1', 'b1a00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000002', 'b1700000-0000-4000-8000-000000000001',
          '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
  select club_id into v_club from public.plays where id = 'b1e00000-0000-4000-8000-0000000000d1';
  if v_club <> 'b1c00000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [T1]: club_id no se derivó del team (quedó %)', v_club;
  end if;
end $$;

-- T2: play no-objeto → check_violation
do $$
declare ok boolean := false;
begin
  begin
    insert into public.plays (owner_profile_id, club_id, team_id, play)
    values ('b1a00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001', '[]'::jsonb);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [T2]: play no-objeto no fue rechazado'; end if;
end $$;

-- T3: frames vacío → check_violation
do $$
declare ok boolean := false;
begin
  begin
    insert into public.plays (owner_profile_id, club_id, team_id, play)
    values ('b1a00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001',
            '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[]}'::jsonb);
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [T3]: frames vacío no fue rechazado'; end if;
end $$;

reset role;

-- ── Semilla de jugadas para SELECT (trigger off para fijar owner/visib./team) ──
-- c1 = Team A staff · c2 = Team A team · c3 = Team A2 staff.
alter table public.plays disable trigger trg_plays_validate;
insert into public.plays (id, owner_profile_id, club_id, team_id, visibility, play) values
  ('b1e00000-0000-4000-8000-0000000000c1', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001', 'staff',
   '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb),
  ('b1e00000-0000-4000-8000-0000000000c2', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000001', 'team',
   '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb),
  ('b1e00000-0000-4000-8000-0000000000c3', 'b1a00000-0000-4000-8000-000000000007', 'b1c00000-0000-4000-8000-000000000001', 'b1700000-0000-4000-8000-000000000002', 'staff',
   '{"version":1,"field":{"kind":"completo","orientation":"vertical"},"frames":[{"elements":[]}]}'::jsonb);
alter table public.plays enable trigger trg_plays_validate;

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT por rol / visibility / scope-team
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- S1: coord ve las 3 (todo el club).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.plays
   where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c2','b1e00000-0000-4000-8000-0000000000c3');
  if n <> 3 then raise exception 'FAIL [S1]: coord no ve las 3 jugadas (vio %)', n; end if;
end $$;

-- S2: principal de Team A ve c1+c2 (su team) pero NO c3 (Team A2).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select count(*) into n from public.plays where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c2');
  if n <> 2 then raise exception 'FAIL [S2a]: staff de Team A no ve sus 2 jugadas (vio %)', n; end if;
  select count(*) into n from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c3';
  if n <> 0 then raise exception 'FAIL [S2b]: staff de Team A ve jugada de Team A2'; end if;
end $$;

-- S3: ayudante SIN capability (staff de Team A) ve c1+c2 → SELECT no requiere crear.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000e","role":"authenticated"}';
  select count(*) into n from public.plays where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c2');
  if n <> 2 then raise exception 'FAIL [S3]: ayudante sin cap no ve las jugadas de su team (vio %)', n; end if;
end $$;

-- S4: jugador de Team A ve SOLO la jugada team (c2), no la staff (c1) ni c3.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c2';
  if n <> 1 then raise exception 'FAIL [S4a]: jugador del team no ve la jugada team'; end if;
  select count(*) into n from public.plays where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S4b]: jugador del team ve jugada staff/otro team'; end if;
end $$;

-- S5: jugador de Team A2 no ve la jugada team de Team A (cross-team) ni las staff.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-000000000009","role":"authenticated"}';
  select count(*) into n from public.plays
   where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c2','b1e00000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S5]: jugador de Team A2 ve jugadas que no le tocan (vio %)', n; end if;
end $$;

-- S6: principal de Team A2 ve c3 (su team), NO c1/c2 (Team A) → scope-team simétrico.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-000000000007","role":"authenticated"}';
  select count(*) into n from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c3';
  if n <> 1 then raise exception 'FAIL [S6a]: staff de Team A2 no ve su jugada'; end if;
  select count(*) into n from public.plays where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c2');
  if n <> 0 then raise exception 'FAIL [S6b]: staff de Team A2 ve jugadas de Team A'; end if;
end $$;

-- S7: admin de club B no ve nada de club A.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1b00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.plays
   where id in ('b1e00000-0000-4000-8000-0000000000c1','b1e00000-0000-4000-8000-0000000000c2','b1e00000-0000-4000-8000-0000000000c3');
  if n <> 0 then raise exception 'FAIL [S7]: admin ajeno ve jugadas de club A'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE / DELETE (autor ∪ admin/coord; inmutabilidad)
-- ─────────────────────────────────────────────────────────────────────────────

-- U1: owner (d) edita c1 → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.plays set name = 'Editada' where id = 'b1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U1]: owner no pudo editar su jugada'; end if;
end $$;

-- U2: admin (no owner) edita c1 → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.plays set name = 'Admin edit' where id = 'b1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U2]: admin no pudo editar jugada ajena'; end if;
end $$;

-- U3: coord (no owner) edita c1 → OK (spec: autor ∪ admin/coord)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  update public.plays set name = 'Coord edit' where id = 'b1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U3]: coord no pudo editar jugada del club'; end if;
end $$;

-- U4: principal de Team A (staff, no owner, no admin/coord) edita c1 → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.plays set name = 'hack' where id = 'b1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U4]: staff no-autor editó jugada ajena'; end if;
end $$;

-- U5: jugador del team NO edita la jugada team → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  update public.plays set name = 'hack jugador' where id = 'b1e00000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U5]: jugador editó la jugada team'; end if;
end $$;

-- U6: owner inmutable → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    update public.plays set owner_profile_id = 'b1a00000-0000-4000-8000-00000000000a'
     where id = 'b1e00000-0000-4000-8000-0000000000c2';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U6]: se pudo cambiar el owner'; end if;
end $$;

-- U7: team inmutable → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    update public.plays set team_id = 'b1700000-0000-4000-8000-000000000002'
     where id = 'b1e00000-0000-4000-8000-0000000000c2';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U7]: se pudo cambiar el team'; end if;
end $$;

-- D1: owner (d) borra c2 → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  delete from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D1]: owner no pudo borrar su jugada'; end if;
end $$;

-- D2: admin borra c3 (ajena) → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  delete from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D2]: admin no pudo borrar jugada ajena'; end if;
end $$;

-- D3: principal de Team A (no owner/admin/coord) borra c1 → 0 filas
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  delete from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [D3]: staff no-autor borró jugada ajena'; end if;
end $$;

-- D4: coord borra c1 → OK (autor ∪ admin/coord)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  delete from public.plays where id = 'b1e00000-0000-4000-8000-0000000000c1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D4]: coord no pudo borrar jugada del club'; end if;
end $$;

reset role;

rollback;
