-- Tests JR-0 (ADR-0019) — RLS, autoridad, trigger y ciclo de PLAYS como banco del
-- club, + tabla team_plays (selección por equipo). Migración 20260809000000.
--
-- Cubre: INSERT (autoridad club-scoped: ayudante con/sin capability, principal,
-- coord, jugador, club ajeno; owner forzado; no-aprobador no crea published;
-- aprobador sí); SELECT por estado (draft solo autor; proposed/rejected autor +
-- aprobador; published todo el staff); UPDATE (transiciones: proponer, publicar/
-- rechazar solo aprobador, rechazo exige motivo); DELETE (no publicadas); archivar;
-- team_plays (staff añade publicadas; no draft; staff de otro equipo no; familia
-- ve solo shared_with_family; toggle; borrar).
--
-- Aprobador de jugadas = admin_club ∪ coordinador (D1), distinto de ejercicios.
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).

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

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('b1700000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000c', 'entrenador_principal'),
  ('b1700000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000d', 'entrenador_ayudante'),
  ('b1700000-0000-4000-8000-000000000001', 'b1550000-0000-4000-8000-00000000000e', 'entrenador_ayudante'),
  ('b1700000-0000-4000-8000-000000000002', 'b1550000-0000-4000-8000-000000000007', 'entrenador_principal');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('b1500000-0000-4000-8000-00000000000f', 'b1a00000-0000-4000-8000-00000000000f', 'self'),
  ('b1500000-0000-4000-8000-000000000009', 'b1a00000-0000-4000-8000-000000000009', 'self');

-- can_create_plays: el ayudante D la tiene; el E no.
update public.capabilities set granted = true
 where membership_id = 'b1550000-0000-4000-8000-00000000000d' and capability_name = 'can_create_plays';
update public.capabilities set granted = false
 where membership_id = 'b1550000-0000-4000-8000-00000000000e' and capability_name = 'can_create_plays';

-- Play jsonb mínimo válido para el trigger (frames array 1..60).
-- '{"version":1,"field":{},"frames":[{"elements":[]}]}'

set local role authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT / autoridad (club-scoped)
-- ─────────────────────────────────────────────────────────────────────────────
-- I1: ayudante CON capability crea draft → OK
set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
do $$
begin
  insert into public.plays (id, owner_profile_id, club_id, name, play, status)
  values ('b1900000-0000-4000-8000-000000000001', 'b1a00000-0000-4000-8000-00000000000d',
          'b1c00000-0000-4000-8000-000000000001', 'Jugada D', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'draft');
exception when others then
  raise exception 'FAIL [I1]: ayudante con cap no pudo crear draft: %', sqlerrm;
end $$;

-- I2: ayudante SIN capability → RLS rechaza
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000e","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, name, play)
    values ('b1a00000-0000-4000-8000-00000000000e', 'b1c00000-0000-4000-8000-000000000001', 'No', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I2]: ayudante sin cap pudo insertar'; end if;
end $$;

-- I3: principal (vía team_staff) crea proposed → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.plays (owner_profile_id, club_id, name, play, status)
  values ('b1a00000-0000-4000-8000-00000000000c', 'b1c00000-0000-4000-8000-000000000001', 'Jugada C', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'proposed');
exception when others then
  raise exception 'FAIL [I3]: principal no pudo crear: %', sqlerrm;
end $$;

-- I4: coord crea draft → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  insert into public.plays (owner_profile_id, club_id, name, play)
  values ('b1a00000-0000-4000-8000-00000000000b', 'b1c00000-0000-4000-8000-000000000001', 'Jugada coord', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb);
exception when others then
  raise exception 'FAIL [I4]: coord no pudo crear: %', sqlerrm;
end $$;

-- I5: jugador → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, name, play)
    values ('b1a00000-0000-4000-8000-00000000000f', 'b1c00000-0000-4000-8000-000000000001', 'Jug', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I5]: jugador pudo insertar'; end if;
end $$;

-- I6: admin de club B inserta en club A → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1b00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, name, play)
    values ('b1b00000-0000-4000-8000-00000000000a', 'b1c00000-0000-4000-8000-000000000001', 'Cross', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I6]: admin ajeno pudo insertar en club A'; end if;
end $$;

