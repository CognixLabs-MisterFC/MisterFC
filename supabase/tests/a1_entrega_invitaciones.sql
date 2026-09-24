-- A-1 — donde se apunta que una invitacion no llego (migracion 20261107000000).
--
-- El agujero medido: se invito a un dominio inexistente, Resend acepto el envio, el
-- correo no llego a ningun sitio y NO quedo rastro — ni webhook en Resend, ni columna
-- donde apuntarlo. En el listado se veia "Pendiente", igual que una que esta sin abrir
-- en la bandeja de alguien, y a los 7 dias "Caducada", que se lee como "no la acepto".
--
-- LA ASERCION QUE MAS VALE es [5]: un evento no-fallido NUNCA puede tapar un rebote ya
-- registrado, ni aunque llegue con fecha posterior. Si se tapa, volvemos exactamente al
-- problema que esta migracion existe para cerrar, pero con la pantalla diciendo que todo
-- fue bien. El modo de fallo tiene que ser "avisa de mas".
--
-- Cubre:
--   [1]  Las columnas y la funcion existen (si no, la migracion esta sin aplicar).
--   [2]  UN correo, VARIAS invitaciones: el evento marca a los DOS hermanos. Es el caso
--        real — `inviteBatch` manda un solo correo por tutor con la primera de ancla.
--   [3]  No toca las invitaciones de OTRO envio.
--   [4]  Un id desconocido no toca nada y devuelve 0 (el handler necesita distinguirlo
--        de un error).
--   [5]  CANDADO: un `delivered` posterior NO borra un `bounced` ya registrado.
--   [6]  CANDADO: un evento mas VIEJO no pisa a uno mas nuevo (Resend no garantiza el
--        orden).
--   [7]  Lo normal sigue funcionando: `sent` → `delivered` avanza.
--   [8]  Un rebote SI puede pisar a un `delivered` anterior: el fallo siempre entra.
--   [9]  CANDADO ACL: ni anon ni authenticated ejecutan la funcion — es del webhook.
--   [10] RETIRADO al entrar A-2: ver la nota en su sitio. Probo lo que tenia que
--        probar —A-1 no movio ninguna fila— y dejo de ser cierto en cuanto el webhook
--        empezo a escribir de verdad.
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
begin
  if to_regprocedure('public.apply_invitation_delivery_event(text,text,text,timestamptz)') is null then
    raise exception 'FAIL [1]: falta apply_invitation_delivery_event — migracion 20261107000000 sin aplicar';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='invitations'
       and column_name in ('delivery_message_id','delivery_state','delivery_detail','delivery_at')
     group by table_name having count(*) = 4
  ) then
    raise exception 'FAIL [1]: faltan columnas de entrega en invitations';
  end if;
end $$;

