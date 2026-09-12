-- ════════════════════════════════════════════════════════════════════════════
-- SU-8 · La compra del REVISOR. Sandbox aceptado, pero solo para una lista.
--
-- EL PROBLEMA, y bloquea la publicación: **Apple ejecuta la compra del revisor en el
-- SANDBOX**, aunque el build vaya firmado para producción. RevenueCat valida los dos
-- entornos y nos manda el webhook con `environment: SANDBOX`. Y `apply_subscription_event`
-- (SU-1) no aplica nada que no sea PRODUCTION — con buen motivo: sin eso, cualquiera con
-- TestFlight se abre la puerta de producción gratis.
--
-- Consecuencia que no vi al escribir SU-1: el revisor paga, lee «tu pago se ha registrado,
-- pero la activación está tardando», y NO entra. Rechazo garantizado. Y no lo salva ni
-- «Restaurar compras» ni la reclamación de SU-6b: las dos acaban en el mismo evento de
-- sandbox.
--
-- LA SALIDA, y es la mínima: una LISTA EXPLÍCITA de perfiles de prueba. Un evento de
-- sandbox se aplica si y solo si el perfil está en ella y la designación no ha caducado.
-- Para cualquier otra cuenta, SANDBOX se sigue registrando y NO aplicando, exactamente
-- como hasta ahora.
--
-- TRES PROPIEDADES QUE NO SE NEGOCIAN, y las tres están probadas en pgTAP:
--
--   1. La designación **no gana** a los candados de ADR-0022. Un perfil designado que
--      esté anonimizado o cuya fila esté desenganchada sigue sin recibir nada, y el cable
--      trampa del TRANSFER sigue puesto. Eso sale gratis por la ESTRUCTURA: al dejar de
--      cortar en la rama del sandbox, el evento pasa por los mismos `if` que uno de
--      producción, no por un atajo.
--
--   2. **Del sandbox no se copia la fecha.** Apple acelera el tiempo: una suscripción
--      anual renueva cada ~30-60 minutos y deja de renovar a las ~6 veces. Copiar su
--      `expires_at` daría al revisor menos de una hora de acceso. Ventana FIJA de 30 días
--      (decisión de Jose), que además no depende de cuántas veces renueve su reloj.
--
--   3. La designación **caduca sola**. Un perfil olvidado en la lista es un agujero
--      permanente por el que esa cuenta puede concederse acceso de producción con compras
--      de pruebas. `valid_until` es obligatorio y la comprobación es `> now()`: si nadie
--      lo renueva, la puerta se cierra sin que nadie tenga que acordarse.
--
-- Lo que NO cambia: ni una fila de producción, ni el comportamiento para ninguna cuenta
-- real (la tabla nace VACÍA, así que `not exists` es siempre verdadero y la función se
-- comporta byte a byte como hoy hasta que el operador meta un perfil).
--
-- La función va `create or replace` sobre su **definición viva de producción**
-- (`pg_get_functiondef`, md5 3e0dcdc636f7ca510cf810e0656bf622, contrastada contra la
-- migración 20261063000000: idéntica salvo espacios y la etiqueta del dollar-quote), con
-- TRES inserciones y nada más.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. subscription_test_profiles — la lista. Tabla propia y no una columna en
--    `profiles` (decisión de Jose), y se agradece por tres motivos: nace vacía y se
--    queda vacía en operación normal, se puede leer de un vistazo quién tiene el
--    permiso, y quitar a alguien es un DELETE y no un UPDATE sobre la tabla que
--    sostienen 52 claves ajenas.
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.subscription_test_profiles (
  -- FK NO ACTION, como todo lo que apunta a `profiles` (ADR-0021): las filas de perfil
  -- no se borran nunca, se anonimizan.
  profile_id   uuid primary key references public.profiles(id),
  -- Obligatorio y a propósito: una lista de UUID sin motivo es una lista que nadie se
  -- atreve a limpiar. Aquí se escribe para qué ("App Review · envío de octubre").
  motivo       text not null check (length(btrim(motivo)) > 0),
  -- Sin default: el operador tiene que decir hasta cuándo. Una designación sin fecha es
  -- la que se olvida puesta.
  valid_until  timestamptz not null,
  created_at   timestamptz not null default now()
);

comment on table public.subscription_test_profiles is
  'SU-8 — perfiles cuyas compras de SANDBOX sí conceden acceso, para que el revisor de Apple pueda comprar (compra siempre en sandbox). Nace y vive VACÍA; la llena el operador antes de un envío. La designación caduca por `valid_until`.';
comment on column public.subscription_test_profiles.valid_until is
  'Fin de la designación. La comprobación es `> now()`: una designación caducada NO aplica eventos de sandbox, sin que nadie tenga que acordarse de quitarla.';

-- La lista de cuentas de prueba no es dato de usuario: no la ve nadie por la API.
-- `revoke` explícito a `anon` y `authenticated` porque las default privileges de Supabase
-- otorgan POR NOMBRE en cada tabla nueva del esquema public — un revoke a PUBLIC no basta.
alter table public.subscription_test_profiles enable row level security;
revoke all on table public.subscription_test_profiles from public;
revoke all on table public.subscription_test_profiles from anon, authenticated;

