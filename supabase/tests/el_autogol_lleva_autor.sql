-- El AUTOGOL lleva autor (mig 20261128000000_el_autogol_es_del_rival_con_autor_nuestro).
--
-- Lo que se mide:
--   [0] PREMISA: el constraint existe Y un gol NUESTRO con este jugador entra bien.
--       No es adorno: `match_assert_player_in_team` levanta `check_violation` igual
--       que el CHECK, asi que con un fixture mal montado (jugador fuera del roster
--       en la fecha del partido) TODOS los bloques negativos de abajo pasarian por
--       el motivo equivocado. Este aserto es lo que distingue los dos rojos.
--   [1] AUTOGOL: side='rival' + type='goal' + player_id NUESTRO, sin dorsal → OK,
--       y la fila queda guardada con su autor.
--   [2] Cuenta para el RIVAL y no para nosotros (el conteo por bando que hacen
--       `computeScore` y `notify_goal`): propios 1, rival 1.
--   [3] El gol del rival de toda la vida (por dorsal) sigue entrando.
--   [4] Autogol CON dorsal ademas del jugador → rechazado: no hay dos autores.
--   [5] TARJETA del rival con jugador nuestro → sigue rechazada. La forma nueva se
--       abre SOLO para `goal`; este es el otro lado de la frontera.
--   [6] PENALTI del rival con jugador nuestro → rechazado (mismo motivo que [5]).
--   [7] side='own' con rival_dorsal → sigue rechazado: el drop/add no ensancho la
--       forma 1 de paso.
--   [8] side='rival' con related_player_id → sigue rechazado (eso es de la
--       sustitucion, y la sustitucion es nuestra).
--   [9] El autogol AVISA, y con el marcador del rival: `notify_goal` crea la fila
--       de push con rival=1 en el payload. Mide la afirmacion de la migracion
--       —«los triggers se enteran solos»— en vez de dejarla escrita en prosa.
--  [10] Borrar el autogol retira sus push pendientes: el WHEN de
--       `trg_unnotify_deleted_goal` (old.type='goal') tampoco necesita enterarse.
--
-- Estilo del repo: psql con ON_ERROR_STOP=1, aserciones con `raise exception`,
-- todo en una transaccion con ROLLBACK final.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('92100000-0000-4000-8000-000000000001', 'Club Propia', 'club-propia');

insert into public.categories (id, club_id, name) values
  ('92d00000-0000-4000-8000-000000000001', '92100000-0000-4000-8000-000000000001', 'Alevin');

insert into public.teams (id, category_id, name, format, color, season) values
  ('92e10000-0000-4000-8000-000000000001', '92d00000-0000-4000-8000-000000000001', 'Alevin A', 'F8', '#0EA5E9', '2026-27');

