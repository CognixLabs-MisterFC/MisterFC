-- SU-3 — que le pasa al webhook de una cuenta YA BORRADA (migracion 20261063000000).
--
-- Es el bloque que mas importa de la serie, porque es el unico donde un fallo NO se ve:
-- las renovaciones y los reembolsos van a seguir llegando durante MESES para cuentas ya
-- anonimizadas (BC.0 seccion 8, punto 4), y ninguna persona va a mirar esos eventos.
--
-- Cubre:
--   [1]  el evento NO crea ningun perfil.
--   [2]  el evento NO crea entitlement, ni resucita el desenganchado: unlinked_at sigue
--        puesto y rc_customer_id sigue vacio.
--   [3]  el evento SI queda registrado, con applied=false y su motivo. Y profile_id SI
--        se apunta: nulearlo seria teatro, porque app_user_id lleva el MISMO uuid en la
--        misma fila, y sin el la alerta del cable trampa no enlaza con nada.
--   [4]  un TRANSFER a cuenta borrada tiene motivo PROPIO: es el cable trampa.
--   [5]  llegue lo que llegue y en el orden que llegue, el acceso sigue cerrado.
--   [6]  un App User ID que no es nuestro NO crea perfil y sale como unknown_profile.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture: una cuenta que completa su borrado de verdad ────────────────────
insert into public.clubs (id, name, slug) values
  ('c0de0000-0000-4000-8000-000000000001', 'Club SU3', 'club-su3');