-- Sin políticas: con RLS activada y sin ninguna, nadie que pase por PostgREST lee ni
-- escribe. Solo el dueño (las funciones SECURITY DEFINER) y el service_role.

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. apply_subscription_event — la puerta del sandbox y el reloj que no se cree.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_subscription_event(p_event_id text, p_type text, p_app_user_id text, p_event_at timestamp with time zone, p_environment text, p_store text, p_product_id text, p_store_transaction_id text, p_expires_at timestamp with time zone, p_grace_period_expires_at timestamp with time zone, p_rc_customer_id text, p_payload jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_profile uuid;
  v_ent     public.subscription_entitlements%rowtype;
  v_reason  text;
  -- SU-8 · ¿viene del sandbox de la tienda? Se calcula una vez y se usa dos veces:
  -- para decidir si se aplica y para no creerse su reloj.
  v_sandbox boolean;
begin
  v_sandbox := upper(p_environment) <> 'PRODUCTION';
  -- El App User ID es `profiles.id` (ADR-0022 §1). Si no es un UUID, no es nuestro.
  begin
    v_profile := p_app_user_id::uuid;
  exception when others then
    v_profile := null;
  end;

  if v_profile is not null
     and not exists (select 1 from public.profiles where id = v_profile) then
    v_profile := null;
  end if;

  -- Serializa por cuenta: dos entregas del mismo evento a la vez no se pisan.
  if v_profile is not null then
    perform pg_advisory_xact_lock(hashtext('subscription:' || v_profile::text));
  end if;

  -- ── Deduplicación. La PK es el juez: si ya estaba, no se toca nada más.
  insert into public.subscription_events
    (event_id, type, app_user_id, profile_id, event_at, environment, store, payload)
  values
    (p_event_id, p_type, p_app_user_id, v_profile, p_event_at,
     upper(p_environment), p_store, p_payload)
  on conflict (event_id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  -- ── Motivos para NO aplicar. Se registran, no se pierden.
  if v_profile is null then
    v_reason := 'unknown_profile';
  elsif v_sandbox and not exists (
          -- SU-8 · ÚNICA excepción, y es una lista explícita: el revisor de Apple compra
          -- SIEMPRE en sandbox, así que sin esto paga y no entra (rechazo garantizado).
          -- Un perfil que no esté en la lista, o cuya designación haya caducado, sigue
          -- sin poder abrirse la puerta de producción con una compra de pruebas.
          select 1 from public.subscription_test_profiles tp
           where tp.profile_id = v_profile
             and tp.valid_until > now()) then
    -- Un evento de SANDBOX no puede dar acceso de producción.
    v_reason := 'sandbox';
  else
    select * into v_ent from public.subscription_entitlements where profile_id = v_profile;

    if exists (select 1 from public.profiles
                where id = v_profile and deleted_at is not null)
       or v_ent.unlinked_at is not null then
      -- ADR-0022 §4d · CABLE TRAMPA. Una compra que aterriza en una cuenta borrada es un
      -- incidente de privacidad, no un evento más. SU-3 lo convierte en alerta.
      v_reason := case when upper(p_type) = 'TRANSFER'
                       then 'transfer_to_deleted_profile'
                       else 'deleted_profile' end;
    elsif v_ent.profile_id is not null
          and v_ent.last_event_at is not null
          and v_ent.last_event_at > p_event_at then
      -- No garantizan el orden: aplicar solo si es más nuevo.
      v_reason := 'stale';
    end if;
  end if;

  if v_reason is not null then
    update public.subscription_events
       set skipped_reason = v_reason
     where event_id = p_event_id;
    return v_reason;
  end if;

  -- ── Aplicar. BILLING_ISSUE abre el impago y trae la fecha de fin de gracia; cualquier
  --    evento de buen estado los limpia (si no, `access_until` se quedaría anclado).
  insert into public.subscription_entitlements as e (
    profile_id, rc_customer_id, store, product_id, store_transaction_id,
    expires_at, grace_period_expires_at, billing_issue_detected_at,
    last_event_id, last_event_at, updated_at
  )
  values (
    v_profile, p_rc_customer_id, p_store, p_product_id, p_store_transaction_id,
    -- SU-8 · Del sandbox NO se copia la fecha. Apple acelera el tiempo ahí: una
    -- suscripción anual renueva cada ~30-60 min y deja de renovar a las ~6 veces, así
    -- que su `expires_at` daría al revisor menos de una hora de acceso y lo dejaría
    -- fuera si vuelve al día siguiente. Ventana FIJA de 30 días, y solo puede tocarle a
    -- un perfil de la lista (aquí ya se ha pasado esa puerta).
    case when v_sandbox then now() + interval '30 days' else p_expires_at end,
    case when upper(p_type) = 'BILLING_ISSUE' then p_grace_period_expires_at end,
    case when upper(p_type) = 'BILLING_ISSUE' then p_event_at end,
    p_event_id, p_event_at, now()
  )
  on conflict (profile_id) do update set
    rc_customer_id            = coalesce(excluded.rc_customer_id, e.rc_customer_id),
    store                     = coalesce(excluded.store, e.store),
    product_id                = coalesce(excluded.product_id, e.product_id),
    store_transaction_id      = coalesce(excluded.store_transaction_id, e.store_transaction_id),
    expires_at                = excluded.expires_at,
    grace_period_expires_at   = excluded.grace_period_expires_at,
    billing_issue_detected_at = excluded.billing_issue_detected_at,
    last_event_id             = excluded.last_event_id,
    last_event_at             = excluded.last_event_at,
    updated_at                = now();

  update public.subscription_events set applied = true where event_id = p_event_id;
  return 'applied';
end;
$function$;

comment on function public.apply_subscription_event(
  text, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz, text, jsonb) is
  'SU-1/SU-8 — ingesta idempotente de un webhook de RevenueCat. Devuelve applied/duplicate/stale/sandbox/unknown_profile/deleted_profile/transfer_to_deleted_profile. Un evento de SANDBOX solo se aplica si el perfil está en subscription_test_profiles con la designación vigente, y entonces la fecha de corte es una ventana FIJA de 30 días (el reloj del sandbox va acelerado).';
