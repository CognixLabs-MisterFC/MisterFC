-- SU-6 — reconciliacion nocturna y aviso de vencimiento (migraciones 20261064/20261065).
--
-- El bloque que manda es el [1]: la lista de candidatos es EL CANDADO contra la
-- resurreccion. `GET /v1/subscribers/{id}` de RevenueCat devuelve 201 y CREA el cliente
-- si no existe, asi que preguntar por una cuenta anonimizada la resucitaria en su lado.
-- La defensa no vive en el TypeScript del barrido, vive aqui.
--
-- Cubre:
--   [1]  CANDADO: una cuenta desenganchada NO sale. Un perfil anonimizado NO sale.
--        Ni aunque tenga el impago abierto, que es la maxima prioridad.
--   [2]  ORDEN: impago abierto primero, luego lo mas rancio, luego lo que vence antes.
--   [3]  Quien no necesita atencion no sale (recien reconciliado y vencimiento lejano).
--   [4]  reconcile CORRIGE y deja rastro solo cuando cambia algo; si no, noop.
--   [5]  reconcile vuelve a comprobar los dos candados: la fila pudo desengancharse
--        mientras iba la peticion HTTP.
--   [6]  reconcile NUNCA crea filas.
--   [7]  El aviso: uno por FECHA de vencimiento, dedupe al repetir, nada al staff,
--        nada a desenganchados, y el payload sin PII ni dias restantes.
--   [8]  CANDADO de privilegios: las tres cerradas a anon/authenticated.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('60600000-0000-4000-8000-000000000001', 'Club SU6', 'club-su6');

-- f1 impago abierto · f2 nunca reconciliada · f3 rancia · f4 recien reconciliada y lejana
-- d1 anonimizada · u1 desenganchada · s1 staff (no paga)
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000f1', 'f1@su6.test', '{}'::jsonb);
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000f2', 'f2@su6.test', '{}'::jsonb);
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000f3', 'f3@su6.test', '{}'::jsonb);
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000f4', 'f4@su6.test', '{}'::jsonb);
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000d1', 'd1@su6.test', '{}'::jsonb);
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000a1', 'u1@su6.test', '{}'::jsonb);
select pg_temp.new_test_user('60600000-0000-4000-8000-0000000000b1', 's1@su6.test', '{}'::jsonb);

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('60600000-0000-4000-8000-00000000d001', '60600000-0000-4000-8000-000000000001',
   'Jugador', 'SU6', date '2012-03-03');

-- Todos los de familia son tutores (asi `requires_subscription` es true).
insert into public.player_accounts (player_id, profile_id, relation)
select '60600000-0000-4000-8000-00000000d001', x, 'parent'
  from unnest(array[
    '60600000-0000-4000-8000-0000000000f1'::uuid,
    '60600000-0000-4000-8000-0000000000f2'::uuid,
    '60600000-0000-4000-8000-0000000000f3'::uuid,
    '60600000-0000-4000-8000-0000000000f4'::uuid,
    '60600000-0000-4000-8000-0000000000d1'::uuid,
    '60600000-0000-4000-8000-0000000000a1'::uuid
  ]) x;

-- s1 es entrenador: el staff GANA y no paga.
insert into public.memberships (profile_id, club_id, role) values
  ('60600000-0000-4000-8000-0000000000b1', '60600000-0000-4000-8000-000000000001',
   'entrenador_principal');

insert into public.subscription_entitlements
  (profile_id, rc_customer_id, store, expires_at, grace_period_expires_at,
   billing_issue_detected_at, unlinked_at, reconciled_at)
