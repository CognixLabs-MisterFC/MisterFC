-- Tests F4.1 — RLS, triggers y constraints de training_attendance.
--
-- Reusa el patrón de F2.6/F3 con UUIDs dedicados (`44ee*`, `55ee*`) para
-- no chocar con otros tests.
--
-- Casos:
--   B1. INSERT válido por admin con código y notas → OK; recorded_by se
--       sobreescribe a auth.uid().
--   B2. UNIQUE (event_id, player_id) — segundo INSERT con misma pareja
--       falla con 23505.
--   B3. INSERT sobre evento type != 'training' → falla con event_not_training.
--   B4. INSERT sobre evento futuro → falla con event_in_future.
--   B5. INSERT sobre jugador que no estaba en el team a la fecha del
--       evento → falla con player_not_in_team_at_event.
--   B6. UPDATE intentando cambiar event_id → falla con event_id_immutable.
--   B7. UPDATE intentando cambiar player_id → falla con player_id_immutable.
--   B8. UPDATE cambiando code + notes → OK; updated_at se actualiza.
--   R1. RLS SELECT: miembro del club ve filas del evento; cross-club no.
--   R2. RLS INSERT: jugador NO puede insertar (forbidden via policy).
--   R3. RLS INSERT: ayudante sin can_mark_attendance NO puede.
--   R4. RLS INSERT: ayudante con can_mark_attendance + staff activo SÍ puede.
--   R5. RLS INSERT: PRINCIPAL del EQUIPO con rol de CLUB = ayudante y
--       can_mark_attendance=false SÍ puede (regresión del bug: la rama
--       "principal" mira team_staff.staff_role, no memberships.role).
--   R6. RLS UPDATE: ese mismo principal-de-equipo SÍ puede actualizar.
\ir helpers/auth_users.sql

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup: club A + 1 team + 1 jugador + roster activo + un evento training
--        pasado (3 días) + un evento training futuro + un evento match.
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('11ee0000-0000-0000-0000-000000000001', 'Club Att A', 'club-att-a'),
  ('11ee0000-0000-0000-0000-000000000002', 'Club Att B', 'club-att-b');

