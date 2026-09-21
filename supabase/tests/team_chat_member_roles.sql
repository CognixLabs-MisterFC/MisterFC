-- PUSH-ÁREA — team_chat_member_roles (migración 20261091000000).
--
-- La función dice, para el chat de un equipo, QUIÉN recibe la notificación y CON QUÉ
-- PAPEL. Ese papel decide a qué área le abre el push la app, así que equivocarlo no
-- es un detalle: manda a un entrenador al área de familia, o a un padre al panel de
-- dirección. Lo que se fija aquí:
--
--   R1. Las tres ramas salen con su papel: staff, direction, family.
--   R2. GANA STAFF: el entrenador que además es padre de un jugador de SU equipo sale
--       UNA vez y como 'staff' (regla de Jose, la de los festivos).
--   R3. direction gana a family: el director con participación active que tiene un
--       hijo en la plantilla sale como 'direction'.
--   R4. El director en modo OBSERVER no sale (no recibe notificaciones), aunque
--       `user_is_team_chat_member` sí lo cuente como miembro del chat.
--   R5. Los de baja no salen por ninguna rama: membership cerrada, team_staff cerrado
--       y jugador fuera del roster.
--   R6. El conjunto de profile_id coincide EXACTAMENTE con el de
--       `team_chat_member_profile_ids`. Son dos vistas del mismo grupo: si se
--       separaran, se estaría notificando a gente distinta de la que lee el chat.
--   R7. ACL: `anon` NO puede ejecutarla; `authenticated` sí.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. SIN `commit` en ninguna parte: uno solo dejaría el fixture escrito en la BD.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixture — un equipo y siete personas, cada una puesta ahí por una regla.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('acc00000-0000-4000-8000-000000000001', 'Club TCR', 'club-tcr-roles');

insert into public.categories (id, club_id, name) values
  ('bcc00000-0000-4000-8000-000000000001', 'acc00000-0000-4000-8000-000000000001', 'Cat TCR');

-- Dos equipos: el A es el del chat; el B solo sirve para que "estar en otro equipo"
-- no cuele a nadie en el A.
insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('ccc00000-0000-4000-8000-00000000000a', 'bcc00000-0000-4000-8000-000000000001', 'Team A', 'F7', '#10B981', '2025-26', 'acc00000-0000-4000-8000-000000000001'),
  ('ccc00000-0000-4000-8000-00000000000b', 'bcc00000-0000-4000-8000-000000000001', 'Team B', 'F7', '#10B981', '2025-26', 'acc00000-0000-4000-8000-000000000001');

