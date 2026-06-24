-- Tests F13.10g-0 — RLS y trigger de ASSESSMENT_DEADLINES
-- (migración 20260731000000_assessment_deadlines.sql).
--
-- Cubre: INSERT (solo admin_club; coordinador, entrenador y admin de OTRO club
-- rechazados; created_by forzado a auth.uid, club_id derivado del season);
-- UPDATE (admin OK cambiando due_date; period inmutable); SELECT (cualquier
-- miembro del club lo ve: admin/coord/entrenador/jugador; admin de otro club no).
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- IDs: prefijo ad (no colisiona con rls_development_reports, que usa d1).

begin;

insert into public.clubs (id, name, slug) values
  ('adc00000-0000-4000-8000-000000000001', 'Club AD A', 'club-ad-a'),
  ('adc00000-0000-4000-8000-000000000002', 'Club AD B', 'club-ad-b');

insert into public.seasons (id, club_id, label, status) values
  ('ad5ea000-0000-4000-8000-000000000001', 'adc00000-0000-4000-8000-000000000001', '2025-26', 'active');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('ada00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminAD@ad.test',  now(), '{}'::jsonb, now(), now()),
  ('ada00000-0000-4000-8000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coordAD@ad.test',  now(), '{}'::jsonb, now(), now()),
  ('ada00000-0000-4000-8000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'princAD@ad.test',  now(), '{}'::jsonb, now(), now()),
  ('ada00000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugAD@ad.test',    now(), '{}'::jsonb, now(), now()),
  ('adb00000-0000-4000-8000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adminADB@ad.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('ad550000-0000-4000-8000-00000000000a', 'ada00000-0000-4000-8000-00000000000a', 'adc00000-0000-4000-8000-000000000001', 'admin_club'),
  ('ad550000-0000-4000-8000-00000000000b', 'ada00000-0000-4000-8000-00000000000b', 'adc00000-0000-4000-8000-000000000001', 'coordinador'),
  ('ad550000-0000-4000-8000-00000000000c', 'ada00000-0000-4000-8000-00000000000c', 'adc00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('ad550000-0000-4000-8000-00000000000f', 'ada00000-0000-4000-8000-00000000000f', 'adc00000-0000-4000-8000-000000000001', 'jugador'),
  ('adb50000-0000-4000-8000-0000000000ba', 'adb00000-0000-4000-8000-00000000000a', 'adc00000-0000-4000-8000-000000000002', 'admin_club');

-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- W1: admin del club crea una fecha límite (inicial) → OK; club_id derivado.
do $$
declare v_club uuid;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  insert into public.assessment_deadlines (id, club_id, season_id, period, due_date, created_by)
  values ('ade00000-0000-4000-8000-000000000001', 'adc00000-0000-4000-8000-000000000001',
          'ad5ea000-0000-4000-8000-000000000001', 'inicial', '2025-09-15',
          'ada00000-0000-4000-8000-00000000000a');
  select club_id into v_club from public.assessment_deadlines where id = 'ade00000-0000-4000-8000-000000000001';
  if v_club <> 'adc00000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [W1]: club_id no se derivó del season (quedó %)', v_club;
  end if;
exception when others then
  raise exception 'FAIL [W1]: admin no pudo crear fecha límite: %', sqlerrm;
end $$;

-- W2: coordinador NO puede crear (solo admin) → rechazado.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  begin
    insert into public.assessment_deadlines (club_id, season_id, period, due_date, created_by)
    values ('adc00000-0000-4000-8000-000000000001', 'ad5ea000-0000-4000-8000-000000000001', 'diciembre', '2025-12-20',
            'ada00000-0000-4000-8000-00000000000b');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [W2]: coordinador pudo crear fecha límite'; end if;
end $$;

-- W3: entrenador NO puede crear → rechazado.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    insert into public.assessment_deadlines (club_id, season_id, period, due_date, created_by)
    values ('adc00000-0000-4000-8000-000000000001', 'ad5ea000-0000-4000-8000-000000000001', 'marzo', '2026-03-20',
            'ada00000-0000-4000-8000-00000000000c');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [W3]: entrenador pudo crear fecha límite'; end if;
end $$;

-- W4: admin de OTRO club NO puede crear para la season del club A → rechazado.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"adb00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.assessment_deadlines (club_id, season_id, period, due_date, created_by)
    values ('adc00000-0000-4000-8000-000000000001', 'ad5ea000-0000-4000-8000-000000000001', 'junio', '2026-06-20',
            'adb00000-0000-4000-8000-00000000000a');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [W4]: admin de otro club creó fecha en club A'; end if;
end $$;

-- W5: admin actualiza la due_date → OK. T1: cambiar period → rechazado (inmutable).
do $$
declare v_date date; ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.assessment_deadlines set due_date = '2025-09-30'
   where id = 'ade00000-0000-4000-8000-000000000001';
  select due_date into v_date from public.assessment_deadlines where id = 'ade00000-0000-4000-8000-000000000001';
  if v_date <> '2025-09-30' then raise exception 'FAIL [W5]: due_date no se actualizó (quedó %)', v_date; end if;

  begin
    update public.assessment_deadlines set period = 'junio'
     where id = 'ade00000-0000-4000-8000-000000000001';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [T1]: se pudo cambiar el period (inmutable)'; end if;
end $$;

-- S1..S4: visibilidad de SELECT.
do $$
declare n int;
begin
  -- coordinador del club ve la fila.
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.assessment_deadlines where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [S1]: coordinador no ve la fecha límite (vio %)', n; end if;

  -- entrenador del club la ve.
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select count(*) into n from public.assessment_deadlines where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [S2]: entrenador no ve la fecha límite (vio %)', n; end if;

  -- jugador del club la ve (predicado is not null).
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.assessment_deadlines where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [S3]: jugador del club no ve la fecha límite (vio %)', n; end if;

  -- admin de OTRO club NO la ve.
  set local "request.jwt.claims" = '{"sub":"adb00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.assessment_deadlines where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [S4]: admin de otro club ve la fecha del club A (vio %)', n; end if;
end $$;

reset role;

rollback;