-- ── [10] RETIRADO ───────────────────────────────────────────────────────────
--
-- Decia: "ninguna invitacion tiene estado de entrega". Servia para probar que A-1, por
-- si sola, no cambiaba nada de lo que se veia — y lo probo: la migracion se aplico y no
-- movio ni una fila.
--
-- Ya NO es cierto, y no por un fallo: A-2 (#711) puso el webhook en produccion y el
-- primer envio real dejo su estado en la fila. Ademas se relleno a mano la unica
-- invitacion que no llego (`chaodis@`, `delivery_delayed`), que era el caso medido.
--
-- Se retira en vez de aflojarlo. En una base limpia seguiria pasando —no hay filas— y
-- eso es lo peligroso: quedaria VERDE en el CI mientras es rojo contra produccion, o
-- sea una asercion que ya no describe el sistema y que solo pasa porque no hay nada que
-- mirar. Lo que A-1 tenia que demostrar, quedo demostrado.

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('ab700000-0000-4000-8000-000000000001', 'Club A1', 'club-a1-entrega');
insert into public.seasons (id, club_id, label, status) values
  ('ab7c0000-0000-4000-8000-000000000001', 'ab700000-0000-4000-8000-000000000001', '2026-27', 'active');

select pg_temp.new_test_user('ab7a0000-0000-4000-8000-000000000001', 'admin@a1.test', '{}'::jsonb);
insert into public.memberships (profile_id, club_id, role) values
  ('ab7a0000-0000-4000-8000-000000000001', 'ab700000-0000-4000-8000-000000000001', 'admin_club');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('ab7b0000-0000-4000-8000-000000000001', 'ab700000-0000-4000-8000-000000000001', 'Uno', 'A1', '2014-03-03'),
  ('ab7b0000-0000-4000-8000-000000000002', 'ab700000-0000-4000-8000-000000000001', 'Dos', 'A1', '2014-03-03'),
  ('ab7b0000-0000-4000-8000-000000000003', 'ab700000-0000-4000-8000-000000000001', 'Tres','A1', '2014-03-03');

-- DOS HERMANOS en el mismo correo (msg-A) y un tercero en otro envio (msg-B).
insert into public.invitations
  (id, email, club_id, role, player_id, player_relation, created_by, delivery_message_id)
values
  ('ab7e0000-0000-4000-8000-000000000001', 'padre@a1.test', 'ab700000-0000-4000-8000-000000000001',
   'jugador', 'ab7b0000-0000-4000-8000-000000000001', 'parent', 'ab7a0000-0000-4000-8000-000000000001', 'msg-A'),
  ('ab7e0000-0000-4000-8000-000000000002', 'padre@a1.test', 'ab700000-0000-4000-8000-000000000001',
   'jugador', 'ab7b0000-0000-4000-8000-000000000002', 'parent', 'ab7a0000-0000-4000-8000-000000000001', 'msg-A'),
  ('ab7e0000-0000-4000-8000-000000000003', 'otra@a1.test', 'ab700000-0000-4000-8000-000000000001',
   'jugador', 'ab7b0000-0000-4000-8000-000000000003', 'parent', 'ab7a0000-0000-4000-8000-000000000001', 'msg-B');

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] Un correo, dos invitaciones. [3] Y no toca la del otro envio.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  v_n := public.apply_invitation_delivery_event('msg-A', 'bounced', 'Invalid domain',
                                                now() - interval '10 minutes');
  if v_n <> 2 then
    raise exception 'FAIL [2]: el evento tenia que marcar las DOS invitaciones del correo, marco %', v_n;
  end if;
  if exists (
    select 1 from public.invitations
     where id in ('ab7e0000-0000-4000-8000-000000000001','ab7e0000-0000-4000-8000-000000000002')
       and (delivery_state is distinct from 'bounced' or delivery_detail is distinct from 'Invalid domain')
  ) then
    raise exception 'FAIL [2]: alguno de los hermanos no quedo marcado como bounced';
  end if;
  if exists (
    select 1 from public.invitations
     where id = 'ab7e0000-0000-4000-8000-000000000003' and delivery_state is not null
  ) then
    raise exception 'FAIL [3]: el evento de msg-A toco una invitacion de msg-B';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Id desconocido: 0 filas, y sin romper.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  v_n := public.apply_invitation_delivery_event('msg-QUE-NO-EXISTE', 'delivered', null, now());
  if v_n <> 0 then
    raise exception 'FAIL [4]: un id desconocido tenia que devolver 0, devolvio %', v_n;
  end if;
  -- Y los dos casos de borde que el handler puede mandar sin querer.
  if public.apply_invitation_delivery_event(null, 'delivered', null, now()) <> 0 then
    raise exception 'FAIL [4]: un message_id nulo tenia que devolver 0';
  end if;
  if public.apply_invitation_delivery_event('   ', 'delivered', null, now()) <> 0 then
    raise exception 'FAIL [4]: un message_id vacio tenia que devolver 0';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] LA IMPORTANTE: un delivered POSTERIOR no tapa el rebote.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  v_n := public.apply_invitation_delivery_event('msg-A', 'delivered', null, now());
  if v_n <> 0 then
    raise exception 'FAIL [5]: un delivered posterior tapo el rebote (% filas). Volvemos al problema original, pero con la pantalla diciendo que todo fue bien', v_n;
  end if;
  if exists (
    select 1 from public.invitations
     where delivery_message_id = 'msg-A' and delivery_state is distinct from 'bounced'
  ) then
    raise exception 'FAIL [5]: el rebote dejo de estar registrado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] Un evento mas VIEJO no pisa. [7] Lo normal avanza. [8] El fallo entra.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer; v_estado text;
begin
  -- msg-B empieza en 'sent'.
  v_n := public.apply_invitation_delivery_event('msg-B', 'sent', null, now() - interval '5 minutes');
  if v_n <> 1 then raise exception 'FAIL [7]: el sent inicial no se aplico'; end if;

  -- [6] uno mas viejo: no entra.
  v_n := public.apply_invitation_delivery_event('msg-B', 'delivery_delayed', 'tarde',
                                                now() - interval '30 minutes');
  if v_n <> 0 then
    raise exception 'FAIL [6]: un evento mas viejo piso al mas nuevo (% filas)', v_n;
  end if;
  select delivery_state into v_estado from public.invitations
   where id = 'ab7e0000-0000-4000-8000-000000000003';
  if v_estado <> 'sent' then
    raise exception 'FAIL [6]: el estado retrocedio a %', v_estado;
  end if;

  -- [7] lo normal: sent -> delivered.
  v_n := public.apply_invitation_delivery_event('msg-B', 'delivered', null, now() - interval '1 minute');
  if v_n <> 1 then raise exception 'FAIL [7]: delivered no avanzo desde sent'; end if;

  -- [8] y un rebote posterior SI entra, aunque ya estuviera entregado.
  v_n := public.apply_invitation_delivery_event('msg-B', 'bounced', 'Mailbox does not exist', now());
  if v_n <> 1 then
    raise exception 'FAIL [8]: un rebote posterior a un delivered tenia que entrar';
  end if;
  select delivery_state into v_estado from public.invitations
   where id = 'ab7e0000-0000-4000-8000-000000000003';
  if v_estado <> 'bounced' then
    raise exception 'FAIL [8]: esperaba bounced, quedo %', v_estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] CANDADO ACL.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.apply_invitation_delivery_event(text,text,text,timestamptz)', 'execute')
     or has_function_privilege('authenticated', 'public.apply_invitation_delivery_event(text,text,text,timestamptz)', 'execute') then
    raise exception 'FAIL [9]: la funcion de entrega esta abierta al cliente — cualquiera podria marcar una invitacion como entregada';
  end if;
end $$;

rollback;