--  COACH  entrenador de A, sin hijos            → staff
--  COAPA  entrenador de A Y padre de un jugador → staff (R2: gana el trabajo)
--  DIR    director con participación active     → direction
--  DIRPA  director active Y padre de un jugador → direction (R3)
--  OBS    director SIN fila de participación    → no sale (R4: observer)
--  TUTOR  padre de un jugador del roster        → family
--  BAJA   padre, pero membership cerrada        → no sale (R5)
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000001', 'coach@tcr.test', '{}'::jsonb);
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000002', 'coapa@tcr.test', '{}'::jsonb);
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000003', 'dir@tcr.test',   '{}'::jsonb);
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000004', 'dirpa@tcr.test', '{}'::jsonb);
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000005', 'obs@tcr.test',   '{}'::jsonb);
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000006', 'tutor@tcr.test', '{}'::jsonb);
select pg_temp.new_test_user('dcc00000-0000-4000-8000-000000000007', 'baja@tcr.test',  '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('5cc00000-0000-4000-8000-000000000001', 'dcc00000-0000-4000-8000-000000000001', 'acc00000-0000-4000-8000-000000000001', 'entrenador_principal', null),
  ('5cc00000-0000-4000-8000-000000000002', 'dcc00000-0000-4000-8000-000000000002', 'acc00000-0000-4000-8000-000000000001', 'entrenador_ayudante',  null),
  ('5cc00000-0000-4000-8000-000000000003', 'dcc00000-0000-4000-8000-000000000003', 'acc00000-0000-4000-8000-000000000001', 'director',             null),
  ('5cc00000-0000-4000-8000-000000000004', 'dcc00000-0000-4000-8000-000000000004', 'acc00000-0000-4000-8000-000000000001', 'director',             null),
  ('5cc00000-0000-4000-8000-000000000005', 'dcc00000-0000-4000-8000-000000000005', 'acc00000-0000-4000-8000-000000000001', 'director',             null),
  ('5cc00000-0000-4000-8000-000000000006', 'dcc00000-0000-4000-8000-000000000006', 'acc00000-0000-4000-8000-000000000001', 'jugador',              null),
  -- R5: de baja en el club, aunque siga vinculada a un jugador del roster.
  ('5cc00000-0000-4000-8000-000000000007', 'dcc00000-0000-4000-8000-000000000007', 'acc00000-0000-4000-8000-000000000001', 'jugador',              current_date - 10);

-- Staff de A: COACH y COAPA. Y un tercer vínculo CERRADO, para R5: quien dejó de
-- entrenar el equipo no debe seguir recibiendo su chat.
-- `joined_at` explícito y anterior: la tabla exige `left_at >= joined_at`, y con el
-- default (current_date) un vínculo cerrado ayer no se podría ni insertar.
insert into public.team_staff (team_id, membership_id, staff_role, joined_at, left_at) values
  ('ccc00000-0000-4000-8000-00000000000a', '5cc00000-0000-4000-8000-000000000001', 'entrenador_principal', current_date - 30, null),
  ('ccc00000-0000-4000-8000-00000000000a', '5cc00000-0000-4000-8000-000000000002', 'entrenador_ayudante',  current_date - 30, null),
  ('ccc00000-0000-4000-8000-00000000000b', '5cc00000-0000-4000-8000-000000000003', 'entrenador_principal', current_date - 30, current_date - 5);

-- Jugadores: uno por cada adulto que tiene hijo, y uno que se fue del roster (R5).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('ecc00000-0000-4000-8000-000000000001', 'acc00000-0000-4000-8000-000000000001', 'Hijo',  'DeCoach', '2013-05-10'),
  ('ecc00000-0000-4000-8000-000000000002', 'acc00000-0000-4000-8000-000000000001', 'Hija',  'DeDir',   '2013-06-11'),
  ('ecc00000-0000-4000-8000-000000000003', 'acc00000-0000-4000-8000-000000000001', 'Hijo',  'DeTutor', '2013-07-12'),
  ('ecc00000-0000-4000-8000-000000000004', 'acc00000-0000-4000-8000-000000000001', 'Hija',  'DeBaja',  '2013-08-13'),
  ('ecc00000-0000-4000-8000-000000000005', 'acc00000-0000-4000-8000-000000000001', 'Ex',    'DelRoster','2013-09-14');

-- Mismo motivo que arriba: `left_at >= joined_at` es un CHECK de la tabla.
insert into public.team_members (player_id, team_id, joined_at, left_at) values
  ('ecc00000-0000-4000-8000-000000000001', 'ccc00000-0000-4000-8000-00000000000a', current_date - 30, null),
  ('ecc00000-0000-4000-8000-000000000002', 'ccc00000-0000-4000-8000-00000000000a', current_date - 30, null),
  ('ecc00000-0000-4000-8000-000000000003', 'ccc00000-0000-4000-8000-00000000000a', current_date - 30, null),
  ('ecc00000-0000-4000-8000-000000000004', 'ccc00000-0000-4000-8000-00000000000a', current_date - 30, null),
  -- R5: fuera del roster desde hace días.
  ('ecc00000-0000-4000-8000-000000000005', 'ccc00000-0000-4000-8000-00000000000a', current_date - 30, current_date - 3);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('ecc00000-0000-4000-8000-000000000001', 'dcc00000-0000-4000-8000-000000000002', 'parent'), -- COAPA
  ('ecc00000-0000-4000-8000-000000000002', 'dcc00000-0000-4000-8000-000000000004', 'parent'), -- DIRPA
  ('ecc00000-0000-4000-8000-000000000003', 'dcc00000-0000-4000-8000-000000000006', 'parent'), -- TUTOR
  ('ecc00000-0000-4000-8000-000000000004', 'dcc00000-0000-4000-8000-000000000007', 'parent'), -- BAJA
  -- El ex-jugador tiene a COACH de tutor: si el roster no se respetara, COACH
  -- seguiría entrando por la rama de familia.
  ('ecc00000-0000-4000-8000-000000000005', 'dcc00000-0000-4000-8000-000000000001', 'parent');

insert into public.team_conversations (id, club_id, team_id) values
  ('9cc00000-0000-4000-8000-00000000000a', 'acc00000-0000-4000-8000-000000000001', 'ccc00000-0000-4000-8000-00000000000a');

-- DIR y DIRPA participan; OBS no tiene fila (observer por ausencia).
insert into public.team_chat_participation (profile_id, team_id, mode) values
  ('dcc00000-0000-4000-8000-000000000003', 'ccc00000-0000-4000-8000-00000000000a', 'active'),
  ('dcc00000-0000-4000-8000-000000000004', 'ccc00000-0000-4000-8000-00000000000a', 'active');

-- ─────────────────────────────────────────────────────────────────────────────
-- R1–R5: el papel de cada uno
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_papel text;
  v_filas int;
begin
  -- R1a: entrenador sin hijos → staff.
  select audience into v_papel from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000001';
  if v_papel is distinct from 'staff' then
    raise exception 'FAIL [R1a]: el entrenador deberia ser staff y es %', coalesce(v_papel, '<no sale>');
  end if;

  -- R1b: padre del roster → family.
  select audience into v_papel from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000006';
  if v_papel is distinct from 'family' then
    raise exception 'FAIL [R1b]: el tutor deberia ser family y es %', coalesce(v_papel, '<no sale>');
  end if;

  -- R1c: director con participacion active → direction.
  select audience into v_papel from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000003';
  if v_papel is distinct from 'direction' then
    raise exception 'FAIL [R1c]: el director active deberia ser direction y es %', coalesce(v_papel, '<no sale>');
  end if;

  -- R2: GANA STAFF. El entrenador que ademas es padre de un jugador de SU equipo
  -- esta en dos ramas y tiene que salir UNA vez, como staff. Si saliera dos veces,
  -- el bus deduplicaria por user_id y el area dependeria del orden de emision.
  select count(*) into v_filas from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000002';
  if v_filas <> 1 then
    raise exception 'FAIL [R2a]: el entrenador-padre sale % veces, deberia salir 1', v_filas;
  end if;
  select audience into v_papel from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000002';
  if v_papel is distinct from 'staff' then
    raise exception 'FAIL [R2b]: el entrenador-padre deberia ser staff y es %', coalesce(v_papel, '<no sale>');
  end if;

  -- R3: direction gana a family.
  select count(*) into v_filas from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000004';
  if v_filas <> 1 then
    raise exception 'FAIL [R3a]: el director-padre sale % veces, deberia salir 1', v_filas;
  end if;
  select audience into v_papel from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000004';
  if v_papel is distinct from 'direction' then
    raise exception 'FAIL [R3b]: el director-padre deberia ser direction y es %', coalesce(v_papel, '<no sale>');
  end if;

  -- R4: el observer no recibe notificaciones.
  if exists (select 1 from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
              where profile_id = 'dcc00000-0000-4000-8000-000000000005') then
    raise exception 'FAIL [R4]: el director OBSERVER no deberia recibir el chat';
  end if;

  -- R5a: membership cerrada → fuera, aunque siga vinculada a un jugador del roster.
  if exists (select 1 from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
              where profile_id = 'dcc00000-0000-4000-8000-000000000007') then
    raise exception 'FAIL [R5a]: un miembro DE BAJA no deberia recibir el chat';
  end if;

  -- R5b: el jugador que se fue del roster no arrastra a su tutor. COACH sigue
  -- saliendo (es staff), pero por la rama de staff, no por la de familia.
  select audience into v_papel from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
   where profile_id = 'dcc00000-0000-4000-8000-000000000001';
  if v_papel is distinct from 'staff' then
    raise exception 'FAIL [R5b]: COACH deberia seguir siendo staff y es %', coalesce(v_papel, '<no sale>');
  end if;

  -- R5c: el vinculo de staff CERRADO (en el team B) no mete a nadie en el A.
  if exists (select 1 from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000b')
              where profile_id = 'dcc00000-0000-4000-8000-000000000003'
                and audience = 'staff') then
    raise exception 'FAIL [R5c]: un team_staff cerrado no deberia dar el papel de staff';
  end if;

  -- Y el total: COACH, COAPA, DIR, DIRPA, TUTOR. Ni OBS ni BAJA.
  select count(*) into v_filas from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a');
  if v_filas <> 5 then
    raise exception 'FAIL [R1d]: el chat deberia tener 5 destinatarios y tiene %', v_filas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R6: el MISMO grupo que la función hermana
-- ─────────────────────────────────────────────────────────────────────────────
-- Si las dos se separan, el push se manda a gente distinta de la que lee el chat —y
-- sería mudo: nadie se entera hasta que alguien echa de menos un aviso. Se comprueba
-- la diferencia simétrica en los dos sentidos.
do $$
declare v_sobran int; v_faltan int;
begin
  select count(*) into v_sobran from (
    select profile_id from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
    except
    select x from public.team_chat_member_profile_ids('ccc00000-0000-4000-8000-00000000000a') x
  ) d;
  select count(*) into v_faltan from (
    select x from public.team_chat_member_profile_ids('ccc00000-0000-4000-8000-00000000000a') x
    except
    select profile_id from public.team_chat_member_roles('ccc00000-0000-4000-8000-00000000000a')
  ) d;
  if v_sobran <> 0 then
    raise exception 'FAIL [R6a]: % perfiles salen con papel pero NO en la funcion hermana', v_sobran;
  end if;
  if v_faltan <> 0 then
    raise exception 'FAIL [R6b]: % perfiles estan en la funcion hermana y se quedan SIN papel', v_faltan;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R7: ACL
-- ─────────────────────────────────────────────────────────────────────────────
-- Se pregunta por el privilegio (has_function_privilege) en vez de provocar el
-- 42501: un error de permisos dentro de la transaccion la abortaria entera.
do $$
begin
  if has_function_privilege('anon', 'public.team_chat_member_roles(uuid)', 'execute') then
    raise exception 'FAIL [R7a]: anon NO deberia poder ejecutar team_chat_member_roles';
  end if;
  if not has_function_privilege('authenticated', 'public.team_chat_member_roles(uuid)', 'execute') then
    raise exception 'FAIL [R7b]: authenticated SI deberia poder ejecutar team_chat_member_roles';
  end if;
  if not has_function_privilege('service_role', 'public.team_chat_member_roles(uuid)', 'execute') then
    raise exception 'FAIL [R7c]: service_role SI deberia poder ejecutar team_chat_member_roles';
  end if;
end $$;

rollback;

select 'OK team_chat_member_roles' as result;