values
  -- f1: impago abierto, dentro de la gracia. Maxima prioridad.
  ('60600000-0000-4000-8000-0000000000f1', 'rc-f1', 'APP_STORE',
   now() - interval '1 day', now() + interval '5 days', now() - interval '1 day', null, now()),
  -- f2: nunca reconciliada.
  ('60600000-0000-4000-8000-0000000000f2', 'rc-f2', 'APP_STORE',
   now() + interval '200 days', null, null, null, null),
  -- f3: rancia (30 dias sin preguntar).
  ('60600000-0000-4000-8000-0000000000f3', 'rc-f3', 'APP_STORE',
   now() + interval '200 days', null, null, null, now() - interval '30 days'),
  -- f4: recien reconciliada y vence lejos: NO necesita atencion.
  ('60600000-0000-4000-8000-0000000000f4', 'rc-f4', 'APP_STORE',
   now() + interval '200 days', null, null, null, now()),
  -- d1: anonimizada (el perfil), con impago abierto para que sea el caso duro.
  ('60600000-0000-4000-8000-0000000000d1', 'rc-d1', 'APP_STORE',
   now() - interval '1 day', now() + interval '5 days', now() - interval '1 day', null, null),
  -- u1: DESENGANCHADA por borrado, tambien con impago abierto.
  ('60600000-0000-4000-8000-0000000000a1', null, 'APP_STORE',
   now() - interval '1 day', now() + interval '5 days', now() - interval '1 day',
   now() - interval '2 days', null),
  -- s1: staff con entitlement (no deberia recibir avisos).
  ('60600000-0000-4000-8000-0000000000b1', 'rc-s1', 'APP_STORE',
   now() + interval '3 days', null, null, null, null);

update public.profiles set deleted_at = now()
 where id = '60600000-0000-4000-8000-0000000000d1';


-- ── [1] · EL CANDADO ─────────────────────────────────────────────────────────
do $$
declare
  v_d1 uuid := '60600000-0000-4000-8000-0000000000d1';
  v_u1 uuid := '60600000-0000-4000-8000-0000000000a1';
  v_n  int;
begin
  if exists (select 1 from public.subscription_reconcile_candidates(100)
              where profile_id = v_d1) then
    raise exception '[1] un perfil ANONIMIZADO no puede salir a reconciliar: el GET lo resucitaria';
  end if;

  if exists (select 1 from public.subscription_reconcile_candidates(100)
              where profile_id = v_u1) then
    raise exception '[1] una cuenta DESENGANCHADA no puede salir a reconciliar';
  end if;

  -- Y el candado gana sobre la prioridad: las dos tienen el impago abierto.
  select count(*) into v_n from public.subscription_reconcile_candidates(100)
   where billing_issue;
  if v_n <> 1 then
    raise exception '[1] con impago abierto solo puede salir f1, salieron %', v_n;
  end if;

  -- El App User ID que se devuelve es el profiles.id, no otra cosa.
  if exists (select 1 from public.subscription_reconcile_candidates(100)
              where app_user_id is distinct from profile_id::text) then
    raise exception '[1] el app_user_id tiene que ser el profiles.id';
  end if;
end $$;


-- ── [2] · el orden que pidio Jose ────────────────────────────────────────────
do $$
declare
  v_orden uuid[];
  v_prio  text[];
