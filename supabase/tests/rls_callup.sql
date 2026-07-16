-- Tests F4.3 — RLS y triggers de match_callup_meta + callup_responses +
-- callup_decisions.
--
-- Casos:
--   M1. INSERT meta (borrador) por admin → OK.
--   M2. INSERT meta sobre evento type='training' → falla event_not_match.
--   M3. UPDATE para publicar setea published_at + fuerza published_by=auth.uid().
--   M4. UPDATE intentando despublicar (published_at NOT NULL → NULL) falla.
--   M5. RLS SELECT borrador: solo manager; admin de otro club no ve.
--   M6. RLS SELECT publicada: cualquier miembro del club.
--   R1. INSERT response por dueño de player_account → OK; responded_by forzado.
--   R2. INSERT response por entrenador (no dueño) → forbidden (42501).
--   R3. INSERT response cuando meta NO publicada → callup_not_published.
--   R4. UPDATE intentando cambiar player_id → player_id_immutable.
--   D1. INSERT decision por admin → OK; decided_by forzado.
--   D2. INSERT decision por jugador → forbidden (42501).
--   D3. UNIQUE (event,player) — segundo INSERT en decisions → 23505.
--   D4. Regresión bug: ayudante a nivel club PERO principal en team_staff
--       puede INSERT + UPDATE decision en borrador (migración 20260603).
--   D5. Ayudante a nivel club + ayudante en team_staff SIN cap → 42501.
--   F1. self responde → OK; responded_by = self.profile.
--   F2. parent (familia) overwrites self via UPDATE → OK; responded_by = familia.
--   F3. parent re-INSERT tras limpieza → OK; responded_by = familia.
--   F4. jugador sin player_accounts → INSERT rechazado con 42501.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('11dd0000-0000-0000-0000-000000000001', 'Club Callup A', 'club-callup-a'),
  ('11dd0000-0000-0000-0000-000000000002', 'Club Callup B', 'club-callup-b');

