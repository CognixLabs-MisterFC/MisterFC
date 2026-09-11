-- SU-1 — modelo de la suscripcion anual (migracion 20261063000000). Cubre:
--   [1]  requires_subscription: la familia paga, el staff NO, y el staff GANA sobre el
--        vinculo familiar (entrenador que ademas es tutor = gratis). Superadmin gratis.
--   [2]  access_until es GENERADA y es el MAXIMO: con el vencimiento ya pasado y la
--        gracia por delante, hay acceso. Con el minimo no lo habria — es la diferencia
--        entre que la decision de Jose se cumpla o no.
--   [3]  my_subscription_status: staff_free / none / active / grace / expired / unlinked.
--   [4]  apply_subscription_event: applied, duplicate, stale, sandbox, unknown_profile.
--   [5]  BILLING_ISSUE abre el impago y trae la fecha de gracia; un RENEWAL posterior
--        los LIMPIA (si no, access_until se quedaria anclado a la gracia vieja).
--   [6]  CABLE TRAMPA (ADR-0022 §4d): un evento sobre una cuenta borrada NO se aplica, y
--        si es un TRANSFER se distingue con su propio motivo para que SU-3 lo alerte.
--   [7]  El gancho del borrado: finalize_account_deletion encola el borrado en
--        RevenueCat, pone unlinked_at y sella entitlement_suspended_at.
--   [8]  CANDADO de privilegios: las tres tablas cerradas a anon/authenticated (en
--        Supabase los default privileges las abren POR NOMBRE), la ingesta solo para
--        service_role, y my_subscription_status abierta a authenticated.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
--
-- NOTA (leccion de BC-1): los privilegios se comprueban con `has_table_privilege` /
-- `has_function_privilege`, NUNCA provocando el 42501.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('5a100000-0000-4000-8000-000000000001', 'Club SU1', 'club-su1');