begin
  select array_agg(profile_id order by ord), array_agg(priority order by ord)
    into v_orden, v_prio
    from (select profile_id, priority, row_number() over () as ord
            from public.subscription_reconcile_candidates(100)) t;

  -- Primero el impago abierto: Google no avisa de gracia -> account hold.
  if v_orden[1] <> '60600000-0000-4000-8000-0000000000f1' then
    raise exception '[2] el impago abierto va PRIMERO, salio %', v_orden[1];
  end if;
  if v_prio[1] <> 'billing_issue' then
    raise exception '[2] la prioridad del primero deberia ser billing_issue, salio %', v_prio[1];
  end if;

  -- Y la SECUENCIA COMPLETA, no solo dos posiciones relativas: con una comparacion
  -- suelta, una inyeccion que cambie el centinela y la direccion a la vez se cancela y
  -- el test no se entera (pasó al escribir estos controles).
  --   f1  impago abierto                      -> maxima prioridad
  --   b1  nunca reconciliada, vence en 3 dias -> empata en antiguedad con f2 y gana por
  --                                              vencimiento mas cercano
  --   f2  nunca reconciliada, vence en 200
  --   f3  reconciliada hace 30 dias
  --   f4  NO sale (recien reconciliada y vencimiento lejano)
  --
  -- b1 es STAFF y no paga, y AUN ASI se reconcilia. Es deliberado y es el reverso del
  -- bloque [7]: al staff no se le AVISA de un vencimiento que no le afecta, pero su
  -- fila SI se mantiene exacta, porque su compra es real y es esa fila la que decide su
  -- acceso el dia que deje de ser staff ("por CUENTA, no por club"). Reconciliar no
  -- cuesta nada y no le dice nada a nadie; no reconciliar deja una fila mintiendo.
  if v_orden is distinct from array[
       '60600000-0000-4000-8000-0000000000f1',
       '60600000-0000-4000-8000-0000000000b1',
       '60600000-0000-4000-8000-0000000000f2',
       '60600000-0000-4000-8000-0000000000f3'
     ]::uuid[] then
    raise exception '[2] la secuencia de candidatos no es la esperada, salio %', v_orden;
  end if;
end $$;


-- ── [3] · quien no necesita atencion no sale ─────────────────────────────────
do $$
begin
  if exists (select 1 from public.subscription_reconcile_candidates(100)
              where profile_id = '60600000-0000-4000-8000-0000000000f4') then
    raise exception '[3] recien reconciliada y con vencimiento lejano NO deberia salir';
  end if;

  -- Y el tope se respeta.
  if (select count(*) from public.subscription_reconcile_candidates(1)) <> 1 then
    raise exception '[3] el tope de la lista no se respeta';
  end if;
end $$;


-- ── [4] · corregir deja rastro; confirmar no ─────────────────────────────────
do $$
declare
  v_f3 uuid := '60600000-0000-4000-8000-0000000000f3';
  v_r  text;
  v_ev int;
  e    public.subscription_entitlements%rowtype;
begin
  -- RevenueCat dice algo DISTINTO: el impago existe y la gracia acaba en 7 dias.
  v_r := public.reconcile_subscription_entitlement(
    v_f3, now() - interval '1 hour', now() + interval '7 days', now() - interval '1 hour',
    'APP_STORE', 'misterfc_anual', 'txn-f3', 'rc-f3');
  if v_r <> 'corrected' then
    raise exception '[4] deberia CORREGIR, salio %', v_r;
  end if;

  select * into e from public.subscription_entitlements where profile_id = v_f3;
  if e.billing_issue_detected_at is null or e.grace_period_expires_at is null then
    raise exception '[4] la correccion no se ha aplicado';
  end if;
  if e.reconciled_at is null then
    raise exception '[4] reconciled_at tiene que quedar sellado';
  end if;
  -- La gracia DA acceso: con el vencimiento pasado y la gracia por delante, access_until
  -- es la gracia (es el MAXIMO, columna generada de SU-1).
  if e.access_until <= now() then
    raise exception '[4] durante la gracia access_until tiene que estar por delante';
  end if;

  select count(*) into v_ev from public.subscription_events
   where profile_id = v_f3 and type = 'RECONCILE';
  if v_ev <> 1 then
    raise exception '[4] una correccion deja UNA fila de rastro, salieron %', v_ev;
  end if;

  -- Repetir lo MISMO no es una correccion: no puede ensuciar el libro.
  v_r := public.reconcile_subscription_entitlement(
    v_f3, e.expires_at, e.grace_period_expires_at, e.billing_issue_detected_at,
    'APP_STORE', 'misterfc_anual', 'txn-f3', 'rc-f3');
  if v_r <> 'noop' then
    raise exception '[4] confirmar lo que ya sabiamos es noop, salio %', v_r;
  end if;

  select count(*) into v_ev from public.subscription_events
   where profile_id = v_f3 and type = 'RECONCILE';
  if v_ev <> 1 then
    raise exception '[4] el noop NO puede dejar rastro, hay % filas', v_ev;
  end if;
