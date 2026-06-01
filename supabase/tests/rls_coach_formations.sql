-- Tests F6.10 — CHECK/trigger y RLS de coach_formations
-- (migración 20260610000000_coach_formations.sql).
--
-- Convención del repo: psql con ON_ERROR_STOP=1; cada bloque que DEBE fallar se
-- envuelve en un DO con EXCEPTION capturando el SQLSTATE esperado y un
-- `raise exception 'FAIL [...]'` si NO falla. Todo en una transacción con
-- ROLLBACK final → no deja rastro en la BD remota.
--
-- Casos:
--   Trigger de validación de positions (superuser, RLS bypass):
--     V1. nº de posiciones ≠ modalidad (7 en F8) → check_violation.
--     V2. position_code > 20 chars → check_violation.
--     V3. coordenada fuera de [0,100] → check_violation.
--     V4. UNIQUE (owner, format, name) — segundo INSERT → 23505.
--     V5. mismo nombre en otra modalidad → OK (no colisiona).
--   RLS (role-switched):
--     S1. owner (coach A1, con cap) ve su formación.
--     S2. otro coach (A2, principal sin admin/coord) NO ve la de A1.
--     S3. admin del club ve la de A1.
--     S4. coordinador del club ve la de A1.
--     S5. admin de OTRO club NO ve la de A1.
--   INSERT:
--     P1. coach A1 (cap can_create_lineups) inserta la suya → OK; owner forzado.
--     P2. jugador (sin cap) inserta → forbidden (42501).
--     P3. ayudante sin cap inserta → forbidden (42501).
--     P4. principal del team (team_staff) sin cap inserta → OK (Bug BB).
--     P5. admin del club sin cap inserta → OK (Bug BB).
--     P6. coordinador del club sin cap inserta → OK (Bug BB).
--   DELETE:
--     X1. otro coach (A2) borra la de A1 → 0 filas (RLS la oculta).
--     X2. coordinador borra la de A1 → 0 filas (solo owner + admin).
--     X3. admin borra la de A1 → 1 fila.

begin;