-- 1 entrenador (graba, no recibe aviso propio) · 2 seguidora.
select pg_temp.new_test_user('92a00000-0000-4000-8000-000000000001', 'coach@propia.test', '{}'::jsonb);
select pg_temp.new_test_user('92a00000-0000-4000-8000-000000000002', 'madre@propia.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('92550000-0000-4000-8000-000000000001', '92a00000-0000-4000-8000-000000000001', '92100000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('92550000-0000-4000-8000-000000000002', '92a00000-0000-4000-8000-000000000002', '92100000-0000-4000-8000-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('92e10000-0000-4000-8000-000000000001', '92550000-0000-4000-8000-000000000001', 'entrenador_principal');

insert into public.team_follows (profile_id, team_id) values
  ('92a00000-0000-4000-8000-000000000002', '92e10000-0000-4000-8000-000000000001');

-- El autor del autogol: central nuestro, en el roster el dia del partido.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('92c00000-0000-4000-8000-000000000001', '92100000-0000-4000-8000-000000000001', 'Marc', 'Central', '2014-01-01');

insert into public.team_members (player_id, team_id, joined_at) values
  ('92c00000-0000-4000-8000-000000000001', '92e10000-0000-4000-8000-000000000001', '2026-08-01');

insert into public.events (id, club_id, team_id, type, title, starts_at, opponent_name, created_by) values
  ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001', '92e10000-0000-4000-8000-000000000001', 'match', 'Jornada 1', '2026-10-24 08:00:00+00', 'CD Rival', '92a00000-0000-4000-8000-000000000001');

-- Directo EN MARCHA y reloj CONGELADO en 300 s: los goles entran frescos y
-- `notify_goal` les crea su fila de push. Asi [9] no depende del tiempo real.
insert into public.match_state (event_id, club_id, status) values
  ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001', 'live');

insert into public.match_periods (event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended) values
  ('92ee0000-0000-4000-8000-00000000000a', 'first_half', 1, 0, 300, false, null, true);

-- ── [0] PREMISA ──────────────────────────────────────────────────────────────
do $$
declare
  v_constraint integer;
  v_propios    integer;
begin
  select count(*) into v_constraint
    from pg_constraint
   where conname = 'match_events_actor_by_side'
     and conrelid = 'public.match_events'::regclass;
  if v_constraint <> 1 then
    raise exception 'FAIL [0]: esperaba 1 constraint match_events_actor_by_side, hay %', v_constraint;
  end if;

  -- Gol NUESTRO con este jugador: si esto no entra, el fixture esta mal y los
  -- rechazos de abajo no probarian nada.
  insert into public.match_events (id, event_id, club_id, created_by, side, type, player_id, period, clock_seconds, display_minute)
    values ('92f00000-0000-4000-8000-000000000001', '92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
            '92a00000-0000-4000-8000-000000000001', 'own', 'goal', '92c00000-0000-4000-8000-000000000001', 'first_half', 290, 5);

  select count(*) into v_propios
    from public.match_events
   where event_id = '92ee0000-0000-4000-8000-00000000000a' and side = 'own';
  if v_propios <> 1 then
    raise exception 'FAIL [0]: esperaba 1 gol propio sembrado, hay %', v_propios;
  end if;
  raise notice '[0] OK: constraint puesto y el jugador 92c0…01 es valido en este partido (1 gol propio).';
end $$;

-- ── [1] El AUTOGOL entra ─────────────────────────────────────────────────────
do $$
declare v_autor uuid;
begin
  insert into public.match_events (id, event_id, club_id, created_by, side, type, player_id, period, clock_seconds, display_minute)
    values ('92f00000-0000-4000-8000-000000000002', '92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
            '92a00000-0000-4000-8000-000000000001', 'rival', 'goal', '92c00000-0000-4000-8000-000000000001', 'first_half', 295, 5);

  select player_id into v_autor
    from public.match_events where id = '92f00000-0000-4000-8000-000000000002';
  if v_autor is distinct from '92c00000-0000-4000-8000-000000000001'::uuid then
    raise exception 'FAIL [1]: el autogol deberia guardar a su autor, guardo %', v_autor;
  end if;
  raise notice '[1] OK: autogol guardado con autor 92c0…01.';
exception when check_violation then
  raise exception 'FAIL [1]: el autogol (rival + goal + jugador nuestro) deberia permitirse: %', sqlerrm;
end $$;

-- ── [2] Cuenta para el RIVAL, no para nosotros ───────────────────────────────
do $$
declare
  v_own   integer;
  v_rival integer;
begin
  -- El mismo conteo por bando que hacen `computeScore` (TS) y `notify_goal` (SQL).
  select count(*) filter (where side = 'own'),
         count(*) filter (where side = 'rival')
    into v_own, v_rival
    from public.match_events
   where event_id = '92ee0000-0000-4000-8000-00000000000a'
     and (type = 'goal' or (type = 'penalty' and metadata->>'outcome' = 'scored'));
  if v_own <> 1 or v_rival <> 1 then
    raise exception 'FAIL [2]: esperaba marcador 1-1 (el autogol para el rival), salio %-%', v_own, v_rival;
  end if;
  raise notice '[2] OK: marcador 1-1 — el autogol suma al rival.';
end $$;

-- ── [3] El gol del rival por dorsal sigue entrando ───────────────────────────
do $$ begin
  insert into public.match_events (id, event_id, club_id, created_by, side, type, rival_dorsal, period, clock_seconds, display_minute)
    values ('92f00000-0000-4000-8000-000000000003', '92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
            '92a00000-0000-4000-8000-000000000001', 'rival', 'goal', 9, 'first_half', 600, 10);
  raise notice '[3] OK: gol del rival por dorsal, sin cambios.';
exception when check_violation then
  raise exception 'FAIL [3]: el gol del rival por dorsal deberia seguir permitiendose: %', sqlerrm;
end $$;

-- ── [4] Autogol CON dorsal → rechazado (no hay dos autores) ──────────────────
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, created_by, side, type, player_id, rival_dorsal, period, clock_seconds)
      values ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
              '92a00000-0000-4000-8000-000000000001', 'rival', 'goal', '92c00000-0000-4000-8000-000000000001', 7, 'first_half', 700);
    raise exception 'FAIL [4]: un gol rival con jugador NUESTRO y dorsal deberia rechazarse';
  exception when check_violation then
    raise notice '[4] OK: rechazado el autogol con dorsal.';
  end;