end $$;


-- ── [5] · los candados, otra vez, en la escritura ────────────────────────────
do $$
declare
  v_d1 uuid := '60600000-0000-4000-8000-0000000000d1';
  v_u1 uuid := '60600000-0000-4000-8000-0000000000a1';
  v_r  text;
  e    public.subscription_entitlements%rowtype;
begin
  -- La ventana real: la lista se pidio, la peticion HTTP tardo, y entretanto la cuenta
  -- se borro. La escritura tiene que negarse por su cuenta.
  v_r := public.reconcile_subscription_entitlement(
    v_d1, now() + interval '365 days', null, null, 'APP_STORE', 'misterfc_anual', 'txn-d', 'rc-d1');
  if v_r <> 'skipped_deleted' then
    raise exception '[5] sobre perfil anonimizado tiene que negarse, salio %', v_r;
  end if;

  v_r := public.reconcile_subscription_entitlement(
    v_u1, now() + interval '365 days', null, null, 'APP_STORE', 'misterfc_anual', 'txn-u', 'rc-u1');
  if v_r <> 'skipped_unlinked' then
    raise exception '[5] sobre cuenta desenganchada tiene que negarse, salio %', v_r;
  end if;

  -- Y no ha tocado nada.
  select * into e from public.subscription_entitlements where profile_id = v_u1;
  if e.unlinked_at is null then
    raise exception '[5] el desenganche se ha perdido';
  end if;
  if e.expires_at > now() then
    raise exception '[5] le ha extendido el vencimiento a una cuenta borrada';
  end if;
  if exists (select 1 from public.subscription_events
              where profile_id in (v_d1, v_u1) and type = 'RECONCILE') then
    raise exception '[5] una negativa no puede dejar rastro de correccion';
  end if;
end $$;


-- ── [6] · nunca crea filas ───────────────────────────────────────────────────
do $$
declare
  v_fantasma uuid := '60600000-0000-4000-8000-00000000ffff';
  v_antes bigint;
  v_r text;
begin
  select count(*) into v_antes from public.subscription_entitlements;

  v_r := public.reconcile_subscription_entitlement(
    v_fantasma, now() + interval '365 days', null, null);
  if v_r <> 'unknown_profile' then
    raise exception '[6] sobre un perfil sin entitlement deberia salir unknown_profile, salio %', v_r;
  end if;

  if (select count(*) from public.subscription_entitlements) <> v_antes then
    raise exception '[6] la reconciliacion ha CREADO una fila';
  end if;
end $$;


-- ── [7] · el aviso de vencimiento ────────────────────────────────────────────
-- OJO: este bloque USA el valor de enum que anade la migracion 20261064000000. No puede
-- correr en la misma transaccion que ese ALTER TYPE (PostgreSQL 17.6 lo rechaza con
-- 55P04, medido). En CI las migraciones estan aplicadas y commiteadas antes de los
-- tests, asi que aqui funciona.
do $$
declare
  v_f1 uuid := '60600000-0000-4000-8000-0000000000f1';
  v_f3 uuid := '60600000-0000-4000-8000-0000000000f3';
  v_f4 uuid := '60600000-0000-4000-8000-0000000000f4';
  v_avisados uuid[];
  v_b1 uuid := '60600000-0000-4000-8000-0000000000b1';
  v_u1 uuid := '60600000-0000-4000-8000-0000000000a1';
  v_n  int;
  p    jsonb;