insert into public.clubs (id, name, slug) values
  ('99cf0000-0000-0000-0000-000000000001', 'Club CF A', 'club-cf-a'),
  ('99cf0000-0000-0000-0000-000000000002', 'Club CF B', 'club-cf-b');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('99cf0000-aaaa-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-cf-a@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('99cf0000-aaaa-0002-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach1-cf-a@ts.test',    now(), '{}'::jsonb, now(), now()),
  ('99cf0000-aaaa-0003-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coach2-cf-a@ts.test',    now(), '{}'::jsonb, now(), now()),
  ('99cf0000-aaaa-0004-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-cf-a@ts.test',     now(), '{}'::jsonb, now(), now()),
  ('99cf0000-aaaa-0005-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-cf-a@ts.test',   now(), '{}'::jsonb, now(), now()),
  ('99cf0000-aaaa-0006-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ayudante-cf-a@ts.test',  now(), '{}'::jsonb, now(), now()),
  ('99cf0000-aaaa-0007-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-cf-a@ts.test',  now(), '{}'::jsonb, now(), now()),
  ('99cf0000-bbbb-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-cf-b@ts.test',     now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('99cf0000-5555-0001-0000-000000000000', '99cf0000-aaaa-0001-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'admin_club'),
  ('99cf0000-5555-0002-0000-000000000000', '99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('99cf0000-5555-0003-0000-000000000000', '99cf0000-aaaa-0003-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('99cf0000-5555-0004-0000-000000000000', '99cf0000-aaaa-0004-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'coordinador'),
  ('99cf0000-5555-0005-0000-000000000000', '99cf0000-aaaa-0005-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'jugador'),
  ('99cf0000-5555-0006-0000-000000000000', '99cf0000-aaaa-0006-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('99cf0000-5555-0007-0000-000000000000', '99cf0000-bbbb-0001-0000-000000000000', '99cf0000-0000-0000-0000-000000000002', 'admin_club'),
  ('99cf0000-5555-0008-0000-000000000000', '99cf0000-aaaa-0007-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'entrenador_principal');

-- Capability can_create_lineups: coach1 y coach2 la tienen; ayudante y el
-- principal-sin-cap (coach3) NO — coach3 crea vía autoridad team_staff (Bug BB).
insert into public.capabilities (membership_id, capability_name, granted) values
  ('99cf0000-5555-0002-0000-000000000000', 'can_create_lineups', true),
  ('99cf0000-5555-0003-0000-000000000000', 'can_create_lineups', true);

-- Team + team_staff: coach3 es PRINCIPAL del team (autoridad de alineaciones
-- sin capability explícita).
insert into public.categories (id, club_id, name, season) values
  ('99cf0000-dddd-0001-0000-000000000000', '99cf0000-0000-0000-0000-000000000001', 'Cat CF A', '2025-26');
insert into public.teams (id, category_id, name, format, color) values
  ('99cf0000-eeee-0001-0000-000000000000', '99cf0000-dddd-0001-0000-000000000000', 'Team CF A', 'F7', '#0EA5E9');
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('99cf0000-eeee-0001-0000-000000000000', '99cf0000-5555-0008-0000-000000000000', 'entrenador_principal');

-- Posiciones válidas para F7 (7 items). Las reutilizamos en varios casos.
-- (sin \set para no depender de variables; se repite el literal donde hace falta)

-- Formación de coach1 insertada como superuser (RLS bypass) con owner explícito
-- — el trigger solo fuerza owner=auth.uid() cuando hay sesión (auth.uid() null
-- como superuser). Sirve de base para los tests de SELECT/DELETE.
insert into public.coach_formations (id, owner_profile_id, club_id, name, format, positions) values
  ('99cf0000-ffff-0001-0000-000000000000',
   '99cf0000-aaaa-0002-0000-000000000000',
   '99cf0000-0000-0000-0000-000000000001',
   'Mi 1-3-3', 'F7',
   '[{"position_code":"POR","x_pct":50,"y_pct":94},
     {"position_code":"DF1","x_pct":20,"y_pct":70},
     {"position_code":"DF2","x_pct":50,"y_pct":70},
     {"position_code":"DF3","x_pct":80,"y_pct":70},
     {"position_code":"FW1","x_pct":20,"y_pct":38},
     {"position_code":"FW2","x_pct":50,"y_pct":38},
     {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger de validación (superuser)
-- ─────────────────────────────────────────────────────────────────────────────

-- V1. 7 posiciones en F8 (espera 8) → check_violation.
do $$
begin
  begin
    insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
      values ('99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
        'V1', 'F8',
        '[{"position_code":"POR","x_pct":50,"y_pct":94},
          {"position_code":"DF1","x_pct":20,"y_pct":70},
          {"position_code":"DF2","x_pct":50,"y_pct":70},
          {"position_code":"DF3","x_pct":80,"y_pct":70},
          {"position_code":"FW1","x_pct":20,"y_pct":38},
          {"position_code":"FW2","x_pct":50,"y_pct":38},
          {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
    raise exception 'FAIL [V1]: 7 posiciones en F8 debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- V2. position_code > 20 chars → check_violation.
do $$
begin
  begin
    insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
      values ('99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
        'V2', 'F7',
        '[{"position_code":"ESTE_CODIGO_ES_DEMASIADO_LARGO","x_pct":50,"y_pct":94},
          {"position_code":"DF1","x_pct":20,"y_pct":70},
          {"position_code":"DF2","x_pct":50,"y_pct":70},
          {"position_code":"DF3","x_pct":80,"y_pct":70},
          {"position_code":"FW1","x_pct":20,"y_pct":38},
          {"position_code":"FW2","x_pct":50,"y_pct":38},
          {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
    raise exception 'FAIL [V2]: position_code largo debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- V3. coordenada fuera de rango → check_violation.
do $$
begin
  begin
    insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
      values ('99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
        'V3', 'F7',
        '[{"position_code":"POR","x_pct":150,"y_pct":94},
          {"position_code":"DF1","x_pct":20,"y_pct":70},
          {"position_code":"DF2","x_pct":50,"y_pct":70},
          {"position_code":"DF3","x_pct":80,"y_pct":70},
          {"position_code":"FW1","x_pct":20,"y_pct":38},
          {"position_code":"FW2","x_pct":50,"y_pct":38},
          {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
    raise exception 'FAIL [V3]: coordenada fuera de [0,100] debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- V4. UNIQUE (owner, format, name) — segundo INSERT mismo nombre/modalidad → 23505.
do $$
begin
  begin
    insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
      values ('99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
        'Mi 1-3-3', 'F7',
        '[{"position_code":"POR","x_pct":50,"y_pct":94},
          {"position_code":"DF1","x_pct":20,"y_pct":70},
          {"position_code":"DF2","x_pct":50,"y_pct":70},
          {"position_code":"DF3","x_pct":80,"y_pct":70},
          {"position_code":"FW1","x_pct":20,"y_pct":38},
          {"position_code":"FW2","x_pct":50,"y_pct":38},
          {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
    raise exception 'FAIL [V4]: nombre duplicado en misma modalidad debería rechazarse';
  exception when unique_violation then null;
  end;
end $$;

-- V5. mismo nombre en otra modalidad (F8) → OK.
do $$
begin
  insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
    values ('99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
      'Mi 1-3-3', 'F8',
      '[{"position_code":"POR","x_pct":50,"y_pct":94},
        {"position_code":"DF1","x_pct":20,"y_pct":74},
        {"position_code":"DF2","x_pct":50,"y_pct":74},
        {"position_code":"DF3","x_pct":80,"y_pct":74},
        {"position_code":"MF1","x_pct":20,"y_pct":50},
        {"position_code":"MF2","x_pct":50,"y_pct":50},
        {"position_code":"MF3","x_pct":80,"y_pct":50},
        {"position_code":"FW1","x_pct":50,"y_pct":24}]'::jsonb);
exception when others then
  raise exception 'FAIL [V5]: mismo nombre en otra modalidad debería permitirse: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS SELECT (role-switched)
-- ─────────────────────────────────────────────────────────────────────────────

-- S1. owner (coach1) ve su formación.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.coach_formations
    where id = '99cf0000-ffff-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S1]: owner debería ver su formación (n=%)', n; end if;
end $$;
reset role;

-- S2. otro coach (principal sin admin/coord) NO ve la de coach1.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.coach_formations
    where id = '99cf0000-ffff-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S2]: otro coach NO debería ver la formación ajena (n=%)', n; end if;
end $$;
reset role;

-- S3. admin del club ve la de coach1.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.coach_formations
    where id = '99cf0000-ffff-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S3]: admin debería ver la formación del club (n=%)', n; end if;
end $$;
reset role;

-- S4. coordinador del club ve la de coach1.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.coach_formations
    where id = '99cf0000-ffff-0001-0000-000000000000';
  if n <> 1 then raise exception 'FAIL [S4]: coordinador debería ver la formación del club (n=%)', n; end if;
end $$;
reset role;

-- S5. admin de OTRO club NO ve la de coach1.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-bbbb-0001-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.coach_formations
    where id = '99cf0000-ffff-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [S5]: admin de otro club NO debería ver la formación (n=%)', n; end if;
end $$;
reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS INSERT (role-switched)
-- ─────────────────────────────────────────────────────────────────────────────

-- P1. coach1 (con cap) inserta la suya → OK; owner forzado a auth.uid().
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0002-0000-000000000000';
do $$
declare v_owner uuid;
begin
  insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
    values ('99cf0000-aaaa-0002-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
      'P1 nueva', 'F7',
      '[{"position_code":"POR","x_pct":50,"y_pct":94},
        {"position_code":"DF1","x_pct":20,"y_pct":70},
        {"position_code":"DF2","x_pct":50,"y_pct":70},
        {"position_code":"DF3","x_pct":80,"y_pct":70},
        {"position_code":"FW1","x_pct":20,"y_pct":38},
        {"position_code":"FW2","x_pct":50,"y_pct":38},
        {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb)
    returning owner_profile_id into v_owner;
  if v_owner <> '99cf0000-aaaa-0002-0000-000000000000' then
    raise exception 'FAIL [P1]: owner debería forzarse a auth.uid()';
  end if;
exception when others then
  raise exception 'FAIL [P1]: coach con cap no pudo insertar: %', sqlerrm;
end $$;
reset role;

-- P2. jugador (sin cap) inserta → forbidden (42501).
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0005-0000-000000000000';
do $$
begin
  begin
    insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
      values ('99cf0000-aaaa-0005-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
        'P2', 'F7',
        '[{"position_code":"POR","x_pct":50,"y_pct":94},
          {"position_code":"DF1","x_pct":20,"y_pct":70},
          {"position_code":"DF2","x_pct":50,"y_pct":70},
          {"position_code":"DF3","x_pct":80,"y_pct":70},
          {"position_code":"FW1","x_pct":20,"y_pct":38},
          {"position_code":"FW2","x_pct":50,"y_pct":38},
          {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
    raise exception 'FAIL [P2]: jugador sin cap no debería poder insertar';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- P3. ayudante sin cap inserta → forbidden (42501).
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0006-0000-000000000000';
do $$
begin
  begin
    insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
      values ('99cf0000-aaaa-0006-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
        'P3', 'F7',
        '[{"position_code":"POR","x_pct":50,"y_pct":94},
          {"position_code":"DF1","x_pct":20,"y_pct":70},
          {"position_code":"DF2","x_pct":50,"y_pct":70},
          {"position_code":"DF3","x_pct":80,"y_pct":70},
          {"position_code":"FW1","x_pct":20,"y_pct":38},
          {"position_code":"FW2","x_pct":50,"y_pct":38},
          {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
    raise exception 'FAIL [P3]: ayudante sin cap no debería poder insertar';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- P4. principal del team (team_staff) SIN capability inserta → OK (Bug BB).
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0007-0000-000000000000';
do $$
begin
  insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
    values ('99cf0000-aaaa-0007-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
      'P4 principal', 'F7',
      '[{"position_code":"POR","x_pct":50,"y_pct":94},
        {"position_code":"DF1","x_pct":20,"y_pct":70},
        {"position_code":"DF2","x_pct":50,"y_pct":70},
        {"position_code":"DF3","x_pct":80,"y_pct":70},
        {"position_code":"FW1","x_pct":20,"y_pct":38},
        {"position_code":"FW2","x_pct":50,"y_pct":38},
        {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
exception when others then
  raise exception 'FAIL [P4]: principal del team (sin cap) debería poder insertar: %', sqlerrm;
end $$;
reset role;

-- P5. admin del club SIN capability inserta → OK (Bug BB: la otra mitad).
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0001-0000-000000000000';
do $$
begin
  insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
    values ('99cf0000-aaaa-0001-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
      'P5 admin', 'F7',
      '[{"position_code":"POR","x_pct":50,"y_pct":94},
        {"position_code":"DF1","x_pct":20,"y_pct":70},
        {"position_code":"DF2","x_pct":50,"y_pct":70},
        {"position_code":"DF3","x_pct":80,"y_pct":70},
        {"position_code":"FW1","x_pct":20,"y_pct":38},
        {"position_code":"FW2","x_pct":50,"y_pct":38},
        {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
exception when others then
  raise exception 'FAIL [P5]: admin sin cap debería poder insertar: %', sqlerrm;
end $$;
reset role;

-- P6. coordinador del club SIN capability inserta → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0004-0000-000000000000';
do $$
begin
  insert into public.coach_formations (owner_profile_id, club_id, name, format, positions)
    values ('99cf0000-aaaa-0004-0000-000000000000', '99cf0000-0000-0000-0000-000000000001',
      'P6 coord', 'F7',
      '[{"position_code":"POR","x_pct":50,"y_pct":94},
        {"position_code":"DF1","x_pct":20,"y_pct":70},
        {"position_code":"DF2","x_pct":50,"y_pct":70},
        {"position_code":"DF3","x_pct":80,"y_pct":70},
        {"position_code":"FW1","x_pct":20,"y_pct":38},
        {"position_code":"FW2","x_pct":50,"y_pct":38},
        {"position_code":"FW3","x_pct":80,"y_pct":38}]'::jsonb);
exception when others then
  raise exception 'FAIL [P6]: coordinador sin cap debería poder insertar: %', sqlerrm;
end $$;
reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS DELETE (role-switched)
-- ─────────────────────────────────────────────────────────────────────────────

-- X1. otro coach (A2) borra la de A1 → 0 filas (RLS la oculta).
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0003-0000-000000000000';
do $$
declare n int;
begin
  with d as (
    delete from public.coach_formations
      where id = '99cf0000-ffff-0001-0000-000000000000' returning 1
  ) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL [X1]: otro coach no debería borrar la ajena (filas=%)', n; end if;
end $$;
reset role;

-- X2. coordinador borra la de A1 → 0 filas (solo owner + admin).
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  with d as (
    delete from public.coach_formations
      where id = '99cf0000-ffff-0001-0000-000000000000' returning 1
  ) select count(*) into n from d;
  if n <> 0 then raise exception 'FAIL [X2]: coordinador no debería borrar (filas=%)', n; end if;
end $$;
reset role;

-- X3. admin borra la de A1 → 1 fila.
set local role authenticated;
set local "request.jwt.claim.sub" to '99cf0000-aaaa-0001-0000-000000000000';
do $$
declare n int;
begin
  with d as (
    delete from public.coach_formations
      where id = '99cf0000-ffff-0001-0000-000000000000' returning 1
  ) select count(*) into n from d;
  if n <> 1 then raise exception 'FAIL [X3]: admin debería borrar la del club (filas=%)', n; end if;
end $$;
reset role;

rollback;