insert into public.categories (id, club_id, name) values
  ('22ee0000-0000-0000-0000-000000000001', '11ee0000-0000-0000-0000-000000000001', 'Cat Att A'),
  ('22ee0000-0000-0000-0000-000000000002', '11ee0000-0000-0000-0000-000000000002', 'Cat Att B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('33ee0000-0000-0000-0000-000000000001', '22ee0000-0000-0000-0000-000000000001', 'Team Att A', 'F7', '#10B981', '2025-26'),
  ('33ee0000-0000-0000-0000-000000000002', '22ee0000-0000-0000-0000-000000000002', 'Team Att B', 'F7', '#10B981', '2025-26');

select pg_temp.new_test_user('44ee0000-aaaa-1111-1111-111111111111', 'admin-att-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44ee0000-aaaa-3333-3333-333333333333', 'principal-att-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44ee0000-aaaa-4444-4444-444444444444', 'assistant-att-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44ee0000-aaaa-9999-9999-999999999999', 'jugador-att-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44ee0000-bbbb-1111-1111-111111111111', 'admin-att-b@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55ee0000-aaaa-1111-1111-111111111111', '44ee0000-aaaa-1111-1111-111111111111', '11ee0000-0000-0000-0000-000000000001', 'admin_club'),
  -- 3333 es PRINCIPAL del equipo (team_staff) pero su rol de CLUB es ayudante:
  -- reproduce el caso coach7 (un equipo solo admite un principal activo, por eso
  -- reusamos este actor en vez de añadir un segundo principal al mismo team).
  ('55ee0000-aaaa-3333-3333-333333333333', '44ee0000-aaaa-3333-3333-333333333333', '11ee0000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('55ee0000-aaaa-4444-4444-444444444444', '44ee0000-aaaa-4444-4444-444444444444', '11ee0000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('55ee0000-aaaa-9999-9999-999999999999', '44ee0000-aaaa-9999-9999-999999999999', '11ee0000-0000-0000-0000-000000000001', 'jugador'),
  ('55ee0000-bbbb-1111-1111-111111111111', '44ee0000-bbbb-1111-1111-111111111111', '11ee0000-0000-0000-0000-000000000002', 'admin_club');

-- team_staff activos
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33ee0000-0000-0000-0000-000000000001', '55ee0000-aaaa-3333-3333-333333333333', 'entrenador_principal'),
  ('33ee0000-0000-0000-0000-000000000001', '55ee0000-aaaa-4444-4444-444444444444', 'entrenador_ayudante');

-- 2 jugadores: P1 estaba en el team a la fecha; P2 NO (joined después).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66ee0000-0000-0000-0000-000000000001', '11ee0000-0000-0000-0000-000000000001', 'Pau', 'Test', '2014-04-01'),
  ('66ee0000-0000-0000-0000-000000000002', '11ee0000-0000-0000-0000-000000000001', 'Iván', 'Late', '2014-05-01');

-- Roster: P1 desde hace 30 días; P2 desde mañana (no en roster a fecha del
-- evento pasado).
insert into public.team_members (team_id, player_id, joined_at) values
  ('33ee0000-0000-0000-0000-000000000001', '66ee0000-0000-0000-0000-000000000001',
   (current_date - interval '30 days')::date);

insert into public.team_members (team_id, player_id, joined_at) values
  ('33ee0000-0000-0000-0000-000000000001', '66ee0000-0000-0000-0000-000000000002',
   (current_date + interval '1 day')::date);

-- Eventos: training pasado, training futuro, match pasado.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('77ee0000-0000-0000-0000-000000000001',
   '11ee0000-0000-0000-0000-000000000001',
   '33ee0000-0000-0000-0000-000000000001',
   'training',
   'Entrenamiento pasado',
   (current_timestamp - interval '3 days'),
   '44ee0000-aaaa-1111-1111-111111111111'),
  ('77ee0000-0000-0000-0000-000000000002',
   '11ee0000-0000-0000-0000-000000000001',
   '33ee0000-0000-0000-0000-000000000001',
   'training',
   'Entrenamiento futuro',
   (current_timestamp + interval '2 days'),
   '44ee0000-aaaa-1111-1111-111111111111'),
  ('77ee0000-0000-0000-0000-000000000003',
   '11ee0000-0000-0000-0000-000000000001',
   '33ee0000-0000-0000-0000-000000000001',
   'match',
   'Partido pasado',
   (current_timestamp - interval '3 days'),
   '44ee0000-aaaa-1111-1111-111111111111');

-- ─────────────────────────────────────────────────────────────────────────────
-- B1: INSERT válido por admin
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44ee0000-aaaa-1111-1111-111111111111';

do $$
declare v_id uuid;
begin
  insert into public.training_attendance (event_id, player_id, code, notes, recorded_by) values
    ('77ee0000-0000-0000-0000-000000000001',
     '66ee0000-0000-0000-0000-000000000001',
     'presente',
     'al día',
     '44ee0000-aaaa-9999-9999-999999999999')  -- intentional mismatch para verificar override
    returning id into v_id;

  if (select recorded_by from public.training_attendance where id = v_id)
       is distinct from '44ee0000-aaaa-1111-1111-111111111111'::uuid then
    raise exception 'FAIL [B1]: recorded_by no se sobreescribió a auth.uid()';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B2: UNIQUE (event_id, player_id)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by) values
      ('77ee0000-0000-0000-0000-000000000001',
       '66ee0000-0000-0000-0000-000000000001',
       'ausente',
       '44ee0000-aaaa-1111-1111-111111111111');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [B2]: duplicado (event, player) debería 23505';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B3: evento type != 'training' → event_not_training
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by) values
      ('77ee0000-0000-0000-0000-000000000003',
       '66ee0000-0000-0000-0000-000000000001',
       'presente',
       '44ee0000-aaaa-1111-1111-111111111111');
  exception when others then
    if sqlerrm like '%event_not_training%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [B3]: match no debería admitir asistencia';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B4: evento futuro → event_in_future
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by) values
      ('77ee0000-0000-0000-0000-000000000002',
       '66ee0000-0000-0000-0000-000000000001',
       'presente',
       '44ee0000-aaaa-1111-1111-111111111111');
  exception when others then
    if sqlerrm like '%event_in_future%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [B4]: evento futuro no debería admitir asistencia';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B5: jugador no estaba en el team a la fecha
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by) values
      ('77ee0000-0000-0000-0000-000000000001',
       '66ee0000-0000-0000-0000-000000000002',
       'presente',
       '44ee0000-aaaa-1111-1111-111111111111');
  exception when others then
    if sqlerrm like '%player_not_in_team_at_event%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [B5]: jugador fuera de roster debería rechazarse';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B6 + B7: UPDATE inmutabilidad
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    update public.training_attendance
       set event_id = '77ee0000-0000-0000-0000-000000000002'
     where event_id = '77ee0000-0000-0000-0000-000000000001'
       and player_id = '66ee0000-0000-0000-0000-000000000001';
  exception when others then
    if sqlerrm like '%event_id_immutable%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [B6]: event_id debería ser inmutable';
  end if;
end $$;

do $$
declare ok boolean := false;
begin
  begin
    update public.training_attendance
       set player_id = '66ee0000-0000-0000-0000-000000000002'
     where event_id = '77ee0000-0000-0000-0000-000000000001';
  exception when others then
    if sqlerrm like '%player_id_immutable%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [B7]: player_id debería ser inmutable';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- B8: UPDATE legal cambia code + notes y el trigger SELLA updated_at.
--
-- Nota: el trigger fija updated_at := now(), y now() = transaction_timestamp() es
-- CONSTANTE dentro de la transacción que envuelve este test (BEGIN…ROLLBACK), así
-- que NO se puede exigir que updated_at "avance" intra-transacción (pg_sleep no
-- mueve now()). En producción cada request es su propia transacción y sí avanza.
-- Aquí verificamos lo comprobable: que el UPDATE legal aplica code/notes y que el
-- trigger dejó updated_at = now() (sellado en la fila).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_code    text;
        v_notes   text;
        v_updated timestamptz;
