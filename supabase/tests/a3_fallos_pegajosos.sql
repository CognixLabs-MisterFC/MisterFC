-- A-3 — `failed` y `suppressed` pegajosos como `bounced` y `complained`
-- (migracion 20261108000000).
--
-- A-1 ya probaba el candado para `bounced`. Esto prueba que la lista son los CUATRO, y
-- que ampliarla no ha roto nada de lo que ya funcionaba.
--
-- LA ASERCION QUE MAS VALE es [3]: un `delivered` posterior no puede tapar un `failed`.
-- Antes de esta migracion lo tapaba, y la pantalla de A-3 —que pinta los cuatro igual,
-- como «No llego»— habria pasado de «No llego» a nada sin que nadie tocara nada.
--
-- Cubre:
--   [1] La migracion esta aplicada (la lista nueva vive en el cuerpo de la funcion).
--   [2] Los CUATRO estados se registran cuando llegan a una fila limpia.
--   [3] CANDADO NUEVO: un `delivered` posterior NO tapa ni `failed` ni `suppressed`.
--   [4] CANDADO DE A-1, que sigue vivo: tampoco tapa `bounced` ni `complained`.
--   [5] Entre fallos SI se pisa: un `bounced` posterior a un `failed` entra. Si no, el
--       estado se congelaria en el primer fallo y perderiamos el motivo bueno.
--   [6] Lo normal NO se ha roto: `sent` → `delivered` sigue avanzando.
--   [7] El candado de ORDEN sigue vivo: un fallo mas VIEJO no pisa a un fallo nuevo.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Las aserciones LEEN con el rol de la sesion: las comprobaciones van como
-- postgres.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── [1] ──────────────────────────────────────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'apply_invitation_delivery_event';
  if v_def is null then
    raise exception 'FAIL [1]: falta apply_invitation_delivery_event';
  end if;
  if v_def not like '%suppressed%' or v_def not like '%failed%' then
    raise exception 'FAIL [1]: la funcion no conoce failed/suppressed — migracion 20261108000000 sin aplicar';
  end if;
end $$;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('a3700000-0000-4000-8000-000000000001', 'Club A3', 'club-a3-pegajosos');
insert into public.seasons (id, club_id, label, status) values
  ('a37c0000-0000-4000-8000-000000000001', 'a3700000-0000-4000-8000-000000000001', '2026-27', 'active');

select pg_temp.new_test_user('a37a0000-0000-4000-8000-000000000001', 'admin@a3.test', '{}'::jsonb);
insert into public.memberships (profile_id, club_id, role) values
  ('a37a0000-0000-4000-8000-000000000001', 'a3700000-0000-4000-8000-000000000001', 'admin_club');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('a37b0000-0000-4000-8000-000000000001', 'a3700000-0000-4000-8000-000000000001', 'Uno',    'A3', '2014-03-03'),
  ('a37b0000-0000-4000-8000-000000000002', 'a3700000-0000-4000-8000-000000000001', 'Dos',    'A3', '2014-03-03'),
  ('a37b0000-0000-4000-8000-000000000003', 'a3700000-0000-4000-8000-000000000001', 'Tres',   'A3', '2014-03-03'),
  ('a37b0000-0000-4000-8000-000000000004', 'a3700000-0000-4000-8000-000000000001', 'Cuatro', 'A3', '2014-03-03'),
  ('a37b0000-0000-4000-8000-000000000005', 'a3700000-0000-4000-8000-000000000001', 'Cinco',  'A3', '2014-03-03');

-- Una invitacion por estado terminal, cada una con su propio envio, mas una para el
-- camino normal.
insert into public.invitations
  (id, email, club_id, role, player_id, player_relation, created_by, delivery_message_id)
select
  ('a37e0000-0000-4000-8000-00000000000' || n)::uuid,
  'padre' || n || '@a3.test',
  'a3700000-0000-4000-8000-000000000001',
  'jugador',
  ('a37b0000-0000-4000-8000-00000000000' || n)::uuid,
  'parent',
  'a37a0000-0000-4000-8000-000000000001',
  'msg-' || n
