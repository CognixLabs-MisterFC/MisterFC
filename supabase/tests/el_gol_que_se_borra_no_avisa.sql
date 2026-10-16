-- El gol que se BORRA no avisa (mig 20261127000000_el_gol_que_se_borra_no_avisa).
--
-- Lo que se mide:
--   [0] PREMISA: el trigger existe Y el fixture tiene avisos de push pendientes.
--       Sin esto, «no queda ninguno» seria verde por vacio.
--   [1] Borrar el gol retira sus filas de push PENDING (habia 2, quedan 0).
--   [2] La CAMPANA (in_app) se queda: el feed excluye el tipo goal, no miente a nadie.
--   [3] El push YA ENVIADO (status='sent') se queda: es el registro de lo que paso.
--   [4] Los avisos de OTRO gol no se tocan (los dos puntos del prefijo).
--   [5] Un aviso de OTRO TIPO con esa misma clave no se toca (el filtro type='goal').
--   [6] Borrar una TARJETA no retira nada: el WHEN del trigger no la coge. Se mide
--       con un aviso plantado a mano con la clave de la tarjeta.
--   [7] Un penalti MARCADO borrado tambien limpia (mismo WHEN que notify_goal).
--   [8] BEST-EFFORT: si retirar los avisos falla, EL GOL SE BORRA IGUAL (control
--       positivo del savepoint, con un trigger temporal que revienta).
--   [9] Borrar el PARTIDO entero (cascada events→match_events) limpia tambien.
--
-- Estilo del repo: psql con ON_ERROR_STOP=1, aserciones con `raise exception`,
-- todo en una transaccion con ROLLBACK final.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('91100000-0000-4000-8000-000000000001', 'Club Borra', 'club-borra');