select pg_temp.new_test_user('c0dea000-0000-4000-8000-0000000000d1', 'd1@su3.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('c0dea000-0000-4000-8000-0000000000d1', 'c0de0000-0000-4000-8000-000000000001', 'jugador');

-- Suscripcion viva ANTES del borrado.
insert into public.subscription_entitlements (profile_id, rc_customer_id, store, expires_at)
values ('c0dea000-0000-4000-8000-0000000000d1', 'rc-d1', 'APP_STORE', now() + interval '300 days');

insert into public.account_deletion_requests (profile_id, status, deadline_at)
values ('c0dea000-0000-4000-8000-0000000000d1', 'pending', now() + interval '30 days');

-- El borrado de verdad, por el camino real.
select public.finalize_account_deletion('c0dea000-0000-4000-8000-0000000000d1');


-- ── [1]-[5] · lo que llega despues del borrado ───────────────────────────────
do $$
declare
  v_d1        uuid := 'c0dea000-0000-4000-8000-0000000000d1';
  v_perfiles  bigint;
  v_r         text;
  e           public.subscription_entitlements%rowtype;
  ev          public.subscription_events%rowtype;
begin
  select count(*) into v_perfiles from public.profiles;

  -- Una renovacion normal, de las que van a seguir llegando meses.
  v_r := public.apply_subscription_event(
    'su3-renewal', 'RENEWAL', v_d1::text, now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-1', now() + interval '365 days', null, 'rc-d1', '{}'::jsonb);
  if v_r <> 'deleted_profile' then
    raise exception '[1] una renovacion sobre cuenta borrada no se aplica, salio %', v_r;
  end if;

  -- [1] NO se ha creado ningun perfil.
  if (select count(*) from public.profiles) <> v_perfiles then
    raise exception '[1] el evento ha CREADO un perfil';
  end if;

  -- [2] el entitlement sigue desenganchado y vacio.
  select * into e from public.subscription_entitlements where profile_id = v_d1;
  if e.unlinked_at is null then
    raise exception '[2] el evento ha RESUCITADO el entitlement (unlinked_at a null)';
  end if;
  if e.rc_customer_id is not null then
    raise exception '[2] el evento ha vuelto a enlazar el cliente de RevenueCat';
  end if;
  if e.expires_at > now() + interval '360 days' then
    raise exception '[2] el evento ha extendido el vencimiento de una cuenta borrada';
  end if;

  -- [3] pero SI queda registrado, y enlazado, que es lo que permite investigarlo.
  select * into ev from public.subscription_events where event_id = 'su3-renewal';
  if ev.event_id is null then
    raise exception '[3] el evento tiene que quedar REGISTRADO aunque no se aplique';
  end if;
  if ev.applied then
    raise exception '[3] applied tiene que ser false';
  end if;
  if ev.skipped_reason <> 'deleted_profile' then
    raise exception '[3] el motivo tiene que decir por que, salio %', ev.skipped_reason;
  end if;
  if ev.profile_id is distinct from v_d1 then
    raise exception '[3] profile_id se apunta a proposito (app_user_id ya lleva el uuid)';
  end if;

  -- [4] el TRANSFER es otra cosa: es el cable trampa.
  v_r := public.apply_subscription_event(
    'su3-transfer', 'TRANSFER', v_d1::text, now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-1', now() + interval '365 days', null, 'rc-d1', '{}'::jsonb);
  if v_r <> 'transfer_to_deleted_profile' then
    raise exception '[4] el TRANSFER tiene motivo propio, salio %', v_r;
  end if;

  -- [5] y da igual el tipo y el orden: nada abre la puerta.
  foreach v_r in array array['INITIAL_PURCHASE','BILLING_ISSUE','PRODUCT_CHANGE','UNCANCELLATION'] loop
    if public.apply_subscription_event(
         'su3-' || v_r, v_r, v_d1::text, now() + interval '1 hour', 'PRODUCTION',
         'APP_STORE', 'misterfc_anual', 'txn-1', now() + interval '999 days',
         now() + interval '999 days', 'rc-d1', '{}'::jsonb) <> 'deleted_profile' then
      raise exception '[5] % ha pasado el filtro de cuenta borrada', v_r;
    end if;
  end loop;

  -- Y el gate sigue cerrado. OJO: `finalize` NO limpia `expires_at` — no le hace falta,
  -- porque `unlinked_at` gana sobre cualquier fecha. Esto comprueba justo eso, que es lo
  -- que de verdad cierra la puerta, y no la fecha.
  select * into e from public.subscription_entitlements where profile_id = v_d1;
  if e.unlinked_at is null then
    raise exception '[5] tras 6 eventos el desenganche se ha perdido';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_d1)::text, true);
  if (select has_access from public.my_subscription_status()) then
    raise exception '[5] una cuenta borrada NO puede tener acceso';
  end if;
  if (select state from public.my_subscription_status()) <> 'unlinked' then
    raise exception '[5] el estado tiene que ser unlinked';
  end if;
  perform set_config('request.jwt.claims', null, true);
end $$;


-- ── [6] · un App User ID que no es nuestro ───────────────────────────────────
do $$
declare
  v_perfiles bigint;
  v_r        text;
begin
  select count(*) into v_perfiles from public.profiles;

  -- El anonimo que genera el SDK antes de identificar a nadie.
  v_r := public.apply_subscription_event(
    'su3-anon', 'INITIAL_PURCHASE', '$RCAnonymousID:9f8e7d', now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-z', now() + interval '365 days', null, null, '{}'::jsonb);
  if v_r <> 'unknown_profile' then
    raise exception '[6] un App User ID ajeno sale como unknown_profile, salio %', v_r;
  end if;

  -- Un UUID con forma correcta pero que no es de nadie.
  v_r := public.apply_subscription_event(
    'su3-fantasma', 'INITIAL_PURCHASE', 'deadbeef-0000-4000-8000-000000000099', now(),
    'PRODUCTION', 'APP_STORE', 'misterfc_anual', 'txn-y', now() + interval '365 days',
    null, null, '{}'::jsonb);
  if v_r <> 'unknown_profile' then
    raise exception '[6] un uuid fantasma sale como unknown_profile, salio %', v_r;
  end if;

  if (select count(*) from public.profiles) <> v_perfiles then
    raise exception '[6] un App User ID desconocido ha CREADO un perfil';
  end if;

  if exists (select 1 from public.subscription_entitlements
              where profile_id = 'deadbeef-0000-4000-8000-000000000099') then
    raise exception '[6] se ha creado entitlement para un perfil que no existe';
  end if;

  -- y los dos quedan registrados, con profile_id NULL porque no hay a quien enlazar
  if (select count(*) from public.subscription_events
       where event_id in ('su3-anon','su3-fantasma') and profile_id is null) <> 2 then
    raise exception '[6] los eventos de App User ID ajeno se registran con profile_id null';
  end if;
end $$;


rollback;