from generate_series(1, 5) as n;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] Los cuatro estados terminales se registran en una fila limpia.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n      integer;
  v_estado text;
  v_msg    text;
  i        integer := 0;
begin
  foreach v_estado in array array['bounced', 'complained', 'failed', 'suppressed'] loop
    i := i + 1;
    v_msg := 'msg-' || i;
    v_n := public.apply_invitation_delivery_event(v_msg, v_estado, 'motivo', now());
    if v_n <> 1 then
      raise exception 'FAIL [2]: el estado % no se registro (% filas)', v_estado, v_n;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] LA IMPORTANTE + [4] la de A-1: NINGUNO de los cuatro se tapa con un
--     `delivered` posterior.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_n      integer;
  v_estado text;
  v_ahora  text;
  v_msg    text;
  i        integer := 0;
begin
  foreach v_estado in array array['bounced', 'complained', 'failed', 'suppressed'] loop
    i := i + 1;
    v_msg := 'msg-' || i;
    -- Fecha POSTERIOR a proposito: no vale que lo pare el candado de orden, tiene que
    -- pararlo el de "no se tapa un fallo".
    v_n := public.apply_invitation_delivery_event(v_msg, 'delivered', null, now() + interval '1 hour');
    if v_n <> 0 then
      raise exception 'FAIL [%]: un delivered posterior tapo el fallo % (% filas)',
        case when v_estado in ('failed', 'suppressed') then '3' else '4' end, v_estado, v_n;
    end if;
    select delivery_state into v_ahora from public.invitations where delivery_message_id = v_msg;
    if v_ahora is distinct from v_estado then
      raise exception 'FAIL [%]: el estado % se convirtio en %',
        case when v_estado in ('failed', 'suppressed') then '3' else '4' end, v_estado, v_ahora;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Entre fallos SI se pisa: el motivo bueno tiene que poder llegar.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer; v_estado text; v_detalle text;
begin
  -- msg-3 esta en `failed`. Un rebote posterior, con su motivo, tiene que entrar.
  v_n := public.apply_invitation_delivery_event(
    'msg-3', 'bounced', 'Permanent/NoEmail: el buzon no existe', now() + interval '2 hours');
  if v_n <> 1 then
    raise exception 'FAIL [5]: un bounced posterior a un failed tenia que entrar (% filas)', v_n;
  end if;
  select delivery_state, delivery_detail into v_estado, v_detalle
    from public.invitations where delivery_message_id = 'msg-3';
  if v_estado <> 'bounced' then
    raise exception 'FAIL [5]: esperaba bounced, quedo %', v_estado;
  end if;
  if v_detalle not like '%buzon no existe%' then
    raise exception 'FAIL [5]: el motivo bueno no llego, quedo %', v_detalle;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] Lo normal no se ha roto: sent → delivered sigue avanzando.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer; v_estado text;
begin
  v_n := public.apply_invitation_delivery_event('msg-5', 'sent', null, now());
  if v_n <> 1 then raise exception 'FAIL [6]: el sent inicial no se aplico'; end if;

  v_n := public.apply_invitation_delivery_event('msg-5', 'delivered', null, now() + interval '1 minute');
  if v_n <> 1 then raise exception 'FAIL [6]: delivered no avanzo desde sent'; end if;

  select delivery_state into v_estado from public.invitations where delivery_message_id = 'msg-5';
  if v_estado <> 'delivered' then
    raise exception 'FAIL [6]: esperaba delivered, quedo %', v_estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] El candado de ORDEN sigue vivo, tambien entre fallos.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer; v_estado text;
begin
  -- msg-3 quedo en `bounced` con fecha now()+2h. Un `suppressed` mas VIEJO no pisa.
  v_n := public.apply_invitation_delivery_event('msg-3', 'suppressed', null, now() + interval '1 hour');
  if v_n <> 0 then
    raise exception 'FAIL [7]: un fallo mas viejo piso al mas nuevo (% filas)', v_n;
  end if;
  select delivery_state into v_estado from public.invitations where delivery_message_id = 'msg-3';
  if v_estado <> 'bounced' then
    raise exception 'FAIL [7]: el estado retrocedio a %', v_estado;
  end if;
end $$;

rollback;