-- f1 tutor (paga) · s1 entrenador (gratis) · m1 entrenador Y tutor (gratis, staff gana)
-- x1 sin vinculo (no paga porque no es familia) · d1 se borra la cuenta
select pg_temp.new_test_user('5a1a0000-0000-4000-8000-0000000000f1', 'f1@su1.test', '{}'::jsonb);
select pg_temp.new_test_user('5a1a0000-0000-4000-8000-00000000005a', 's1@su1.test', '{}'::jsonb);
select pg_temp.new_test_user('5a1a0000-0000-4000-8000-00000000006b', 'm1@su1.test', '{}'::jsonb);
select pg_temp.new_test_user('5a1a0000-0000-4000-8000-00000000007c', 'x1@su1.test', '{}'::jsonb);
select pg_temp.new_test_user('5a1a0000-0000-4000-8000-00000000008d', 'd1@su1.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('5a1a0000-0000-4000-8000-0000000000f1', '5a100000-0000-4000-8000-000000000001', 'jugador'),
  ('5a1a0000-0000-4000-8000-00000000005a', '5a100000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('5a1a0000-0000-4000-8000-00000000006b', '5a100000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5a1a0000-0000-4000-8000-00000000008d', '5a100000-0000-4000-8000-000000000001', 'jugador');

-- `players` no cuelga de `categories` (medido contra produccion): club_id + fecha basta.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5a1b0000-0000-4000-8000-000000000001', '5a100000-0000-4000-8000-000000000001',
   'Jugador', 'SU1', date '2012-05-05');

-- f1 y m1 son tutores del mismo jugador; m1 ademas es entrenador.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('5a1b0000-0000-4000-8000-000000000001', '5a1a0000-0000-4000-8000-0000000000f1', 'parent'),
  ('5a1b0000-0000-4000-8000-000000000001', '5a1a0000-0000-4000-8000-00000000006b', 'parent');


-- ── [1] · quien paga ─────────────────────────────────────────────────────────
do $$
declare
  v_f1 uuid := '5a1a0000-0000-4000-8000-0000000000f1';
  v_s1 uuid := '5a1a0000-0000-4000-8000-00000000005a';
  v_m1 uuid := '5a1a0000-0000-4000-8000-00000000006b';
  v_x1 uuid := '5a1a0000-0000-4000-8000-00000000007c';
begin
  if not public.requires_subscription(v_f1) then
    raise exception '[1] el tutor tendria que pagar';
  end if;

  if public.requires_subscription(v_s1) then
    raise exception '[1] el entrenador NO paga';
  end if;

  -- Esta es la que importa: staff GANA sobre el vinculo familiar.
  if public.requires_subscription(v_m1) then
    raise exception '[1] entrenador que ademas es tutor: gratis (el staff gana)';
  end if;

  if public.requires_subscription(v_x1) then
    raise exception '[1] sin vinculo familiar no hay nada que cobrar';
  end if;

  -- Y una baja devuelve al staff a la cola de los que pagan: m1 deja de ser entrenador
  -- pero sigue siendo tutor.
  update public.memberships set left_at = now()
   where profile_id = v_m1 and role = 'entrenador_ayudante';

  if not public.requires_subscription(v_m1) then
    raise exception '[1] con la membership de staff DADA DE BAJA vuelve a pagar como tutor';
  end if;

  update public.memberships set left_at = null
   where profile_id = v_m1 and role = 'entrenador_ayudante';
end $$;


-- ── [2] · access_until es el MAXIMO, y es generada ───────────────────────────
do $$
declare
  v_f1  uuid := '5a1a0000-0000-4000-8000-0000000000f1';
  v_acc timestamptz;
begin
  insert into public.subscription_entitlements
    (profile_id, expires_at, grace_period_expires_at, billing_issue_detected_at)
  values
    (v_f1, now() - interval '2 days', now() + interval '5 days', now() - interval '2 days');

  select access_until into v_acc from public.subscription_entitlements where profile_id = v_f1;

  -- Con el MINIMO esto valdria `now() - 2 days` y la gracia no daria ni un dia.
  if v_acc <= now() then
    raise exception '[2] durante la gracia TIENE que haber acceso: access_until=%', v_acc;
  end if;

  -- Y es generada: no se puede escribir a mano.
  begin
    update public.subscription_entitlements set access_until = now() + interval '99 years'
     where profile_id = v_f1;
    raise exception '[2] access_until NO puede ser escribible';
  exception
    when generated_always then null;
  end;
end $$;


-- ── [3] · los estados que ve el gate ─────────────────────────────────────────
do $$
declare
  v_f1 uuid := '5a1a0000-0000-4000-8000-0000000000f1';
  v_s1 uuid := '5a1a0000-0000-4000-8000-00000000005a';
  v_x1 uuid := '5a1a0000-0000-4000-8000-00000000007c';
  r    record;
begin
  -- f1 esta en gracia (fixture de [2]).
  perform set_config('request.jwt.claims', json_build_object('sub', v_f1)::text, true);
  select * into r from public.my_subscription_status();
  if r.state <> 'grace' or not r.has_access then
    raise exception '[3] f1 deberia estar en grace CON acceso, salio state=% acceso=%', r.state, r.has_access;
  end if;

  -- el entrenador no paga
  perform set_config('request.jwt.claims', json_build_object('sub', v_s1)::text, true);
  select * into r from public.my_subscription_status();
  if r.state <> 'staff_free' or not r.has_access or r.requires_subscription then
    raise exception '[3] s1 deberia ser staff_free, salio %', r.state;
  end if;

  -- x1 no es familia: tampoco paga
  perform set_config('request.jwt.claims', json_build_object('sub', v_x1)::text, true);
  select * into r from public.my_subscription_status();
  if r.state <> 'staff_free' then
    raise exception '[3] x1 sin vinculo no deberia pagar, salio %', r.state;
  end if;

  -- vencida de verdad: sin gracia y con el vencimiento pasado
  perform set_config('request.jwt.claims', json_build_object('sub', v_f1)::text, true);
  update public.subscription_entitlements
     set grace_period_expires_at = null, billing_issue_detected_at = null,
         expires_at = now() - interval '1 day'
   where profile_id = v_f1;
  select * into r from public.my_subscription_status();
  if r.state <> 'expired' or r.has_access then
    raise exception '[3] f1 deberia estar expired SIN acceso, salio state=% acceso=%', r.state, r.has_access;
  end if;

  -- activa
  update public.subscription_entitlements set expires_at = now() + interval '300 days'
   where profile_id = v_f1;
  select * into r from public.my_subscription_status();
  if r.state <> 'active' or not r.has_access then
    raise exception '[3] f1 deberia estar active, salio %', r.state;
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;


-- ── [4] · ingesta idempotente ────────────────────────────────────────────────
do $$
declare
  v_f1 uuid := '5a1a0000-0000-4000-8000-0000000000f1';
  v_r  text;
begin
  delete from public.subscription_entitlements where profile_id = v_f1;

  v_r := public.apply_subscription_event(
    'evt-1', 'INITIAL_PURCHASE', v_f1::text, now() - interval '1 hour', 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-1', now() + interval '365 days', null, 'rc-1', '{}'::jsonb);
  if v_r <> 'applied' then raise exception '[4] la primera deberia aplicar, salio %', v_r; end if;

  -- el mismo `id` otra vez: entregan at least once
  v_r := public.apply_subscription_event(
    'evt-1', 'INITIAL_PURCHASE', v_f1::text, now() - interval '1 hour', 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-1', now() + interval '365 days', null, 'rc-1', '{}'::jsonb);
  if v_r <> 'duplicate' then raise exception '[4] el duplicado deberia detectarse, salio %', v_r; end if;

  -- uno MAS VIEJO: no garantizan el orden
  v_r := public.apply_subscription_event(
    'evt-0', 'RENEWAL', v_f1::text, now() - interval '5 hours', 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-1', now() + interval '10 days', null, 'rc-1', '{}'::jsonb);
  if v_r <> 'stale' then raise exception '[4] el evento viejo NO se aplica, salio %', v_r; end if;

  if (select expires_at from public.subscription_entitlements where profile_id = v_f1)
       < now() + interval '300 days' then
    raise exception '[4] el evento viejo ha pisado el vencimiento bueno';
  end if;

  -- sandbox NO da acceso de produccion
  v_r := public.apply_subscription_event(
    'evt-sbx', 'RENEWAL', v_f1::text, now(), 'SANDBOX',
    'APP_STORE', 'misterfc_anual', 'txn-9', now() + interval '999 days', null, 'rc-1', '{}'::jsonb);
  if v_r <> 'sandbox' then raise exception '[4] un evento de sandbox no se aplica, salio %', v_r; end if;

  -- App User ID que no es nuestro
  v_r := public.apply_subscription_event(
    'evt-anon', 'RENEWAL', '$RCAnonymousID:abc123', now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-x', now() + interval '10 days', null, null, '{}'::jsonb);
  if v_r <> 'unknown_profile' then raise exception '[4] App User ID ajeno, salio %', v_r; end if;

  -- todos quedan REGISTRADOS aunque no se apliquen
  if (select count(*) from public.subscription_events
       where event_id in ('evt-1','evt-0','evt-sbx','evt-anon')) <> 4 then
    raise exception '[4] los eventos no aplicados tambien se guardan';
  end if;
end $$;


-- ── [5] · el impago se abre y se cierra ──────────────────────────────────────
do $$
declare
  v_f1 uuid := '5a1a0000-0000-4000-8000-0000000000f1';
  e    public.subscription_entitlements%rowtype;
begin
  perform public.apply_subscription_event(
    'evt-bi', 'BILLING_ISSUE', v_f1::text, now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-1', now() - interval '1 day',
    now() + interval '7 days', 'rc-1', '{}'::jsonb);

  select * into e from public.subscription_entitlements where profile_id = v_f1;
  if e.billing_issue_detected_at is null or e.grace_period_expires_at is null then
    raise exception '[5] BILLING_ISSUE tiene que abrir el impago y guardar la gracia';
  end if;
  if e.access_until <= now() then
    raise exception '[5] en gracia sigue habiendo acceso, access_until=%', e.access_until;
  end if;

  -- pago recuperado: si esto NO limpia, access_until se queda anclado a la gracia vieja
  perform public.apply_subscription_event(
    'evt-rn', 'RENEWAL', v_f1::text, now() + interval '1 minute', 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-2', now() + interval '365 days', null, 'rc-1', '{}'::jsonb);

  select * into e from public.subscription_entitlements where profile_id = v_f1;
  if e.billing_issue_detected_at is not null or e.grace_period_expires_at is not null then
    raise exception '[5] el RENEWAL tiene que LIMPIAR el impago y la gracia';
  end if;
end $$;


-- ── [6] · cable trampa: nada aterriza en una cuenta borrada ──────────────────
do $$
declare
  v_d1 uuid := '5a1a0000-0000-4000-8000-00000000008d';
  v_r  text;
begin
  update public.profiles set deleted_at = now() where id = v_d1;

  v_r := public.apply_subscription_event(
    'evt-d1', 'RENEWAL', v_d1::text, now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-d', now() + interval '365 days', null, 'rc-d', '{}'::jsonb);
  if v_r <> 'deleted_profile' then
    raise exception '[6] un evento sobre cuenta borrada no se aplica, salio %', v_r;
  end if;

  -- el TRANSFER se distingue: es el incidente de privacidad, no un evento mas
  v_r := public.apply_subscription_event(
    'evt-d2', 'TRANSFER', v_d1::text, now(), 'PRODUCTION',
    'APP_STORE', 'misterfc_anual', 'txn-d', now() + interval '365 days', null, 'rc-d', '{}'::jsonb);
  if v_r <> 'transfer_to_deleted_profile' then
    raise exception '[6] el TRANSFER a cuenta borrada tiene motivo PROPIO, salio %', v_r;
  end if;

  if exists (select 1 from public.subscription_entitlements where profile_id = v_d1) then
    raise exception '[6] no puede haberse creado entitlement para una cuenta borrada';
  end if;

  update public.profiles set deleted_at = null where id = v_d1;
end $$;


-- ── [7] · el gancho del borrado de cuenta ────────────────────────────────────
do $$
declare
  v_d1 uuid := '5a1a0000-0000-4000-8000-00000000008d';
  v_req uuid;
  e    public.subscription_entitlements%rowtype;
  r    public.account_deletion_requests%rowtype;
begin
  insert into public.subscription_entitlements
    (profile_id, rc_customer_id, expires_at)
  values (v_d1, 'rc-d1', now() + interval '200 days');

  insert into public.account_deletion_requests (profile_id, status, deadline_at)
  values (v_d1, 'pending', now() + interval '30 days')
  returning id into v_req;

  perform public.finalize_account_deletion(v_d1);

  select * into e from public.subscription_entitlements where profile_id = v_d1;
  if e.unlinked_at is null then
    raise exception '[7] el remate tiene que DESENGANCHAR el entitlement';
  end if;
  if e.rc_customer_id is not null then
    raise exception '[7] el rc_customer_id se vacia tras encolar';
  end if;

  if not exists (select 1 from public.revenuecat_deletion_queue
                  where profile_id = v_d1 and app_user_id = v_d1::text and done_at is null) then
    raise exception '[7] el borrado del cliente en RevenueCat tiene que quedar ENCOLADO';
  end if;

  select * into r from public.account_deletion_requests where id = v_req;
  if r.entitlement_suspended_at is null then
    raise exception '[7] entitlement_suspended_at es el hueco que BC-1 reservo: hay que sellarlo';
  end if;
  if r.status <> 'completed' then
    raise exception '[7] la solicitud tiene que quedar completed';
  end if;

  -- y desenganchada, ya no entra nada mas
  if public.apply_subscription_event(
       'evt-post', 'RENEWAL', v_d1::text, now(), 'PRODUCTION',
       'APP_STORE', 'misterfc_anual', 'txn-d', now() + interval '365 days', null, 'rc-d', '{}'::jsonb)
     <> 'deleted_profile' then
    raise exception '[7] con unlinked_at puesto no se vuelve a aplicar nada';
  end if;
end $$;


-- ── [8] · candado de privilegios ─────────────────────────────────────────────
do $$
declare
  v_sig text := 'public.apply_subscription_event(text, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz, text, jsonb)';
  t     text;
  p     text;
begin
  -- En Supabase los default privileges abren las tablas nuevas a anon/authenticated POR
  -- NOMBRE: un REVOKE de PUBLIC no basta. Esto es lo que lo comprueba.
  foreach t in array array['subscription_events', 'revenuecat_deletion_queue'] loop
    foreach p in array array['select', 'insert', 'update', 'delete'] loop
      if has_table_privilege('authenticated', 'public.' || t, p)
         or has_table_privilege('anon', 'public.' || t, p) then
        raise exception '[8] %.% sigue abierta a %', t, p, 'authenticated/anon';
      end if;
    end loop;
  end loop;

  -- entitlements: SELECT si (lo acota la policy), escritura NO
  if not has_table_privilege('authenticated', 'public.subscription_entitlements', 'select') then
    raise exception '[8] la app necesita LEER su propio entitlement';
  end if;
  foreach p in array array['insert', 'update', 'delete'] loop
    if has_table_privilege('authenticated', 'public.subscription_entitlements', p) then
      raise exception '[8] subscription_entitlements no puede admitir % de authenticated', p;
    end if;
  end loop;

  -- la ingesta es solo del servidor
  if has_function_privilege('authenticated', v_sig, 'execute')
     or has_function_privilege('anon', v_sig, 'execute') then
    raise exception '[8] apply_subscription_event abierta a la app';
  end if;
  if not has_function_privilege('service_role', v_sig, 'execute') then
    raise exception '[8] service_role tiene que poder ingerir';
  end if;

  if has_function_privilege('authenticated', 'public.requires_subscription(uuid)', 'execute') then
    raise exception '[8] requires_subscription no es para la app';
  end if;
  if not has_function_privilege('authenticated', 'public.my_subscription_status()', 'execute') then
    raise exception '[8] la app necesita my_subscription_status';
  end if;

  -- y finalize_account_deletion conserva su EXECUTE tras el create or replace
  if not has_function_privilege('service_role', 'public.finalize_account_deletion(uuid)', 'execute') then
    raise exception '[8] finalize_account_deletion ha perdido el EXECUTE de service_role';
  end if;
end $$;


rollback;