end $$;

-- ── [5] Tarjeta del rival con jugador nuestro → rechazada ────────────────────
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, created_by, side, type, player_id, period, clock_seconds)
      values ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
              '92a00000-0000-4000-8000-000000000001', 'rival', 'yellow_card', '92c00000-0000-4000-8000-000000000001', 'first_half', 800);
    raise exception 'FAIL [5]: una tarjeta del rival con jugador nuestro deberia rechazarse';
  exception when check_violation then
    raise notice '[5] OK: la forma nueva es SOLO para goal (tarjeta rechazada).';
  end;
end $$;

-- ── [6] Penalti del rival con jugador nuestro → rechazado ────────────────────
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, created_by, side, type, player_id, metadata, period, clock_seconds)
      values ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
              '92a00000-0000-4000-8000-000000000001', 'rival', 'penalty', '92c00000-0000-4000-8000-000000000001',
              '{"outcome":"scored"}'::jsonb, 'first_half', 900);
    raise exception 'FAIL [6]: un penalti del rival con jugador nuestro deberia rechazarse';
  exception when check_violation then
    raise notice '[6] OK: el penalti del rival sigue siendo por dorsal.';
  end;
end $$;

-- ── [7] side='own' con rival_dorsal → sigue rechazado ────────────────────────
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, created_by, side, type, rival_dorsal, period, clock_seconds)
      values ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
              '92a00000-0000-4000-8000-000000000001', 'own', 'goal', 9, 'first_half', 1000);
    raise exception 'FAIL [7]: own con rival_dorsal deberia seguir rechazandose';
  exception when check_violation then
    raise notice '[7] OK: la forma 1 (own sin dorsal) no se ensancho de paso.';
  end;
end $$;

-- ── [8] side='rival' con related_player_id → sigue rechazado ─────────────────
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, created_by, side, type, player_id, related_player_id, period, clock_seconds)
      values ('92ee0000-0000-4000-8000-00000000000a', '92100000-0000-4000-8000-000000000001',
              '92a00000-0000-4000-8000-000000000001', 'rival', 'goal', '92c00000-0000-4000-8000-000000000001',
              '92c00000-0000-4000-8000-000000000001', 'first_half', 1100);
    raise exception 'FAIL [8]: un evento del rival con related_player_id deberia rechazarse';
  exception when check_violation then
    raise notice '[8] OK: related_player_id sigue siendo solo de la sustitucion.';
  end;
end $$;

-- ── [9] El autogol AVISA, con el marcador del rival ──────────────────────────
do $$
declare
  v_push    integer;
  v_rival   text;
  v_own     text;
begin
  select count(*) into v_push
    from public.notifications
   where dedupe_key like 'goal:92f00000-0000-4000-8000-000000000002:%'
     and channel = 'push'
     and status = 'pending';
  if v_push <> 1 then
    raise exception 'FAIL [9]: esperaba 1 push pendiente del autogol (la seguidora), hay %', v_push;
  end if;

  select payload->>'own', payload->>'rival' into v_own, v_rival
    from public.notifications
   where dedupe_key like 'goal:92f00000-0000-4000-8000-000000000002:%'
     and channel = 'push'
   limit 1;
  if v_own <> '1' or v_rival <> '1' then
    raise exception 'FAIL [9]: el aviso del autogol deberia llevar 1-1, lleva %-%', v_own, v_rival;
  end if;
  raise notice '[9] OK: el autogol avisa (1 push pendiente) y el payload dice 1-1.';
end $$;

-- ── [10] Borrar el autogol retira sus push pendientes ────────────────────────
do $$
declare v_quedan integer;
begin
  delete from public.match_events where id = '92f00000-0000-4000-8000-000000000002';

  select count(*) into v_quedan
    from public.notifications
   where dedupe_key like 'goal:92f00000-0000-4000-8000-000000000002:%'
     and channel = 'push'
     and status = 'pending';
  if v_quedan <> 0 then
    raise exception 'FAIL [10]: tras borrar el autogol deberian quedar 0 push pendientes, quedan %', v_quedan;
  end if;
  raise notice '[10] OK: borrar el autogol se lleva su push pendiente.';
end $$;

rollback;