-- I7: no-aprobador (principal) crea directo en published → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    insert into public.plays (owner_profile_id, club_id, name, play, status)
    values ('b1a00000-0000-4000-8000-00000000000c', 'b1c00000-0000-4000-8000-000000000001', 'Princ pub', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [I7]: principal pudo crear published'; end if;
end $$;

-- I8: aprobador coord crea directo en published → OK + auditoría sellada
do $$
declare v_by uuid; v_at timestamptz;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  insert into public.plays (id, owner_profile_id, club_id, name, play, status)
  values ('b1900000-0000-4000-8000-000000000008', 'b1a00000-0000-4000-8000-00000000000b',
          'b1c00000-0000-4000-8000-000000000001', 'Coord pub', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published');
  select approved_by, approved_at into v_by, v_at from public.plays where id = 'b1900000-0000-4000-8000-000000000008';
  if v_by <> 'b1a00000-0000-4000-8000-00000000000b' or v_at is null then
    raise exception 'FAIL [I8]: published por coord no selló approved_by/at';
  end if;
exception when check_violation then
  raise exception 'FAIL [I8]: coord (aprobador) no pudo crear published';
end $$;

-- I9: owner forzado a auth.uid()
do $$
declare v_owner uuid;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.plays (id, owner_profile_id, club_id, name, play)
  values ('b1900000-0000-4000-8000-000000000009', 'b1a00000-0000-4000-8000-00000000000a',  -- intenta poner admin como owner
          'b1c00000-0000-4000-8000-000000000001', 'Owner test', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb);
  select owner_profile_id into v_owner from public.plays where id = 'b1900000-0000-4000-8000-000000000009';
  if v_owner <> 'b1a00000-0000-4000-8000-00000000000d' then
    raise exception 'FAIL [I9]: owner no se forzó a auth.uid() (got=%)', v_owner;
  end if;
end $$;

reset role;

-- ── Semilla de filas en todos los estados (sin disparar el trigger) ───────────
alter table public.plays disable trigger trg_plays_validate;
insert into public.plays (id, owner_profile_id, club_id, name, play, status, rejection_reason) values
  ('b1900000-0000-4000-8000-0000000000d1', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'Draft seed',     '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'draft',     null),
  ('b1900000-0000-4000-8000-0000000000e2', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'Proposed seed',  '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'proposed',  null),
  ('b1900000-0000-4000-8000-0000000000b1', 'b1a00000-0000-4000-8000-00000000000c', 'b1c00000-0000-4000-8000-000000000001', 'Published seed', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published', null),
  ('b1900000-0000-4000-8000-0000000000f1', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'Rejected seed',  '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'rejected',  'faltan detalles'),
  ('b1900000-0000-4000-8000-0000000000c4', 'b1a00000-0000-4000-8000-00000000000d', 'b1c00000-0000-4000-8000-000000000001', 'U4 proposed',    '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'proposed',  null);
alter table public.plays enable trigger trg_plays_validate;

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT por estado / rol
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- S1: draft → solo el autor (D). coord NO lo ve.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';  -- coord
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000d1';
  if n <> 0 then raise exception 'FAIL [S1]: coord ve un draft ajeno'; end if;
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';  -- autor
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000d1';
  if n <> 1 then raise exception 'FAIL [S1]: el autor no ve su draft'; end if;
end $$;

-- S2: proposed → autor (D) + aprobador (coord). Otro ayudante (E) NO.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';  -- coord aprobador
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000e2';
  if n <> 1 then raise exception 'FAIL [S2]: aprobador (coord) no ve proposed'; end if;
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000e","role":"authenticated"}';  -- ayud sin cap
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000e2';
  if n <> 0 then raise exception 'FAIL [S2]: ayudante ajeno ve un proposed'; end if;
end $$;

-- S3: published → todo el staff (ayud-nocap E lo ve).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000e","role":"authenticated"}';
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000b1';
  if n <> 1 then raise exception 'FAIL [S3]: staff no ve una published'; end if;
end $$;

-- S4: rejected → autor (D) + aprobador (admin). Otro ayudante (E) NO.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';  -- admin aprobador
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL [S4]: aprobador (admin) no ve rejected'; end if;
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000e","role":"authenticated"}';
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000f1';
  if n <> 0 then raise exception 'FAIL [S4]: ayudante ajeno ve un rejected'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE / transiciones
-- ─────────────────────────────────────────────────────────────────────────────
-- U1: autor (D) propone su draft (draft→proposed) → OK
do $$
declare st text;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.plays set status = 'proposed' where id = 'b1900000-0000-4000-8000-0000000000d1';
  select status into st from public.plays where id = 'b1900000-0000-4000-8000-0000000000d1';
  if st <> 'proposed' then raise exception 'FAIL [U1]: autor no pudo proponer (st=%)', st; end if;
end $$;

-- U2: aprobador (coord) publica un proposed → OK + sella approved_by
do $$
declare st text; v_by uuid;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  update public.plays set status = 'published' where id = 'b1900000-0000-4000-8000-0000000000e2';
  select status, approved_by into st, v_by from public.plays where id = 'b1900000-0000-4000-8000-0000000000e2';
  if st <> 'published' or v_by <> 'b1a00000-0000-4000-8000-00000000000b' then
    raise exception 'FAIL [U2]: aprobador no publicó/selló (st=%, by=%)', st, v_by;
  end if;
end $$;

-- U3: aprobador rechaza SIN motivo → trigger lo bloquea; CON motivo → OK
do $$
declare ok boolean := false; st text;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    update public.plays set status = 'rejected' where id = 'b1900000-0000-4000-8000-0000000000d1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U3]: se rechazó sin motivo'; end if;
  update public.plays set status = 'rejected', rejection_reason = 'no procede'
   where id = 'b1900000-0000-4000-8000-0000000000d1';
  select status into st from public.plays where id = 'b1900000-0000-4000-8000-0000000000d1';
  if st <> 'rejected' then raise exception 'FAIL [U3]: no se pudo rechazar con motivo (st=%)', st; end if;
end $$;

-- U4: autor (no aprobador) intenta publicar su propio proposed (semilla c4) →
-- el trigger lo bloquea (transition_requires_approver)
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    update public.plays set status = 'published' where id = 'b1900000-0000-4000-8000-0000000000c4';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U4]: autor no-aprobador pudo publicar'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE
-- ─────────────────────────────────────────────────────────────────────────────
-- D1: autor borra una NO publicada (su proposed U4) → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  delete from public.plays where id = 'b1900000-0000-4000-8000-0000000000c4';
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000c4';
  if n <> 0 then raise exception 'FAIL [D1]: autor no pudo borrar su no-publicada'; end if;
end $$;

-- D2: el autor de una PUBLISHED (C) NO puede borrarla
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  delete from public.plays where id = 'b1900000-0000-4000-8000-0000000000b1';
  select count(*) into n from public.plays where id = 'b1900000-0000-4000-8000-0000000000b1';
  if n <> 1 then raise exception 'FAIL [D2]: se borró una published'; end if;
end $$;

-- D3: aprobador archiva una published → OK (archived_at sellado, sigue published)
do $$
declare a timestamptz;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  update public.plays set archived_at = now() where id = 'b1900000-0000-4000-8000-0000000000b1';
  select archived_at into a from public.plays where id = 'b1900000-0000-4000-8000-0000000000b1';
  if a is null then raise exception 'FAIL [D3]: aprobador no pudo archivar published'; end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- team_plays — selección por equipo (playbook)
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- TP1: staff del Team A (ayud D) añade una PUBLISHED al playbook → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  insert into public.team_plays (team_id, play_id)
  values ('b1700000-0000-4000-8000-000000000001', 'b1900000-0000-4000-8000-0000000000b1');
exception when others then
  raise exception 'FAIL [TP1]: staff no pudo añadir una published al playbook: %', sqlerrm;
end $$;

-- TP2: staff intenta añadir una NO publicada (draft b1900...0001) → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    insert into public.team_plays (team_id, play_id)
    values ('b1700000-0000-4000-8000-000000000001', 'b1900000-0000-4000-8000-000000000001');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [TP2]: se añadió una no-publicada al playbook'; end if;
end $$;

-- TP3: staff de OTRO equipo (principal A2, id 7) añade a Team A → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-000000000007","role":"authenticated"}';
  begin
    insert into public.team_plays (team_id, play_id)
    values ('b1700000-0000-4000-8000-000000000001', 'b1900000-0000-4000-8000-0000000000e2');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [TP3]: staff de otro equipo pudo añadir al Team A'; end if;
end $$;

-- TP4: familia (jugA f) NO ve la selección si shared_with_family=false;
--      tras togglear a true, SÍ la ve.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';  -- familia
  select count(*) into n from public.team_plays where team_id = 'b1700000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [TP4a]: la familia ve una selección NO compartida (n=%)', n; end if;

  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';  -- staff togglea
  update public.team_plays set shared_with_family = true
   where team_id = 'b1700000-0000-4000-8000-000000000001' and play_id = 'b1900000-0000-4000-8000-0000000000b1';

  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000f","role":"authenticated"}';  -- familia de nuevo
  select count(*) into n from public.team_plays where team_id = 'b1700000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [TP4b]: la familia no ve la selección compartida (n=%)', n; end if;
end $$;

-- TP5: staff del Team A quita la selección → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"b1a00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  delete from public.team_plays
   where team_id = 'b1700000-0000-4000-8000-000000000001' and play_id = 'b1900000-0000-4000-8000-0000000000b1';
  select count(*) into n from public.team_plays where team_id = 'b1700000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [TP5]: staff no pudo quitar la selección'; end if;
end $$;

reset role;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS plays (banco del club) + team_plays pasaron.'
\echo '──────────────────────────────────────────────'
