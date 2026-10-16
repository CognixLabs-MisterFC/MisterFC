-- El aviso de GOL nace en la base (mig 20261126000000_el_gol_avisa_venga_de_donde_venga).
--
-- Lo que se mide:
--   [0] PREMISA: el trigger existe y el fixture tiene seguidores. Sin esto, un «0
--       avisos» podria ser verde por vacio.
--   [1] Gol propio con el directo LIVE y el reloj cerca → una fila in_app y una push
--       por seguidor, con la clave de dedupe EXACTA de emitNotificationFanOut
--       (`goal:<id>:<profile>:<canal>`), y NI UNA para el que graba.
--   [2] El payload lleva los INGREDIENTES y no la frase: event_id, team_id,
--       deep_link, own, rival, team_name, opponent_name. Y el marcador es el de
--       DESPUES del gol.
--   [3] FRESCURA: gol subido tarde (reloj 200 s por delante del gol) → campana SI,
--       push NO. Es el caso de la cola offline.
--   [4] El partido no esta en live (closed) → campana SI, push NO.
--   [5] Delta NEGATIVO (gol por delante del reloj: ajuste hacia atras) → fresco.
--   [6] La rama del reloj CORRIENDO tambien mide (periodo running, no congelado).
--   [7] El gol del RIVAL avisa igual (la familia quiere todos los goles).
--   [8] Penalti MARCADO avisa; penalti FALLADO no.
--   [9] Tarjeta, cambio y `shootout_penalty` no avisan (el WHEN del trigger).
--  [10] Los seguidores de OTRO equipo no reciben nada.
--  [11] El marcador cuenta goles + penaltis marcados y NO la tanda.
--  [12] Dedupe: con la fila ya puesta, el trigger no duplica ni falla.
--  [13] BEST-EFFORT: si escribir avisos falla, EL GOL SE REGISTRA IGUAL. Se fuerza
--       con un CHECK temporal sobre notifications (control positivo del savepoint).
--  [14] Un partido SIN seguidores: el gol entra y hay 0 avisos.
--
-- Estilo del repo: psql con ON_ERROR_STOP=1, aserciones con `raise exception`,
-- todo en una transaccion con ROLLBACK final.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('90100000-0000-4000-8000-000000000001', 'Club Gol', 'club-gol');

insert into public.categories (id, club_id, name) values
  ('90d00000-0000-4000-8000-000000000001', '90100000-0000-4000-8000-000000000001', 'Cadete');

insert into public.teams (id, category_id, name, format, color, season) values
  ('90e10000-0000-4000-8000-000000000001', '90d00000-0000-4000-8000-000000000001', 'Cadete A', 'F11', '#0EA5E9', '2026-27'),
  ('90e10000-0000-4000-8000-000000000002', '90d00000-0000-4000-8000-000000000001', 'Cadete B', 'F11', '#F59E0B', '2026-27');

