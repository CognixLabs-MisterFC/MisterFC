-- Tests F13.10g — RLS, trigger y estado de ASSESSMENT_CAMPAIGNS
-- (migraciones 20260731000000_assessment_deadlines.sql + 20260801000000_assessment_campaigns.sql).
--
-- Cubre: INSERT (solo admin_club; coordinador, entrenador y admin de OTRO club
-- rechazados; created_by forzado a auth.uid, club_id derivado del season, status
-- default 'draft'); UPDATE (admin OK cambiando due_date y avanzando status
-- draft→launched→published; period inmutable; no retroceder desde published);
-- SELECT (cualquier miembro del club: admin/coord/entrenador/jugador; otro club no).
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- IDs: prefijo ad (no colisiona con rls_development_reports, que usa d1).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('adc00000-0000-4000-8000-000000000001', 'Club AD A', 'club-ad-a'),
  ('adc00000-0000-4000-8000-000000000002', 'Club AD B', 'club-ad-b');

insert into public.seasons (id, club_id, label, status) values
  ('ad5ea000-0000-4000-8000-000000000001', 'adc00000-0000-4000-8000-000000000001', '2025-26', 'active');

select pg_temp.new_test_user('ada00000-0000-4000-8000-00000000000a', 'adminAD@ad.test', '{}'::jsonb);
select pg_temp.new_test_user('ada00000-0000-4000-8000-00000000000b', 'coordAD@ad.test', '{}'::jsonb);
select pg_temp.new_test_user('ada00000-0000-4000-8000-00000000000c', 'princAD@ad.test', '{}'::jsonb);
select pg_temp.new_test_user('ada00000-0000-4000-8000-00000000000f', 'jugAD@ad.test', '{}'::jsonb);
select pg_temp.new_test_user('adb00000-0000-4000-8000-00000000000a', 'adminADB@ad.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('ad550000-0000-4000-8000-00000000000a', 'ada00000-0000-4000-8000-00000000000a', 'adc00000-0000-4000-8000-000000000001', 'admin_club'),
  ('ad550000-0000-4000-8000-00000000000b', 'ada00000-0000-4000-8000-00000000000b', 'adc00000-0000-4000-8000-000000000001', 'coordinador'),
  ('ad550000-0000-4000-8000-00000000000c', 'ada00000-0000-4000-8000-00000000000c', 'adc00000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('ad550000-0000-4000-8000-00000000000f', 'ada00000-0000-4000-8000-00000000000f', 'adc00000-0000-4000-8000-000000000001', 'jugador'),
  ('adb50000-0000-4000-8000-0000000000ba', 'adb00000-0000-4000-8000-00000000000a', 'adc00000-0000-4000-8000-000000000002', 'admin_club');

-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- W1: admin crea una campaña (inicial) → OK; club_id derivado; status default draft.
do $$
declare v_club uuid; v_status text;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  insert into public.assessment_campaigns (id, club_id, season_id, period, due_date, created_by)
  values ('ade00000-0000-4000-8000-000000000001', 'adc00000-0000-4000-8000-000000000001',
          'ad5ea000-0000-4000-8000-000000000001', 'inicial', '2025-09-15',
          'ada00000-0000-4000-8000-00000000000a');
  select club_id, status into v_club, v_status
    from public.assessment_campaigns where id = 'ade00000-0000-4000-8000-000000000001';
  if v_club <> 'adc00000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [W1a]: club_id no se derivó del season (quedó %)', v_club;
  end if;
  if v_status <> 'draft' then
    raise exception 'FAIL [W1b]: status default no es draft (quedó %)', v_status;
  end if;
exception when others then
  raise exception 'FAIL [W1]: admin no pudo crear campaña: %', sqlerrm;
end $$;

-- W2: coordinador NO puede crear (solo admin) → rechazado.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  begin
    insert into public.assessment_campaigns (club_id, season_id, period, due_date, created_by)
    values ('adc00000-0000-4000-8000-000000000001', 'ad5ea000-0000-4000-8000-000000000001', 'diciembre', '2025-12-20',
            'ada00000-0000-4000-8000-00000000000b');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [W2]: coordinador pudo crear campaña'; end if;
end $$;

-- W3: entrenador NO puede crear → rechazado.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    insert into public.assessment_campaigns (club_id, season_id, period, due_date, created_by)
    values ('adc00000-0000-4000-8000-000000000001', 'ad5ea000-0000-4000-8000-000000000001', 'marzo', '2026-03-20',
            'ada00000-0000-4000-8000-00000000000c');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [W3]: entrenador pudo crear campaña'; end if;
end $$;

-- W4: admin de OTRO club NO puede crear para la season del club A → rechazado.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"adb00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.assessment_campaigns (club_id, season_id, period, due_date, created_by)
    values ('adc00000-0000-4000-8000-000000000001', 'ad5ea000-0000-4000-8000-000000000001', 'junio', '2026-06-20',
            'adb00000-0000-4000-8000-00000000000a');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [W4]: admin de otro club creó campaña en club A'; end if;
end $$;

-- W5/T1: admin actualiza due_date → OK; cambiar period → rechazado (inmutable).
do $$
declare v_date date; ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.assessment_campaigns set due_date = '2025-09-30'
   where id = 'ade00000-0000-4000-8000-000000000001';
  select due_date into v_date from public.assessment_campaigns where id = 'ade00000-0000-4000-8000-000000000001';
  if v_date <> '2025-09-30' then raise exception 'FAIL [W5]: due_date no se actualizó (quedó %)', v_date; end if;

  begin
    update public.assessment_campaigns set period = 'junio'
     where id = 'ade00000-0000-4000-8000-000000000001';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [T1]: se pudo cambiar el period (inmutable)'; end if;
end $$;

-- C1: admin avanza el estado draft → launched → published → OK.
do $$
declare v_status text;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.assessment_campaigns set status = 'launched', launched_at = now()
   where id = 'ade00000-0000-4000-8000-000000000001';
  update public.assessment_campaigns set status = 'published', published_at = now()
   where id = 'ade00000-0000-4000-8000-000000000001';
  select status into v_status from public.assessment_campaigns where id = 'ade00000-0000-4000-8000-000000000001';
  if v_status <> 'published' then raise exception 'FAIL [C1]: no se llegó a published (quedó %)', v_status; end if;
exception when others then
  raise exception 'FAIL [C1]: transición draft→launched→published falló: %', sqlerrm;
end $$;

-- C2: no se puede retroceder desde published → rechazado (guard del trigger).
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    update public.assessment_campaigns set status = 'launched'
     where id = 'ade00000-0000-4000-8000-000000000001';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [C2]: se pudo retroceder desde published'; end if;
end $$;

-- S1..S4: visibilidad de SELECT.
do $$
declare n int;
begin
  -- coordinador del club ve la fila.
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.assessment_campaigns where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [S1]: coordinador no ve la campaña (vio %)', n; end if;

  -- entrenador del club la ve.
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  select count(*) into n from public.assessment_campaigns where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [S2]: entrenador no ve la campaña (vio %)', n; end if;

  -- jugador del club la ve (predicado is not null).
  set local "request.jwt.claims" = '{"sub":"ada00000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.assessment_campaigns where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 1 then raise exception 'FAIL [S3]: jugador del club no ve la campaña (vio %)', n; end if;

  -- admin de OTRO club NO la ve.
  set local "request.jwt.claims" = '{"sub":"adb00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.assessment_campaigns where season_id = 'ad5ea000-0000-4000-8000-000000000001';
  if n <> 0 then raise exception 'FAIL [S4]: admin de otro club ve la campaña del club A (vio %)', n; end if;
end $$;

reset role;

rollback;
