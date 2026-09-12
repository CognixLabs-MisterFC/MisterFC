-- SU-8 — la compra del REVISOR (migracion 20261066000000). Cubre:
--   [1]  Perfil NORMAL: un evento de sandbox se registra y NO se aplica. Es el
--        comportamiento de SU-1 y tiene que seguir intacto: sin esto, cualquiera con
--        TestFlight se abre la puerta de produccion gratis.
--   [2]  Perfil DESIGNADO: el mismo evento SI se aplica y crea el entitlement.
--   [3]  La VENTANA FIJA: del sandbox no se copia la fecha. Aunque la tienda diga que
--        vence en una hora (su reloj va acelerado), la fila dice 30 dias.
--   [4]  La designacion NO gana a los candados de ADR-0022: perfil anonimizado y fila
--        desenganchada siguen sin recibir nada, y el TRANSFER sigue distinguiendose.
--   [5]  La designacion CADUCA: con valid_until en el pasado vuelve a ser 'sandbox'.
--   [6]  Un evento de PRODUCCION de un perfil designado NO usa la ventana fija: las
--        fechas reales siguen mandando para todo lo que no sea sandbox.
--   [7]  Idempotencia: el mismo evento de sandbox dos veces = 'duplicate'.
--   [8]  CANDADO de privilegios: la lista cerrada a anon/authenticated (los default
--        privileges de Supabase las abren POR NOMBRE), RLS activada y SIN politicas.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_table_privilege, NUNCA provocando el 42501
-- (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('5a800000-0000-4000-8000-000000000001', 'Club SU8', 'club-su8');

-- n1 perfil normal · t1 designado vigente · c1 designado CADUCADO
-- d1 designado y anonimizado · u1 designado con la fila desenganchada
select pg_temp.new_test_user('5a8a0000-0000-4000-8000-000000000001', 'n1@su8.test', '{}'::jsonb);
select pg_temp.new_test_user('5a8a0000-0000-4000-8000-000000000002', 't1@su8.test', '{}'::jsonb);
select pg_temp.new_test_user('5a8a0000-0000-4000-8000-000000000003', 'c1@su8.test', '{}'::jsonb);
select pg_temp.new_test_user('5a8a0000-0000-4000-8000-000000000004', 'd1@su8.test', '{}'::jsonb);
select pg_temp.new_test_user('5a8a0000-0000-4000-8000-000000000005', 'u1@su8.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('5a8a0000-0000-4000-8000-000000000001', '5a800000-0000-4000-8000-000000000001', 'jugador'),
  ('5a8a0000-0000-4000-8000-000000000002', '5a800000-0000-4000-8000-000000000001', 'jugador'),
  ('5a8a0000-0000-4000-8000-000000000003', '5a800000-0000-4000-8000-000000000001', 'jugador'),
  ('5a8a0000-0000-4000-8000-000000000004', '5a800000-0000-4000-8000-000000000001', 'jugador'),
  ('5a8a0000-0000-4000-8000-000000000005', '5a800000-0000-4000-8000-000000000001', 'jugador');

-- La lista. t1/d1/u1 vigentes; c1 caducada ayer.
insert into public.subscription_test_profiles (profile_id, motivo, valid_until) values
  ('5a8a0000-0000-4000-8000-000000000002', 'App Review · pgTAP', now() + interval '7 days'),
  ('5a8a0000-0000-4000-8000-000000000003', 'App Review · caducada', now() - interval '1 day'),
  ('5a8a0000-0000-4000-8000-000000000004', 'App Review · borrada', now() + interval '7 days'),
  ('5a8a0000-0000-4000-8000-000000000005', 'App Review · desenganchada', now() + interval '7 days');

-- d1 anonimizada (lo que hace finalize_account_deletion con el perfil).
update public.profiles set deleted_at = now()
 where id = '5a8a0000-0000-4000-8000-000000000004';

-- u1 con la fila ya desenganchada, y con acceso por delante: si la designacion ganara,
-- este seria el caso que resucita una compra en una cuenta borrada.
insert into public.subscription_entitlements
  (profile_id, store, product_id, expires_at, unlinked_at)
values
  ('5a8a0000-0000-4000-8000-000000000005', 'APP_STORE', 'com.misterfc.app.suscripcion.anual',
   now() + interval '300 days', now());


-- ── [1] · un perfil normal no entra por el sandbox ───────────────────────────
do $$
declare
  v_n1  uuid := '5a8a0000-0000-4000-8000-000000000001';
  v_res text;
begin
  v_res := public.apply_subscription_event(
    'su8:normal:1', 'INITIAL_PURCHASE', v_n1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-n1',
    now() + interval '365 days', null, v_n1::text, '{"su8":"normal"}'::jsonb);

  if v_res <> 'sandbox' then
    raise exception '[1] un perfil normal tendria que quedarse en sandbox, y devolvio %', v_res;
  end if;

  -- Registrado, no aplicado: el libro de eventos no pierde nada.
  if not exists (select 1 from public.subscription_events
                  where event_id = 'su8:normal:1'
                    and applied = false and skipped_reason = 'sandbox'
                    and environment = 'SANDBOX') then
    raise exception '[1] el evento tendria que quedar registrado como sandbox sin aplicar';
  end if;

  if exists (select 1 from public.subscription_entitlements where profile_id = v_n1) then
    raise exception '[1] NO tendria que haber entitlement de un perfil normal';
  end if;
end $$;


-- ── [2] y [3] · el designado entra, y con la ventana FIJA ────────────────────
do $$
declare
  v_t1     uuid := '5a8a0000-0000-4000-8000-000000000002';
  v_res    text;
  v_hasta  timestamptz;
  v_dias   numeric;
begin
  -- La tienda dice que vence en UNA HORA: es el reloj acelerado del sandbox.
  v_res := public.apply_subscription_event(
    'su8:test:1', 'INITIAL_PURCHASE', v_t1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-t1',
    now() + interval '1 hour', null, v_t1::text, '{"su8":"designado"}'::jsonb);

  if v_res <> 'applied' then
    raise exception '[2] el perfil designado tendria que aplicar, y devolvio %', v_res;
  end if;

  select access_until into v_hasta
    from public.subscription_entitlements where profile_id = v_t1;

  if v_hasta is null then
    raise exception '[2] el designado tendria que tener fecha de corte';
  end if;

  -- [3] · 30 dias, no una hora. Es la diferencia entre que el revisor pueda volver
  -- manana y que nos rechace.
  v_dias := extract(epoch from (v_hasta - now())) / 86400;
  if v_dias < 29 or v_dias > 31 then
    raise exception '[3] la ventana del sandbox tendria que ser de 30 dias, y son % dias', round(v_dias, 3);
  end if;

  -- Y tiene acceso de verdad, no solo una fila.
  if not exists (select 1 from public.subscription_entitlements
                  where profile_id = v_t1 and access_until > now()) then
    raise exception '[3] el designado tendria que tener acceso';
  end if;

  -- El evento queda marcado como aplicado Y como de sandbox: se puede auditar quien
  -- entro por esta puerta.
  if not exists (select 1 from public.subscription_events
                  where event_id = 'su8:test:1'
                    and applied = true and environment = 'SANDBOX') then
    raise exception '[3] el evento aplicado tendria que quedar marcado como SANDBOX';
  end if;
end $$;


-- ── [4] · la designacion NO gana a los candados ──────────────────────────────
do $$
declare
  v_d1  uuid := '5a8a0000-0000-4000-8000-000000000004';
  v_u1  uuid := '5a8a0000-0000-4000-8000-000000000005';
  v_res text;
begin
  -- Perfil anonimizado: designado o no, no se aplica.
  v_res := public.apply_subscription_event(
    'su8:borrada:1', 'INITIAL_PURCHASE', v_d1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-d1',
    now() + interval '1 hour', null, v_d1::text, '{"su8":"borrada"}'::jsonb);

  if v_res <> 'deleted_profile' then
    raise exception '[4] una cuenta anonimizada designada tendria que dar deleted_profile, y dio %', v_res;
  end if;

  if exists (select 1 from public.subscription_entitlements where profile_id = v_d1) then
    raise exception '[4] no tendria que haberse creado entitlement de una cuenta anonimizada';
  end if;

  -- Fila desenganchada: tampoco.
  v_res := public.apply_subscription_event(
    'su8:desenganchada:1', 'RENEWAL', v_u1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-u1',
    now() + interval '1 hour', null, v_u1::text, '{"su8":"desenganchada"}'::jsonb);

  if v_res <> 'deleted_profile' then
    raise exception '[4] una fila desenganchada designada tendria que dar deleted_profile, y dio %', v_res;
  end if;

  -- Y el cable trampa del TRANSFER sigue distinguiendose (ADR-0022 §4d).
  v_res := public.apply_subscription_event(
    'su8:transfer:1', 'TRANSFER', v_d1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-d1b',
    now() + interval '1 hour', null, v_d1::text, '{"su8":"transfer"}'::jsonb);

  if v_res <> 'transfer_to_deleted_profile' then
    raise exception '[4] el cable trampa del TRANSFER tendria que seguir puesto, y dio %', v_res;
  end if;
end $$;


-- ── [5] · la designacion caduca sola ─────────────────────────────────────────
do $$
declare
  v_c1  uuid := '5a8a0000-0000-4000-8000-000000000003';
  v_res text;
begin
  v_res := public.apply_subscription_event(
    'su8:caducada:1', 'INITIAL_PURCHASE', v_c1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-c1',
    now() + interval '365 days', null, v_c1::text, '{"su8":"caducada"}'::jsonb);

  if v_res <> 'sandbox' then
    raise exception '[5] una designacion caducada NO tendria que aplicar, y devolvio %', v_res;
  end if;

  if exists (select 1 from public.subscription_entitlements where profile_id = v_c1) then
    raise exception '[5] una designacion caducada no tendria que crear entitlement';
  end if;
end $$;


-- ── [6] · produccion sigue usando las fechas de verdad ───────────────────────
do $$
declare
  v_t1    uuid := '5a8a0000-0000-4000-8000-000000000002';
  v_res   text;
  v_hasta timestamptz;
  v_dias  numeric;
begin
  -- El mismo perfil designado, pero un evento de PRODUCCION: aqui la ventana fija no
  -- pinta nada, manda la fecha de la tienda.
  v_res := public.apply_subscription_event(
    'su8:prod:1', 'RENEWAL', v_t1::text, now() + interval '1 minute', 'PRODUCTION',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-t1',
    now() + interval '365 days', null, v_t1::text, '{"su8":"produccion"}'::jsonb);

  if v_res <> 'applied' then
    raise exception '[6] un evento de produccion tendria que aplicar, y devolvio %', v_res;
  end if;

  select access_until into v_hasta
    from public.subscription_entitlements where profile_id = v_t1;
  v_dias := extract(epoch from (v_hasta - now())) / 86400;

  if v_dias < 360 then
    raise exception '[6] produccion tendria que usar la fecha real (365 dias), y son % dias', round(v_dias, 3);
  end if;
end $$;


-- ── [7] · idempotencia ───────────────────────────────────────────────────────
do $$
declare
  v_t1  uuid := '5a8a0000-0000-4000-8000-000000000002';
  v_res text;
begin
  v_res := public.apply_subscription_event(
    'su8:test:1', 'INITIAL_PURCHASE', v_t1::text, now(), 'SANDBOX',
    'APP_STORE', 'com.misterfc.app.suscripcion.anual', 'txn-t1',
    now() + interval '1 hour', null, v_t1::text, '{"su8":"repetido"}'::jsonb);

  if v_res <> 'duplicate' then
    raise exception '[7] el mismo evento dos veces tendria que ser duplicate, y dio %', v_res;
  end if;
end $$;


-- ── [8] · candado de privilegios ─────────────────────────────────────────────
do $$
declare
  v_p text;
begin
  -- En Supabase los default privileges abren las tablas nuevas a anon/authenticated POR
  -- NOMBRE: un REVOKE de PUBLIC no basta. Esto es lo que lo comprueba.
  foreach v_p in array array['select', 'insert', 'update', 'delete'] loop
    if has_table_privilege('authenticated', 'public.subscription_test_profiles', v_p)
       or has_table_privilege('anon', 'public.subscription_test_profiles', v_p) then
      raise exception '[8] la lista de perfiles de prueba sigue abierta a % para anon/authenticated', v_p;
    end if;
  end loop;

  if not (select relrowsecurity from pg_class
           where oid = 'public.subscription_test_profiles'::regclass) then
    raise exception '[8] la lista tendria que tener RLS activada';
  end if;

  -- Sin politicas: con RLS y sin ninguna, nadie que pase por PostgREST ve la lista.
  if exists (select 1 from pg_policy
              where polrelid = 'public.subscription_test_profiles'::regclass) then
    raise exception '[8] la lista NO tendria que tener politicas: se queda solo para el dueno y el service_role';
  end if;

  -- Y el motivo es obligatorio: una lista de UUID sin motivo no se limpia nunca.
  begin
    insert into public.subscription_test_profiles (profile_id, motivo, valid_until)
    values ('5a8a0000-0000-4000-8000-000000000001', '   ', now() + interval '1 day');
    raise exception '[8] un motivo en blanco tendria que estar prohibido';
  exception
    when check_violation then null;
  end;
end $$;


select 'SU-8 OK' as resultado;

rollback;