-- 1 entrenador (graba) · 2 y 3 seguidores del equipo · 4 seguidor de OTRO equipo
select pg_temp.new_test_user('90a00000-0000-4000-8000-000000000001', 'coach@gol.test',  '{}'::jsonb);
select pg_temp.new_test_user('90a00000-0000-4000-8000-000000000002', 'madre@gol.test',  '{}'::jsonb);
select pg_temp.new_test_user('90a00000-0000-4000-8000-000000000003', 'abuelo@gol.test', '{}'::jsonb);
select pg_temp.new_test_user('90a00000-0000-4000-8000-000000000004', 'otro@gol.test',   '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('90550000-0000-4000-8000-000000000001', '90a00000-0000-4000-8000-000000000001', '90100000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('90550000-0000-4000-8000-000000000002', '90a00000-0000-4000-8000-000000000002', '90100000-0000-4000-8000-000000000001', 'jugador'),
  ('90550000-0000-4000-8000-000000000003', '90a00000-0000-4000-8000-000000000003', '90100000-0000-4000-8000-000000000001', 'jugador'),
  ('90550000-0000-4000-8000-000000000004', '90a00000-0000-4000-8000-000000000004', '90100000-0000-4000-8000-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('90e10000-0000-4000-8000-000000000001', '90550000-0000-4000-8000-000000000001', 'entrenador_principal');

-- SEGUIDORES: madre y abuelo siguen al Cadete A; el coach TAMBIEN lo sigue (y por
-- eso no debe recibir su propio aviso); `otro` sigue al Cadete B.
insert into public.team_follows (profile_id, team_id) values
  ('90a00000-0000-4000-8000-000000000002', '90e10000-0000-4000-8000-000000000001'),
  ('90a00000-0000-4000-8000-000000000003', '90e10000-0000-4000-8000-000000000001'),
  ('90a00000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000001'),
  ('90a00000-0000-4000-8000-000000000004', '90e10000-0000-4000-8000-000000000002');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('90c00000-0000-4000-8000-000000000001', '90100000-0000-4000-8000-000000000001', 'Pau', 'Uno', '2011-01-01');

insert into public.team_members (player_id, team_id, joined_at) values
  ('90c00000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000001', '2026-08-01');

-- PARTIDO A: el de los casos normales (live, reloj congelado en 300 s).
-- PARTIDO B: cerrado. PARTIDO C: live con el reloj CORRIENDO. PARTIDO D: sin seguidores.
insert into public.events (id, club_id, team_id, type, title, starts_at, opponent_name, created_by) values
  ('90ee0000-0000-4000-8000-00000000000a', '90100000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000001', 'match', 'Jornada 1', '2026-10-24 08:00:00+00', 'CD Rival', '90a00000-0000-4000-8000-000000000001'),
  ('90ee0000-0000-4000-8000-00000000000b', '90100000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000001', 'match', 'Jornada 2', '2026-10-31 08:00:00+00', 'CD Otro',  '90a00000-0000-4000-8000-000000000001'),
  ('90ee0000-0000-4000-8000-00000000000c', '90100000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000001', 'match', 'Jornada 3', '2026-11-07 08:00:00+00', 'CD Tres',  '90a00000-0000-4000-8000-000000000001'),
  ('90ee0000-0000-4000-8000-00000000000d', '90100000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000002', 'match', 'Jornada B', '2026-10-24 10:00:00+00', 'CD Bravo', '90a00000-0000-4000-8000-000000000001'),
  ('90ee0000-0000-4000-8000-00000000000e', '90100000-0000-4000-8000-000000000001', '90e10000-0000-4000-8000-000000000001', 'match', 'Jornada 4', '2026-11-14 08:00:00+00', 'CD Cuatro', '90a00000-0000-4000-8000-000000000001');

insert into public.match_state (event_id, club_id, status) values
  ('90ee0000-0000-4000-8000-00000000000a', '90100000-0000-4000-8000-000000000001', 'live'),
  ('90ee0000-0000-4000-8000-00000000000b', '90100000-0000-4000-8000-000000000001', 'closed'),
  ('90ee0000-0000-4000-8000-00000000000c', '90100000-0000-4000-8000-000000000001', 'live'),
  ('90ee0000-0000-4000-8000-00000000000d', '90100000-0000-4000-8000-000000000001', 'live'),
  ('90ee0000-0000-4000-8000-00000000000e', '90100000-0000-4000-8000-000000000001', 'live');

-- Relojes. A y B: CONGELADOS en 300 s (nada corriendo) → el test no depende del
-- tiempo real. C: corriendo desde hace 10 s. D: congelado en 300.
insert into public.match_periods (event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended) values
  ('90ee0000-0000-4000-8000-00000000000a', 'first_half', 1, 0, 300, false, null, true),
  ('90ee0000-0000-4000-8000-00000000000b', 'first_half', 1, 0, 300, false, null, true),
  ('90ee0000-0000-4000-8000-00000000000c', 'first_half', 1, 0, 0, true, now() - interval '10 seconds', false),
  ('90ee0000-0000-4000-8000-00000000000d', 'first_half', 1, 0, 300, false, null, true),
  -- E: CORRIENDO desde hace 200 s y con `accumulated` a 0. Es el unico fixture que
  -- distingue si la formula suma el tiempo transcurrido del periodo en marcha.
  ('90ee0000-0000-4000-8000-00000000000e', 'first_half', 1, 0, 0, true, now() - interval '200 seconds', false);

-- Helpers de conteo.
create or replace function pg_temp.avisos(p_gol uuid, p_canal text)
returns bigint language sql as $$
  select count(*) from public.notifications n
   where n.type = 'goal'::public.notification_type
     and n.channel = p_canal::public.notification_channel
     and n.dedupe_key like 'goal:' || p_gol::text || ':%';
$$;

create or replace function pg_temp.gol(
  p_event uuid, p_id uuid, p_clock integer, p_type text default 'goal',
  p_side text default 'own', p_outcome text default null
) returns void language sql as $$
  insert into public.match_events
    (id, event_id, club_id, side, type, player_id, rival_dorsal, clock_seconds, period, created_by, metadata)
  values
    (p_id, p_event, '90100000-0000-4000-8000-000000000001', p_side, p_type,
     case when p_side = 'own' then '90c00000-0000-4000-8000-000000000001'::uuid else null end,
     case when p_side = 'rival' then 9 else null end,
     p_clock, 'first_half', '90a00000-0000-4000-8000-000000000001',
     case when p_outcome is null then '{}'::jsonb else jsonb_build_object('outcome', p_outcome) end);
$$;

-- ── [0] PREMISA ──────────────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from pg_trigger
   where tgname = 'trg_notify_goal' and tgrelid = 'public.match_events'::regclass and not tgisinternal;
  if v_n <> 1 then raise exception '[0] premisa: el trigger trg_notify_goal no esta instalado (%)', v_n; end if;

  select count(*) into v_n from public.team_follows
   where team_id = '90e10000-0000-4000-8000-000000000001';
  if v_n <> 3 then raise exception '[0] premisa: esperaba 3 seguidores del Cadete A (madre, abuelo, coach), hay %', v_n; end if;
end $$;

-- ── [1] gol fresco en live: campana + push a los seguidores MENOS el que graba ──
do $$
declare v_in bigint; v_push bigint; v_clave text;
begin
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-000000000001', 250);

  select pg_temp.avisos('90f00000-0000-4000-8000-000000000001', 'in_app') into v_in;
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000001', 'push')   into v_push;
  if v_in <> 2 then raise exception '[1] esperaba 2 campanas (madre y abuelo), hay %', v_in; end if;
  if v_push <> 2 then raise exception '[1] esperaba 2 push, hay %', v_push; end if;

  if exists (select 1 from public.notifications
              where dedupe_key like 'goal:90f00000-0000-4000-8000-000000000001:%'
                and user_id = '90a00000-0000-4000-8000-000000000001') then
    raise exception '[1] el que graba el gol NO puede recibir su propio aviso';
  end if;

  -- La clave, caracter a caracter (es la que compone emitNotificationFanOut).
  v_clave := 'goal:90f00000-0000-4000-8000-000000000001:90a00000-0000-4000-8000-000000000002:push';
  if not exists (select 1 from public.notifications where dedupe_key = v_clave) then
    raise exception '[1] falta la clave de dedupe exacta: %', v_clave;
  end if;
end $$;

-- ── [2] el payload lleva los INGREDIENTES, y el marcador es el de despues ────
do $$
declare p jsonb;
begin
  select payload into p from public.notifications
   where dedupe_key = 'goal:90f00000-0000-4000-8000-000000000001:90a00000-0000-4000-8000-000000000002:push';
  if (p->>'event_id') is distinct from '90ee0000-0000-4000-8000-00000000000a' then
    raise exception '[2] event_id del payload: %', p->>'event_id'; end if;
  if (p->>'team_id') is distinct from '90e10000-0000-4000-8000-000000000001' then
    raise exception '[2] team_id del payload: %', p->>'team_id'; end if;
  if (p->>'deep_link') is distinct from '/es/directos/90ee0000-0000-4000-8000-00000000000a' then
    raise exception '[2] deep_link del payload: %', p->>'deep_link'; end if;
  if (p->>'own')::int <> 1 or (p->>'rival')::int <> 0 then
    raise exception '[2] marcador del payload: % - %', p->>'own', p->>'rival'; end if;
  if (p->>'team_name') is distinct from 'Cadete A' then
    raise exception '[2] team_name del payload: %', p->>'team_name'; end if;
  if (p->>'opponent_name') is distinct from 'CD Rival' then
    raise exception '[2] opponent_name del payload: %', p->>'opponent_name'; end if;
  -- Y lo que NO lleva: la frase se arma en TS (formatGoalPush).
  if p ? 'title' or p ? 'body' then
    raise exception '[2] el payload no debe llevar la frase hecha: %', p; end if;
end $$;

-- ── [3] FRESCURA: gol subido tarde → campana si, push no ─────────────────────
do $$
declare v_in bigint; v_push bigint;
begin
  -- reloj congelado en 300; gol en el segundo 100 → delta 200 > 120.
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-000000000002', 100);
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000002', 'in_app') into v_in;
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000002', 'push')   into v_push;
  if v_in <> 2 then raise exception '[3] la campana queda igual: esperaba 2, hay %', v_in; end if;
  if v_push <> 0 then raise exception '[3] un gol subido tarde NO manda push: hay %', v_push; end if;
end $$;

-- ── [4] partido cerrado → campana si, push no ────────────────────────────────
do $$
declare v_in bigint; v_push bigint;
begin
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000b', '90f00000-0000-4000-8000-000000000003', 299);
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000003', 'in_app') into v_in;
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000003', 'push')   into v_push;
  if v_in <> 2 then raise exception '[4] esperaba 2 campanas, hay %', v_in; end if;
  if v_push <> 0 then raise exception '[4] un partido cerrado NO manda push: hay %', v_push; end if;
end $$;

-- ── [5] delta NEGATIVO (gol por delante del reloj) → fresco ──────────────────
do $$
declare v_push bigint;
begin
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-000000000004', 900);
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000004', 'push') into v_push;
  if v_push <> 2 then raise exception '[5] un gol por delante del reloj es fresco: esperaba 2 push, hay %', v_push; end if;
end $$;

-- ── [6] la rama del reloj CORRIENDO tambien mide ─────────────────────────────
do $$
declare v_push bigint;
begin
  -- Partido C: corriendo desde hace 10 s (reloj ~10). Gol en el 5 → fresco.
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000c', '90f00000-0000-4000-8000-000000000005', 5);
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000005', 'push') into v_push;
  if v_push <> 2 then raise exception '[6] con el reloj corriendo y el gol a 5 s: esperaba 2 push, hay %', v_push; end if;

  -- Y LA QUE MIDE LA RAMA: partido E, corriendo desde hace 200 s con `accumulated`
  -- a 0. El gol esta en el segundo 0, asi que el delta es ~200 > 120 → RANCIO. Si la
  -- formula no sumara `now() - last_started_at`, el reloj seria 0, el delta 0 y este
  -- gol saldria fresco: esta es la unica asercion que se pone roja si se quita esa
  -- rama (en el partido C, con 10 s, quitarla no cambia el veredicto).
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000e', '90f00000-0000-4000-8000-000000000006', 0);
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000006', 'push') into v_push;
  if v_push <> 0 then raise exception '[6b] con el reloj corriendo 200 s, un gol del segundo 0 es rancio: hay % push', v_push; end if;
end $$;

-- ── [7] el gol del RIVAL avisa igual ────────────────────────────────────────
do $$
declare v_push bigint;
begin
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-000000000007', 280, 'goal', 'rival');
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000007', 'push') into v_push;
  if v_push <> 2 then raise exception '[7] el gol del rival tambien avisa: esperaba 2 push, hay %', v_push; end if;
end $$;

-- ── [8] penalti MARCADO avisa; FALLADO no ───────────────────────────────────
do $$
declare v_push bigint;
begin
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-000000000008', 285, 'penalty', 'own', 'scored');
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000008', 'push') into v_push;
  if v_push <> 2 then raise exception '[8] penalti marcado: esperaba 2 push, hay %', v_push; end if;

  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-000000000009', 286, 'penalty', 'own', 'missed');
  select pg_temp.avisos('90f00000-0000-4000-8000-000000000009', 'in_app') into v_push;
  if v_push <> 0 then raise exception '[8] penalti FALLADO no avisa: hay % avisos', v_push; end if;
end $$;

-- ── [9] tarjeta, cambio y tanda no avisan ───────────────────────────────────
do $$
declare v_n bigint;
begin
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-00000000000a', 287, 'yellow_card');
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-00000000000b', 288, 'shootout_penalty', 'own', 'scored');
  select pg_temp.avisos('90f00000-0000-4000-8000-00000000000a', 'in_app')
       + pg_temp.avisos('90f00000-0000-4000-8000-00000000000a', 'push')
       + pg_temp.avisos('90f00000-0000-4000-8000-00000000000b', 'in_app')
       + pg_temp.avisos('90f00000-0000-4000-8000-00000000000b', 'push') into v_n;
  if v_n <> 0 then raise exception '[9] tarjeta y tanda no avisan: hay % avisos', v_n; end if;
end $$;

-- ── [10] los seguidores de OTRO equipo no reciben ───────────────────────────
do $$
begin
  if exists (select 1 from public.notifications
              where type = 'goal'::public.notification_type
                and user_id = '90a00000-0000-4000-8000-000000000004') then
    raise exception '[10] el seguidor del Cadete B no puede recibir goles del Cadete A';
  end if;
end $$;

-- ── [11] el marcador cuenta goles + penaltis marcados y NO la tanda ─────────
do $$
declare p jsonb;
begin
  -- Goles del partido A hasta aqui, en orden: [1] own, [3] own (rancio pero gol),
  -- [5] own, [7] RIVAL, [8] penalti own MARCADO, y el de este bloque → own = 5.
  -- No cuentan: el penalti FALLADO [8b], la tarjeta [9] ni la tanda [9b].
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-00000000000c', 290);
  select payload into p from public.notifications
   where dedupe_key = 'goal:90f00000-0000-4000-8000-00000000000c:90a00000-0000-4000-8000-000000000002:push';
  if (p->>'own')::int <> 5 then raise exception '[11] propios: esperaba 5, el payload dice %', p->>'own'; end if;
  if (p->>'rival')::int <> 1 then raise exception '[11] rival: esperaba 1, el payload dice %', p->>'rival'; end if;
end $$;

-- ── [12] dedupe: con la fila ya puesta, no duplica ni falla ─────────────────
do $$
declare v_in bigint;
begin
  insert into public.notifications (user_id, type, channel, payload, dedupe_key) values
    ('90a00000-0000-4000-8000-000000000002', 'goal'::public.notification_type,
     'in_app'::public.notification_channel, '{"puesta":"a mano"}'::jsonb,
     'goal:90f00000-0000-4000-8000-00000000000d:90a00000-0000-4000-8000-000000000002:in_app');

  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-00000000000d', 292);

  select pg_temp.avisos('90f00000-0000-4000-8000-00000000000d', 'in_app') into v_in;
  if v_in <> 2 then raise exception '[12] esperaba 2 campanas (una ya estaba), hay %', v_in; end if;
  if not exists (select 1 from public.match_events where id = '90f00000-0000-4000-8000-00000000000d') then
    raise exception '[12] el gol tiene que haberse registrado';
  end if;
end $$;

-- ── [13] BEST-EFFORT: si avisar falla, el gol se registra igual ─────────────
do $$
declare v_n bigint;
begin
  -- Control positivo del savepoint: se prohibe escribir avisos de gol.
  -- NOT VALID a proposito: en esta transaccion ya hay avisos de gol escritos, asi que
  -- un CHECK validado no se podria anadir. `not valid` no mira las filas viejas pero
  -- SI bloquea los INSERT nuevos, que es justo lo que hace falta.
  alter table public.notifications add constraint tmp_no_goles
    check (type <> 'goal'::public.notification_type) not valid;

  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000a', '90f00000-0000-4000-8000-00000000000e', 295);

  if not exists (select 1 from public.match_events where id = '90f00000-0000-4000-8000-00000000000e') then
    raise exception '[13] EL GOL SE PERDIO al fallar el aviso: el savepoint no protege';
  end if;
  select pg_temp.avisos('90f00000-0000-4000-8000-00000000000e', 'in_app')
       + pg_temp.avisos('90f00000-0000-4000-8000-00000000000e', 'push') into v_n;
  if v_n <> 0 then raise exception '[13] con el CHECK puesto no puede haber avisos, hay %', v_n; end if;

  alter table public.notifications drop constraint tmp_no_goles;
end $$;

-- ── [14] partido sin seguidores: el gol entra y hay 0 avisos ────────────────
do $$
declare v_n bigint;
begin
  -- Partido D es del Cadete B, cuyo unico seguidor es `otro`... que NO graba. Para
  -- medir el caso «sin nadie» se quita su fila antes.
  delete from public.team_follows where team_id = '90e10000-0000-4000-8000-000000000002';
  perform pg_temp.gol('90ee0000-0000-4000-8000-00000000000d', '90f00000-0000-4000-8000-00000000000f', 299, 'goal', 'rival');
  if not exists (select 1 from public.match_events where id = '90f00000-0000-4000-8000-00000000000f') then
    raise exception '[14] el gol no se registro en un partido sin seguidores';
  end if;
  select pg_temp.avisos('90f00000-0000-4000-8000-00000000000f', 'in_app')
       + pg_temp.avisos('90f00000-0000-4000-8000-00000000000f', 'push') into v_n;
  if v_n <> 0 then raise exception '[14] esperaba 0 avisos, hay %', v_n; end if;
end $$;

select 'el_gol_avisa_venga_de_donde_venga OK' as resultado;

rollback;