insert into public.categories (id, club_id, name) values
  ('91d00000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'Infantil');

insert into public.teams (id, category_id, name, format, color, season) values
  ('91e10000-0000-4000-8000-000000000001', '91d00000-0000-4000-8000-000000000001', 'Infantil A', 'F11', '#0EA5E9', '2026-27');

-- 1 entrenador (graba) · 2 y 3 seguidores
select pg_temp.new_test_user('91a00000-0000-4000-8000-000000000001', 'coach@borra.test',  '{}'::jsonb);
select pg_temp.new_test_user('91a00000-0000-4000-8000-000000000002', 'madre@borra.test',  '{}'::jsonb);
select pg_temp.new_test_user('91a00000-0000-4000-8000-000000000003', 'abuelo@borra.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('91550000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('91550000-0000-4000-8000-000000000002', '91a00000-0000-4000-8000-000000000002', '91100000-0000-4000-8000-000000000001', 'jugador'),
  ('91550000-0000-4000-8000-000000000003', '91a00000-0000-4000-8000-000000000003', '91100000-0000-4000-8000-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('91e10000-0000-4000-8000-000000000001', '91550000-0000-4000-8000-000000000001', 'entrenador_principal');

insert into public.team_follows (profile_id, team_id) values
  ('91a00000-0000-4000-8000-000000000002', '91e10000-0000-4000-8000-000000000001'),
  ('91a00000-0000-4000-8000-000000000003', '91e10000-0000-4000-8000-000000000001');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('91c00000-0000-4000-8000-000000000001', '91100000-0000-4000-8000-000000000001', 'Nil', 'Uno', '2012-01-01');

insert into public.team_members (player_id, team_id, joined_at) values
  ('91c00000-0000-4000-8000-000000000001', '91e10000-0000-4000-8000-000000000001', '2026-08-01');

-- PARTIDO A: el de los casos normales. PARTIDO B: el que se borra entero en [9].
insert into public.events (id, club_id, team_id, type, title, starts_at, opponent_name, created_by) values
  ('91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', '91e10000-0000-4000-8000-000000000001', 'match', 'Jornada 1', '2026-10-24 08:00:00+00', 'CD Rival', '91a00000-0000-4000-8000-000000000001'),
  ('91ee0000-0000-4000-8000-00000000000b', '91100000-0000-4000-8000-000000000001', '91e10000-0000-4000-8000-000000000001', 'match', 'Jornada 2', '2026-10-31 08:00:00+00', 'CD Otro',  '91a00000-0000-4000-8000-000000000001');

insert into public.match_state (event_id, club_id, status) values
  ('91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', 'live'),
  ('91ee0000-0000-4000-8000-00000000000b', '91100000-0000-4000-8000-000000000001', 'live');

-- Relojes CONGELADOS en 300 s: los goles del fixture entran frescos y `notify_goal`
-- les crea su fila de push. Asi el test no depende del tiempo real.
insert into public.match_periods (event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, last_started_at, ended) values
  ('91ee0000-0000-4000-8000-00000000000a', 'first_half', 1, 0, 300, false, null, true),
  ('91ee0000-0000-4000-8000-00000000000b', 'first_half', 1, 0, 300, false, null, true);

-- ── Los goles. Los crea `notify_goal`, que es quien pone los avisos ──────────
-- GOL 1 (se borra en [1]) · GOL 2 (se queda, control de [4]) · TARJETA (control
-- de [6]) · PENALTI marcado (se borra en [7]) · GOL del partido B (para [9]).
insert into public.match_events (id, event_id, club_id, created_by, side, type, player_id, period, clock_seconds, display_minute, metadata) values
  ('91f00000-0000-4000-8000-000000000001', '91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', 'own', 'goal',        '91c00000-0000-4000-8000-000000000001', 'first_half', 290, 5, '{}'::jsonb),
  ('91f00000-0000-4000-8000-000000000002', '91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', 'own', 'goal',        '91c00000-0000-4000-8000-000000000001', 'first_half', 295, 5, '{}'::jsonb),
  ('91f00000-0000-4000-8000-000000000003', '91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', 'own', 'yellow_card', '91c00000-0000-4000-8000-000000000001', 'first_half', 296, 5, '{}'::jsonb),
  ('91f00000-0000-4000-8000-000000000004', '91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', 'own', 'penalty',     '91c00000-0000-4000-8000-000000000001', 'first_half', 298, 5, '{"outcome":"scored"}'::jsonb),
  ('91f00000-0000-4000-8000-00000000000b', '91ee0000-0000-4000-8000-00000000000b', '91100000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', 'own', 'goal',        '91c00000-0000-4000-8000-000000000001', 'first_half', 290, 5, '{}'::jsonb);

-- Avisos plantados a mano, los que `notify_goal` no crea:
--   · uno de OTRO TIPO con la clave del GOL 1 → control del filtro type='goal' [5].
--   · uno con la clave de la TARJETA → control del WHEN [6]. Si el trigger se
--     disparara con una tarjeta, este desapareceria.
insert into public.notifications (user_id, type, channel, payload, dedupe_key) values
  ('91a00000-0000-4000-8000-000000000002', 'new_message'::public.notification_type, 'push'::public.notification_channel, '{}'::jsonb,
   'goal:91f00000-0000-4000-8000-000000000001:91a00000-0000-4000-8000-000000000002:push:ajeno'),
  ('91a00000-0000-4000-8000-000000000002', 'goal'::public.notification_type, 'push'::public.notification_channel, '{}'::jsonb,
   'goal:91f00000-0000-4000-8000-000000000003:91a00000-0000-4000-8000-000000000002:push');

-- Y uno del GOL 2 marcado como YA ENVIADO, para [3]. `notify_goal` creo dos
-- (madre y abuelo); a la madre se le marca enviado.
update public.notifications
   set status = 'sent', sent_at = now()
 where dedupe_key = 'goal:91f00000-0000-4000-8000-000000000002:91a00000-0000-4000-8000-000000000002:push';

-- ── [0] PREMISA ──────────────────────────────────────────────────────────────
do $$
declare
  v_trigger integer;
  v_push_gol1 integer;
  v_campana_gol1 integer;
begin
  select count(*) into v_trigger
    from pg_trigger
   where tgname = 'trg_unnotify_deleted_goal'
     and tgrelid = 'public.match_events'::regclass
     and not tgisinternal;
  if v_trigger <> 1 then
    raise exception '[0] esperaba 1 trigger trg_unnotify_deleted_goal, hay %', v_trigger;
  end if;

  select count(*) into v_push_gol1
    from public.notifications
   where channel = 'push' and type = 'goal' and status = 'pending'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000001:%';
  if v_push_gol1 <> 2 then
    raise exception '[0] el fixture tenia que dejar 2 push pendientes del gol 1, hay %', v_push_gol1;
  end if;

  select count(*) into v_campana_gol1
    from public.notifications
   where channel = 'in_app'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000001:%';
  if v_campana_gol1 <> 2 then
    raise exception '[0] esperaba 2 campanas del gol 1, hay %', v_campana_gol1;
  end if;

  raise notice '[0] premisa OK: 1 trigger, 2 push pendientes y 2 campanas del gol 1';
end;
$$;

-- ── [1] Borrar el gol retira sus push PENDING ────────────────────────────────
delete from public.match_events where id = '91f00000-0000-4000-8000-000000000001';

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notifications
   where channel = 'push' and type = 'goal'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000001:%';
  if v_n <> 0 then
    raise exception '[1] quedan % avisos de push del gol borrado', v_n;
  end if;
  raise notice '[1] OK: los 2 push pendientes del gol borrado se retiraron';
end;
$$;

-- ── [2] La campana se queda ──────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notifications
   where channel = 'in_app'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000001:%';
  if v_n <> 2 then
    raise exception '[2] esperaba 2 campanas intactas, hay %', v_n;
  end if;
  raise notice '[2] OK: la campana del gol borrado sigue (el feed excluye goal)';
end;
$$;

-- ── [5] El aviso de OTRO TIPO con esa clave sigue ────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notifications
   where type = 'new_message'
     and dedupe_key = 'goal:91f00000-0000-4000-8000-000000000001:91a00000-0000-4000-8000-000000000002:push:ajeno';
  if v_n <> 1 then
    raise exception '[5] el delete se llevo un aviso de otro tipo (type=new_message)';
  end if;
  raise notice '[5] OK: el filtro type=goal protege a los avisos de otro tipo';
end;
$$;

-- ── [3] y [4] El gol 2 conserva lo suyo: el enviado y el pendiente ───────────
do $$
declare
  v_enviado integer;
  v_pendiente integer;
begin
  select count(*) into v_enviado
    from public.notifications
   where channel = 'push' and status = 'sent'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000002:%';
  if v_enviado <> 1 then
    raise exception '[3] esperaba 1 push ENVIADO del gol 2, hay %', v_enviado;
  end if;

  select count(*) into v_pendiente
    from public.notifications
   where channel = 'push' and status = 'pending'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000002:%';
  if v_pendiente <> 1 then
    raise exception '[4] esperaba 1 push pendiente del gol 2 (no se toca), hay %', v_pendiente;
  end if;

  raise notice '[3][4] OK: el gol 2 conserva su enviado y su pendiente';
end;
$$;

-- ── [6] Borrar una TARJETA no retira nada (el WHEN) ──────────────────────────
delete from public.match_events where id = '91f00000-0000-4000-8000-000000000003';

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notifications
   where dedupe_key = 'goal:91f00000-0000-4000-8000-000000000003:91a00000-0000-4000-8000-000000000002:push';
  if v_n <> 1 then
    raise exception '[6] borrar una tarjeta retiro un aviso: el WHEN del trigger la coge';
  end if;
  raise notice '[6] OK: borrar una tarjeta no dispara el trigger';
end;
$$;

-- ── [7] Un penalti MARCADO borrado tambien limpia ────────────────────────────
do $$
declare v_antes integer;
begin
  select count(*) into v_antes
    from public.notifications
   where channel = 'push' and type = 'goal' and status = 'pending'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000004:%';
  if v_antes <> 2 then
    raise exception '[7] premisa: esperaba 2 push pendientes del penalti, hay %', v_antes;
  end if;
end;
$$;

delete from public.match_events where id = '91f00000-0000-4000-8000-000000000004';

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notifications
   where channel = 'push' and type = 'goal'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000004:%';
  if v_n <> 0 then
    raise exception '[7] quedan % avisos del penalti marcado borrado', v_n;
  end if;
  raise notice '[7] OK: el penalti marcado limpia igual que un gol';
end;
$$;

-- ── [9] Borrar el PARTIDO entero (cascada) limpia tambien ────────────────────
do $$
declare v_antes integer;
begin
  select count(*) into v_antes
    from public.notifications
   where channel = 'push' and type = 'goal' and status = 'pending'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-00000000000b:%';
  if v_antes <> 2 then
    raise exception '[9] premisa: esperaba 2 push pendientes del gol del partido B, hay %', v_antes;
  end if;
end;
$$;

delete from public.events where id = '91ee0000-0000-4000-8000-00000000000b';

do $$
declare v_n integer;
begin
  select count(*) into v_n
    from public.notifications
   where channel = 'push' and type = 'goal'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-00000000000b:%';
  if v_n <> 0 then
    raise exception '[9] borrar el partido dejo % avisos del gol en cascada', v_n;
  end if;
  raise notice '[9] OK: la cascada events→match_events tambien retira los avisos';
end;
$$;

-- ── [8] BEST-EFFORT: si retirar los avisos falla, el gol se borra IGUAL ──────
-- Control POSITIVO del savepoint: un trigger temporal sobre notifications que
-- revienta en cualquier DELETE. Sin el `exception when others` de la funcion, este
-- bloque dejaria el gol sin borrar.
insert into public.match_events (id, event_id, club_id, created_by, side, type, player_id, period, clock_seconds, display_minute, metadata) values
  ('91f00000-0000-4000-8000-000000000005', '91ee0000-0000-4000-8000-00000000000a', '91100000-0000-4000-8000-000000000001', '91a00000-0000-4000-8000-000000000001', 'own', 'goal', '91c00000-0000-4000-8000-000000000001', 'first_half', 299, 5, '{}'::jsonb);

-- La funcion va en `public` y no en `pg_temp` a proposito: un trigger sobre una
-- tabla PERMANENTE con una funcion temporal es terreno resbaladizo, y esto no es el
-- sitio para averiguarlo. Todo el fichero corre en una transaccion con ROLLBACK, asi
-- que la funcion no sobrevive al test; el drop de abajo es por orden, no necesario.
create or replace function public.tmp_revienta_borrado_de_avisos()
returns trigger language plpgsql as $$
begin
  raise exception 'tmp_no_se_borran_avisos';
end;
$$;

create trigger tmp_revienta_borrado
  before delete on public.notifications
  for each row execute function public.tmp_revienta_borrado_de_avisos();

do $$
declare
  v_gol integer;
  v_avisos integer;
begin
  select count(*) into v_avisos
    from public.notifications
   where channel = 'push' and type = 'goal' and status = 'pending'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000005:%';
  if v_avisos <> 2 then
    raise exception '[8] premisa: esperaba 2 push pendientes del gol 5, hay %', v_avisos;
  end if;

  -- Se espera un WARNING de unnotify_deleted_goal aqui: es la prueba de que el
  -- savepoint hizo su trabajo.
  delete from public.match_events where id = '91f00000-0000-4000-8000-000000000005';

  select count(*) into v_gol
    from public.match_events
   where id = '91f00000-0000-4000-8000-000000000005';
  if v_gol <> 0 then
    raise exception '[8] el gol NO se borro: un fallo al retirar avisos tumbo la correccion';
  end if;

  select count(*) into v_avisos
    from public.notifications
   where channel = 'push' and type = 'goal' and status = 'pending'
     and dedupe_key like 'goal:91f00000-0000-4000-8000-000000000005:%';
  if v_avisos <> 2 then
    raise exception '[8] premisa rota: el trigger temporal no impidio el borrado (quedan %)', v_avisos;
  end if;

  raise notice '[8] OK: con el borrado de avisos reventando, el gol se borro igual y los 2 avisos quedaron';
end;
$$;

drop trigger tmp_revienta_borrado on public.notifications;
drop function public.tmp_revienta_borrado_de_avisos();

select 'el_gol_que_se_borra_no_avisa OK' as resultado;

rollback;