insert into public.categories (id, club_id, name) values
  ('22dd0000-0000-0000-0000-000000000001', '11dd0000-0000-0000-0000-000000000001', 'Cat C-A'),
  ('22dd0000-0000-0000-0000-000000000002', '11dd0000-0000-0000-0000-000000000002', 'Cat C-B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('33dd0000-0000-0000-0000-000000000001', '22dd0000-0000-0000-0000-000000000001', 'Team Callup A', 'F7', '#0EA5E9', '2025-26'),
  ('33dd0000-0000-0000-0000-000000000002', '22dd0000-0000-0000-0000-000000000002', 'Team Callup B', 'F7', '#0EA5E9', '2025-26');

select pg_temp.new_test_user('44dd0000-aaaa-1111-1111-111111111111', 'admin-c-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44dd0000-aaaa-3333-3333-333333333333', 'principal-c-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44dd0000-aaaa-9999-9999-999999999999', 'jugador-c-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44dd0000-bbbb-1111-1111-111111111111', 'admin-c-b@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55dd0000-aaaa-1111-1111-111111111111', '44dd0000-aaaa-1111-1111-111111111111', '11dd0000-0000-0000-0000-000000000001', 'admin_club'),
  ('55dd0000-aaaa-3333-3333-333333333333', '44dd0000-aaaa-3333-3333-333333333333', '11dd0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('55dd0000-aaaa-9999-9999-999999999999', '44dd0000-aaaa-9999-9999-999999999999', '11dd0000-0000-0000-0000-000000000001', 'jugador'),
  ('55dd0000-bbbb-1111-1111-111111111111', '44dd0000-bbbb-1111-1111-111111111111', '11dd0000-0000-0000-0000-000000000002', 'admin_club');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33dd0000-0000-0000-0000-000000000001', '55dd0000-aaaa-3333-3333-333333333333', 'entrenador_principal');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66dd0000-0000-0000-0000-000000000001', '11dd0000-0000-0000-0000-000000000001', 'Pol', 'Test', '2014-04-01'),
  -- Player de control para el test R4: existe en el mismo team/club para que la
  -- UPDATE intentando reasignar player_id no falle por FK/club mismatch antes
  -- de llegar al check de inmutabilidad.
  ('66dd0000-0000-0000-0000-000000000002', '11dd0000-0000-0000-0000-000000000001', 'Aniol', 'Control', '2014-05-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('33dd0000-0000-0000-0000-000000000001', '66dd0000-0000-0000-0000-000000000001',
   (current_date - interval '60 days')::date),
  ('33dd0000-0000-0000-0000-000000000001', '66dd0000-0000-0000-0000-000000000002',
   (current_date - interval '60 days')::date);

-- Vínculo player_accounts: el "jugador-c-a" es la propia cuenta del jugador.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('66dd0000-0000-0000-0000-000000000001', '44dd0000-aaaa-9999-9999-999999999999', 'self');

-- Evento partido en 3 días.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('77dd0000-0000-0000-0000-000000000001',
   '11dd0000-0000-0000-0000-000000000001',
   '33dd0000-0000-0000-0000-000000000001',
   'match',
   'Partido vs Rivales',
   (current_timestamp + interval '3 days'),
   '44dd0000-aaaa-1111-1111-111111111111'),
  ('77dd0000-0000-0000-0000-000000000002',
   '11dd0000-0000-0000-0000-000000000001',
   '33dd0000-0000-0000-0000-000000000001',
   'training',
   'Entrenamiento futuro',
   (current_timestamp + interval '1 day'),
   '44dd0000-aaaa-1111-1111-111111111111');

-- ─────────────────────────────────────────────────────────────────────────────
-- M1: admin inserta meta borrador
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-1111-1111-111111111111';

do $$
begin
  insert into public.match_callup_meta (event_id, meeting_at, meeting_location)
  values (
    '77dd0000-0000-0000-0000-000000000001',
    current_timestamp + interval '2 days 22 hours',
    'Vestuario visitante'
  );
exception when others then
  raise exception 'FAIL [M1]: insert meta admin falló: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2: meta sobre evento type='training' → event_not_match
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.match_callup_meta (event_id, meeting_at, meeting_location)
    values (
      '77dd0000-0000-0000-0000-000000000002',
      current_timestamp + interval '1 day 1 hour',
      'No procede'
    );
  exception when others then
    if sqlerrm like '%event_not_match%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [M2]: training no debería admitir meta';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M3: publish → published_by forzado a auth.uid()
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  update public.match_callup_meta
     set published_at = now()
   where event_id = '77dd0000-0000-0000-0000-000000000001';

  if (select published_by from public.match_callup_meta
       where event_id = '77dd0000-0000-0000-0000-000000000001')
     is distinct from '44dd0000-aaaa-1111-1111-111111111111'::uuid then
    raise exception 'FAIL [M3]: published_by no se sobreescribió a auth.uid()';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M4: intento de despublicar → cannot_unpublish
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    update public.match_callup_meta
       set published_at = null
     where event_id = '77dd0000-0000-0000-0000-000000000001';
  exception when others then
    if sqlerrm like '%cannot_unpublish%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [M4]: despublicar debería rechazarse';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- M5: admin del club B no ve la meta del club A (RLS cross-club)
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-bbbb-1111-1111-111111111111';

do $$
declare cnt int;
begin
  select count(*) into cnt
    from public.match_callup_meta
   where event_id = '77dd0000-0000-0000-0000-000000000001';
  if cnt <> 0 then
    raise exception 'FAIL [M5]: admin de otro club ve meta (cnt=%)', cnt;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- M6: cualquier miembro del club ve la meta publicada
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-9999-9999-999999999999';

do $$
declare cnt int;
begin
  select count(*) into cnt
    from public.match_callup_meta
   where event_id = '77dd0000-0000-0000-0000-000000000001';
  if cnt = 0 then
    raise exception 'FAIL [M6]: jugador del club no ve meta publicada';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R1: dueño del player_account inserta su response (jugador-c-a)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  insert into public.callup_responses (event_id, player_id, status, responded_by)
  values (
    '77dd0000-0000-0000-0000-000000000001',
    '66dd0000-0000-0000-0000-000000000001',
    'yes',
    '44dd0000-aaaa-1111-1111-111111111111' -- mismatch deliberado
  )
  returning id into v_id;

  if (select responded_by from public.callup_responses where id = v_id)
     is distinct from '44dd0000-aaaa-9999-9999-999999999999'::uuid then
    raise exception 'FAIL [R1]: responded_by no se sobreescribió a auth.uid()';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R2: entrenador (no dueño) no puede insertar response
-- ─────────────────────────────────────────────────────────────────────────────
-- Borramos primero la R1 para tener el slot libre.
delete from public.callup_responses
 where event_id = '77dd0000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-3333-3333-333333333333';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_responses (event_id, player_id, status, responded_by)
    values (
      '77dd0000-0000-0000-0000-000000000001',
      '66dd0000-0000-0000-0000-000000000001',
      'yes',
      '44dd0000-aaaa-3333-3333-333333333333'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R2]: entrenador no debería poder responder por otro';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R3: response cuando meta NO publicada → callup_not_published.
-- Despublicar no es posible (M4 lo bloquea), así que creamos OTRO evento
-- partido y NO publicamos su meta.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('77dd0000-0000-0000-0000-000000000003',
   '11dd0000-0000-0000-0000-000000000001',
   '33dd0000-0000-0000-0000-000000000001',
   'match',
   'Partido futuro 2',
   (current_timestamp + interval '7 days'),
   '44dd0000-aaaa-1111-1111-111111111111');

set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-9999-9999-999999999999';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_responses (event_id, player_id, status, responded_by)
    values (
      '77dd0000-0000-0000-0000-000000000003',
      '66dd0000-0000-0000-0000-000000000001',
      'maybe',
      '44dd0000-aaaa-9999-9999-999999999999'
    );
  exception when others then
    if sqlerrm like '%callup_not_published%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R3]: response sin meta publicada debería rechazarse';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- R4: UPDATE intentando cambiar player_id → player_id_immutable.
-- Insertamos una fila válida primero.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-9999-9999-999999999999';

insert into public.callup_responses (event_id, player_id, status, responded_by)
values (
  '77dd0000-0000-0000-0000-000000000001',
  '66dd0000-0000-0000-0000-000000000001',
  'yes',
  '44dd0000-aaaa-9999-9999-999999999999'
);

reset role;

-- Como service_role (sin auth.uid), intentamos cambiar player_id en SQL puro.
do $$
declare ok boolean := false;
begin
  begin
    update public.callup_responses
       set player_id = '66dd0000-0000-0000-0000-000000000002'
     where event_id = '77dd0000-0000-0000-0000-000000000001';
  exception when others then
    if sqlerrm like '%player_id_immutable%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R4]: player_id debería ser inmutable';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D1: admin inserta decision; decided_by forzado.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-1111-1111-111111111111';

do $$
begin
  insert into public.callup_decisions (event_id, player_id, decision, decided_by)
  values (
    '77dd0000-0000-0000-0000-000000000001',
    '66dd0000-0000-0000-0000-000000000001',
    'called_up',
    '44dd0000-aaaa-9999-9999-999999999999' -- intentional mismatch
  );
  if (select decided_by from public.callup_decisions
       where event_id = '77dd0000-0000-0000-0000-000000000001'
         and player_id = '66dd0000-0000-0000-0000-000000000001')
     is distinct from '44dd0000-aaaa-1111-1111-111111111111'::uuid then
    raise exception 'FAIL [D1]: decided_by no se sobreescribió';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- D3: UNIQUE (event,player) → 23505
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_decisions (event_id, player_id, decision, decided_by)
    values (
      '77dd0000-0000-0000-0000-000000000001',
      '66dd0000-0000-0000-0000-000000000001',
      'discarded',
      '44dd0000-aaaa-1111-1111-111111111111'
    );
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [D3]: duplicado (event,player) debería 23505';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D2: jugador no puede insertar decision
-- ─────────────────────────────────────────────────────────────────────────────
delete from public.callup_decisions
 where event_id = '77dd0000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-9999-9999-999999999999';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_decisions (event_id, player_id, decision, decided_by)
    values (
      '77dd0000-0000-0000-0000-000000000001',
      '66dd0000-0000-0000-0000-000000000001',
      'called_up',
      '44dd0000-aaaa-9999-9999-999999999999'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [D2]: jugador no debería poder insertar decision';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D4: principal del team vía team_staff.staff_role (NO vía memberships.role)
--      puede INSERT y UPDATE decision en estado borrador.
--
-- Regresión del bug detectado en smoke (commit 70788df):
--   user es `memberships.role = entrenador_ayudante` a nivel club,
--   pero `team_staff.staff_role = entrenador_principal` en el team del partido.
--   La fix `user_can_manage_callup` (migración 20260603) debe permitirle gestionar.
--
-- Importante: la meta del partido sigue siendo BORRADOR (no la publicamos).
-- ─────────────────────────────────────────────────────────────────────────────

-- Usuario nuevo: ayudante a nivel club, principal del team_staff.
select pg_temp.new_test_user('44dd0000-aaaa-4444-4444-444444444444', 'team-principal-c-a@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55dd0000-aaaa-4444-4444-444444444444', '44dd0000-aaaa-4444-4444-444444444444', '11dd0000-0000-0000-0000-000000000001', 'entrenador_ayudante');

-- El team ya tiene un principal (membership 3333) de la setup inicial. Lo
-- marcamos como inactivo (left_at) para no chocar con el unique de un
-- principal activo por team_staff antes de añadir al nuevo.
update public.team_staff
   set left_at = current_date
 where team_id = '33dd0000-0000-0000-0000-000000000001'
   and membership_id = '55dd0000-aaaa-3333-3333-333333333333';

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33dd0000-0000-0000-0000-000000000001', '55dd0000-aaaa-4444-4444-444444444444', 'entrenador_principal');

-- Usamos el evento 77dd0000-3 (creado en R3) que no tiene meta publicada
-- — está implícitamente en borrador. Confirmamos:
do $$
begin
  if (select published_at from public.match_callup_meta
       where event_id = '77dd0000-0000-0000-0000-000000000003') is not null then
    raise exception 'FAIL [D4 setup]: el evento debería estar en borrador';
  end if;
end $$;

-- Limpiamos cualquier decision residual de tests previos.
delete from public.callup_decisions
 where event_id = '77dd0000-0000-0000-0000-000000000003';

set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-4444-4444-444444444444';

do $$
begin
  insert into public.callup_decisions (event_id, player_id, decision, decided_by)
  values (
    '77dd0000-0000-0000-0000-000000000003',
    '66dd0000-0000-0000-0000-000000000001',
    'called_up',
    '44dd0000-aaaa-4444-4444-444444444444'
  );

  -- Y UPDATE: cambio de called_up → discarded sobre la propia fila.
  update public.callup_decisions
     set decision = 'discarded', reason = 'lesión'
   where event_id = '77dd0000-0000-0000-0000-000000000003'
     and player_id = '66dd0000-0000-0000-0000-000000000001';

  if (select decision from public.callup_decisions
       where event_id = '77dd0000-0000-0000-0000-000000000003'
         and player_id = '66dd0000-0000-0000-0000-000000000001')
     <> 'discarded' then
    raise exception 'FAIL [D4]: UPDATE como principal_de_team_staff en borrador debería persistir';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- D5: ayudante a nivel club SIN principal en team_staff y SIN
--      can_manage_callups: NO puede insertar decision.
--
-- Cierra el complemento de D4: el cambio de la migración 20260603 NO abre
-- el acceso a cualquier ayudante; sigue exigiendo o principal_de_team_staff
-- o capability.
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('44dd0000-aaaa-5555-5555-555555555555', 'just-asst-c-a@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55dd0000-aaaa-5555-5555-555555555555', '44dd0000-aaaa-5555-5555-555555555555', '11dd0000-0000-0000-0000-000000000001', 'entrenador_ayudante');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33dd0000-0000-0000-0000-000000000001', '55dd0000-aaaa-5555-5555-555555555555', 'entrenador_ayudante');

delete from public.callup_decisions
 where event_id = '77dd0000-0000-0000-0000-000000000003';

set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-5555-5555-555555555555';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_decisions (event_id, player_id, decision, decided_by)
    values (
      '77dd0000-0000-0000-0000-000000000003',
      '66dd0000-0000-0000-0000-000000000001',
      'called_up',
      '44dd0000-aaaa-5555-5555-555555555555'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [D5]: ayudante sin principal_de_team_staff ni cap no debería poder insertar decision';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- F1–F4: Bug 2 (post-smoke). Una respuesta por (event_id, player_id), última
-- escritura gana. La familia (player_accounts.relation='parent') puede
-- sobrescribir la respuesta del jugador (relation='self'). Un profile sin
-- player_account NO puede.
-- ─────────────────────────────────────────────────────────────────────────────

-- Limpieza de filas residuales.
delete from public.callup_responses
 where event_id = '77dd0000-0000-0000-0000-000000000001';

-- Usuarios nuevos.
select pg_temp.new_test_user('44dd0000-aaaa-6666-6666-666666666666', 'familia-c-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('44dd0000-aaaa-7777-7777-777777777777', 'jugador-otro-c-a@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('55dd0000-aaaa-6666-6666-666666666666', '44dd0000-aaaa-6666-6666-666666666666', '11dd0000-0000-0000-0000-000000000001', 'jugador'),
  ('55dd0000-aaaa-7777-7777-777777777777', '44dd0000-aaaa-7777-7777-777777777777', '11dd0000-0000-0000-0000-000000000001', 'jugador');

-- Familia con relation=parent del mismo player.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('66dd0000-0000-0000-0000-000000000001', '44dd0000-aaaa-6666-6666-666666666666', 'parent');

-- F1: self responde → ok.
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-9999-9999-999999999999';

do $$
declare v_id uuid;
begin
  insert into public.callup_responses (event_id, player_id, status, responded_by)
  values (
    '77dd0000-0000-0000-0000-000000000001',
    '66dd0000-0000-0000-0000-000000000001',
    'yes',
    '44dd0000-aaaa-9999-9999-999999999999'
  )
  returning id into v_id;
  if (select responded_by from public.callup_responses where id = v_id)
     <> '44dd0000-aaaa-9999-9999-999999999999'::uuid then
    raise exception 'FAIL [F1]: self responde y responded_by debería ser su profile';
  end if;
end $$;

reset role;

-- F2: parent (familia) hace UPDATE sobreescribiendo la respuesta del self.
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-6666-6666-666666666666';

do $$
begin
  update public.callup_responses
     set status = 'no', reason = 'tiene un cumple'
   where event_id = '77dd0000-0000-0000-0000-000000000001'
     and player_id = '66dd0000-0000-0000-0000-000000000001';

  if not found then
    raise exception 'FAIL [F2 setup]: la familia no encontró la fila (RLS read?)';
  end if;

  if (select responded_by from public.callup_responses
       where event_id = '77dd0000-0000-0000-0000-000000000001'
         and player_id = '66dd0000-0000-0000-0000-000000000001')
     <> '44dd0000-aaaa-6666-6666-666666666666'::uuid then
    raise exception 'FAIL [F2]: parent overwrites self, responded_by debería ser la familia';
  end if;
end $$;

reset role;

-- F3: parent INSERT directo tras limpiar.
delete from public.callup_responses
 where event_id = '77dd0000-0000-0000-0000-000000000001';

set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-6666-6666-666666666666';

do $$
begin
  insert into public.callup_responses (event_id, player_id, status, responded_by)
  values (
    '77dd0000-0000-0000-0000-000000000001',
    '66dd0000-0000-0000-0000-000000000001',
    'maybe',
    '44dd0000-aaaa-6666-6666-666666666666'
  );

  if (select responded_by from public.callup_responses
       where event_id = '77dd0000-0000-0000-0000-000000000001'
         and player_id = '66dd0000-0000-0000-0000-000000000001')
     <> '44dd0000-aaaa-6666-6666-666666666666'::uuid then
    raise exception 'FAIL [F3]: parent INSERT, responded_by debería ser la familia';
  end if;
end $$;

reset role;

-- F4: jugador-otro (sin player_accounts) → 42501.
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd0000-aaaa-7777-7777-777777777777';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.callup_responses (event_id, player_id, status, responded_by)
    values (
      '77dd0000-0000-0000-0000-000000000001',
      '66dd0000-0000-0000-0000-000000000001',
      'yes',
      '44dd0000-aaaa-7777-7777-777777777777'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [F4]: jugador sin player_account no debería poder responder';
  end if;
end $$;

reset role;

rollback;