begin
  update public.training_attendance
     set code = 'ausente_con_aviso', notes = 'cita médica'
   where event_id = '77ee0000-0000-0000-0000-000000000001';

  select code, notes, updated_at into v_code, v_notes, v_updated
    from public.training_attendance
   where event_id = '77ee0000-0000-0000-0000-000000000001';

  if v_code <> 'ausente_con_aviso' or v_notes is distinct from 'cita médica' then
    raise exception 'FAIL [B8]: UPDATE legal no aplicó code/notes (code=%, notes=%)', v_code, v_notes;
  end if;
  if v_updated is distinct from now() then
    raise exception 'FAIL [B8]: el trigger no selló updated_at = now() (got=%)', v_updated;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R1: RLS SELECT — admin del club B NO ve las filas del club A
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44ee0000-bbbb-1111-1111-111111111111';

do $$
declare cnt int;
begin
  select count(*) into cnt
    from public.training_attendance
   where event_id = '77ee0000-0000-0000-0000-000000000001';
  if cnt <> 0 then
    raise exception 'FAIL [R1]: admin de otro club no debería ver filas (cnt=%)', cnt;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R2: jugador NO puede insertar
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44ee0000-aaaa-9999-9999-999999999999';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by) values
      ('77ee0000-0000-0000-0000-000000000001',
       '66ee0000-0000-0000-0000-000000000001',
       'presente',
       '44ee0000-aaaa-9999-9999-999999999999');
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R2]: jugador no debería poder insertar';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R3: ayudante sin can_mark_attendance NO puede insertar.
-- ─────────────────────────────────────────────────────────────────────────────
-- Garantiza granted=false (la migración hizo backfill como false).
update public.capabilities
   set granted = false
 where membership_id = '55ee0000-aaaa-4444-4444-444444444444'
   and capability_name = 'can_mark_attendance';

-- Borra la fila B1 para que el ayudante pueda intentar de cero.
delete from public.training_attendance
 where event_id = '77ee0000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" to '44ee0000-aaaa-4444-4444-444444444444';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.training_attendance (event_id, player_id, code, recorded_by) values
      ('77ee0000-0000-0000-0000-000000000001',
       '66ee0000-0000-0000-0000-000000000001',
       'presente',
       '44ee0000-aaaa-4444-4444-444444444444');
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R3]: ayudante sin cap no debería poder insertar';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R4: ayudante con can_mark_attendance + staff activo SÍ puede.
-- ─────────────────────────────────────────────────────────────────────────────
update public.capabilities
   set granted = true
 where membership_id = '55ee0000-aaaa-4444-4444-444444444444'
   and capability_name = 'can_mark_attendance';

set local role authenticated;
set local "request.jwt.claim.sub" to '44ee0000-aaaa-4444-4444-444444444444';

do $$
begin
  insert into public.training_attendance (event_id, player_id, code, recorded_by) values
    ('77ee0000-0000-0000-0000-000000000001',
     '66ee0000-0000-0000-0000-000000000001',
     'presente',
     '44ee0000-aaaa-4444-4444-444444444444');
exception when others then
  raise exception 'FAIL [R4]: ayudante con cap debería poder insertar: %', sqlerrm;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R5: PRINCIPAL DE EQUIPO con rol de CLUB = ayudante y can_mark_attendance=false
--     → SÍ puede INSERT (regresión del bug). Demuestra que la rama "principal"
--     mira team_staff.staff_role, NO memberships.role, y que NO depende de la
--     capability.
-- ─────────────────────────────────────────────────────────────────────────────
-- Garantiza que NO se apoya en la capability (el trigger la sembró en false; lo
-- reafirmamos por si acaso) — debe pasar por la rama "principal de equipo".
update public.capabilities
   set granted = false
 where membership_id = '55ee0000-aaaa-3333-3333-333333333333'
   and capability_name = 'can_mark_attendance';

-- Limpia la fila que dejó R4 para insertar de cero.
delete from public.training_attendance
 where event_id = '77ee0000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" to '44ee0000-aaaa-3333-3333-333333333333';

do $$
begin
  insert into public.training_attendance (event_id, player_id, code, recorded_by) values
    ('77ee0000-0000-0000-0000-000000000001',
     '66ee0000-0000-0000-0000-000000000001',
     'presente',
     '44ee0000-aaaa-3333-3333-333333333333');
exception when others then
  raise exception 'FAIL [R5]: principal de equipo (rol de club ayudante) debería poder insertar: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R6: ese mismo principal-de-equipo puede UPDATE.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_code text;
begin
  update public.training_attendance
     set code = 'ausente'
   where event_id = '77ee0000-0000-0000-0000-000000000001'
     and player_id = '66ee0000-0000-0000-0000-000000000001';

  select code into v_code
    from public.training_attendance
   where event_id = '77ee0000-0000-0000-0000-000000000001'
     and player_id = '66ee0000-0000-0000-0000-000000000001';

  if v_code is distinct from 'ausente' then
    raise exception 'FAIL [R6]: principal de equipo debería poder actualizar (code=%)', v_code;
  end if;
end $$;

reset role;

rollback;