begin
  -- Se comprueba el CONJUNTO de avisados, no el recuento: un recuento depende del
  -- estado que dejaron los bloques anteriores y esconde A QUIEN se avisa, que es lo
  -- que importa.
  --
  -- Tocan dos, y las dos por el mismo motivo: estan EN GRACIA, asi que su `access_until`
  -- (el MAXIMO entre vencimiento y fin de gracia) cae dentro de la ventana. f1 venia asi
  -- de la fixture; f3 la dejo asi el bloque [4] al corregirla. Son justo las personas a
  -- las que mas urge avisar: si no hacen nada entran en account hold y Google NO manda
  -- ningun evento en esa transicion.
  perform public.notify_subscription_expiring(7);

  select array_agg(user_id order by user_id) into v_avisados
    from public.notifications where type = 'subscription_expiring';

  if v_avisados is distinct from array[
       least(v_f1, v_f3), greatest(v_f1, v_f3)
     ]::uuid[] then
    raise exception '[7] los avisados tenian que ser f1 y f3 (los dos en gracia), salio %', v_avisados;
  end if;

  -- El STAFF no paga: b1 vence en 3 dias y no recibe nada. Ojo al contraste con el
  -- bloque [2]: b1 SI es candidato a reconciliar (su fila tiene que ser exacta) pero NO
  -- recibe aviso (el vencimiento no le afecta mientras sea staff).
  if exists (select 1 from public.notifications
              where user_id = v_b1 and type = 'subscription_expiring') then
    raise exception '[7] al staff NO se le avisa de un vencimiento que no paga';
  end if;

  -- Una cuenta desenganchada tampoco, aunque su fecha tambien caiga en la ventana.
  if exists (select 1 from public.notifications
              where user_id = v_u1 and type = 'subscription_expiring') then
    raise exception '[7] a una cuenta borrada no se le avisa de nada';
  end if;

  -- Repetir el cron no duplica: la clave de dedupe lleva la FECHA de vencimiento.
  if public.notify_subscription_expiring(7) <> 0 then
    raise exception '[7] el aviso se ha duplicado al repetir el cron';
  end if;

  -- Ahora le toca a f4: se le acerca el vencimiento.
  update public.subscription_entitlements
     set expires_at = now() + interval '4 days'
   where profile_id = v_f4;

  v_n := public.notify_subscription_expiring(7);
  if v_n <> 1 then
    raise exception '[7] deberia avisarse a f4, salieron %', v_n;
  end if;

  select payload into p from public.notifications
   where user_id = v_f4 and type = 'subscription_expiring';
  if p ? 'days_left' or p ? 'dias' then
    raise exception '[7] el payload NO puede llevar dias restantes: es inmutable y manana miente';
  end if;
  if p->>'access_until' is null then
    raise exception '[7] el payload tiene que llevar la fecha';
  end if;
  -- Nada personal (ADR-0022 seccion 3 y el criterio de BC-7).
  if p ? 'full_name' or p ? 'email' or p ? 'name' then
    raise exception '[7] el payload no puede llevar PII';
  end if;

  -- Si RENUEVA, la fecha cambia y el aviso siguiente es otro.
  update public.subscription_entitlements
     set expires_at = now() + interval '6 days'
   where profile_id = v_f4;
  if public.notify_subscription_expiring(7) <> 1 then
    raise exception '[7] con una fecha de vencimiento NUEVA toca avisar otra vez';
  end if;
end $$;


-- ── [8] · candado de privilegios ─────────────────────────────────────────────
do $$
declare
  v_cand text := 'public.subscription_reconcile_candidates(integer, integer, integer)';
  v_rec  text := 'public.reconcile_subscription_entitlement(uuid, timestamptz, timestamptz, timestamptz, text, text, text, text)';
  v_not  text := 'public.notify_subscription_expiring(integer)';
  v_sig  text;
begin
  foreach v_sig in array array[v_cand, v_rec, v_not] loop
    if has_function_privilege('authenticated', v_sig, 'execute')
       or has_function_privilege('anon', v_sig, 'execute') then
      raise exception '[8] % sigue abierta a la app', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'execute') then
      raise exception '[8] service_role tiene que poder ejecutar %', v_sig;
    end if;
  end loop;
end $$;


rollback;
