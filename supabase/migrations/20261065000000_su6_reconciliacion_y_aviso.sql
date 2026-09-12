-- SU-6a · 2/2 — RECONCILIACIÓN nocturna y AVISO de vencimiento (ADR-0022 §6).
--
-- POR QUÉ EXISTE LA RECONCILIACIÓN. RevenueCat entrega los webhooks con semántica
-- *at least once* pero **deja de reintentar tras 5 entregas** (5, 10, 20, 40 y 80
-- minutos). Un corte nuestro de unas horas son eventos perdidos PARA SIEMPRE. Y hay un
-- agujero peor, que no depende de que estemos caídos:
--
--   Google NO manda ningún evento en la transición GRACIA → ACCOUNT HOLD. RevenueCat
--   envía `EXPIRATION` al FINAL del account hold, que con su política vigente desde
--   diciembre de 2025 dura 60 días menos la gracia configurada. O sea que una cuenta
--   puede llevar SEMANAS sin acceso real en la tienda mientras nuestra proyección sigue
--   diciendo que todo va bien.
--
-- Por eso las cuentas con `billing_issue_detected_at` puesto van PRIMERAS: son el único
-- sitio donde la verdad puede divergir durante semanas.
--
-- ⚠️ EL PELIGRO QUE MANDA EN ESTE FICHERO, medido al escribir SU-3:
--
--   `GET /v1/subscribers/{app_user_id}` de RevenueCat devuelve **201 y CREA el cliente**
--   si no existe. Preguntar por una cuenta que acabamos de anonimizar la RESUCITARÍA en
--   su lado: el espejo exacto de lo que ADR-0022 §4 existe para impedir.
--
-- La defensa NO se deja en el cliente de TypeScript, que es donde se olvidaría: la
-- impone `subscription_reconcile_candidates`, que no puede devolver una cuenta
-- desenganchada ni un perfil anonimizado. Si el servidor solo pregunta por lo que esa
-- función le da, no hay forma de resucitar a nadie. Mismo criterio que ADR-0021: que lo
-- imponga el esquema y no la buena memoria de quien escriba el próximo PR.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. `reconciled_at` — cuándo se le preguntó a RevenueCat por última vez.
--
--    Es lo que hace posible barrer por ANTIGÜEDAD: sin esto, "lo más rancio primero"
--    no se puede ordenar y el barrido preguntaría siempre por los mismos.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.subscription_entitlements
  add column if not exists reconciled_at timestamptz;

comment on column public.subscription_entitlements.reconciled_at is
  'SU-6 — última vez que se preguntó a RevenueCat por esta cuenta y respondió. NULL = nunca. Ordena el barrido por antigüedad.';

-- El barrido pide candidatos por prioridad. Parcial: las desenganchadas quedan FUERA del
-- índice, así que ni siquiera se pueden recorrer por aquí.
create index if not exists subscription_entitlements_reconcile_idx
  on public.subscription_entitlements (reconciled_at nulls first)
  where unlinked_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscription_reconcile_candidates — EL CANDADO.
--
--    Lo único que el servidor puede preguntar a RevenueCat. Dos filtros que no son
--    optimizaciones, son la defensa contra la resurrección:
--      · `e.unlinked_at is null`  — la cuenta no se ha desenganchado por borrado;
--      · `p.deleted_at is null`   — el perfil no está anonimizado.
--    Cualquiera de los dos basta; van los dos porque el desenganche y la anonimización
--    son escrituras distintas y una podría fallar sin la otra.
--
--    ORDEN, y es lo que pidió Jose:
--      1º impago abierto  — Google no avisa de gracia → account hold;
--      2º lo más rancio   — la red de los webhooks perdidos (dejan de reintentar);
--      3º lo que vence antes.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.subscription_reconcile_candidates(
  p_limit       integer default 25,
  p_stale_days  integer default 7,
  p_soon_days   integer default 3
)
returns table (
  profile_id      uuid,
  app_user_id     text,
  rc_customer_id  text,
  access_until    timestamptz,
  billing_issue   boolean,
  reconciled_at   timestamptz,
  priority        text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.profile_id,
    -- El App User ID es `profiles.id` (ADR-0022 §1). Se devuelve explícito para que el
    -- servidor no lo derive por su cuenta.
    e.profile_id::text,
    e.rc_customer_id,
    e.access_until,
    e.billing_issue_detected_at is not null,
    e.reconciled_at,
    case
      when e.billing_issue_detected_at is not null then 'billing_issue'
      when e.reconciled_at is null                 then 'never'
      when e.access_until < now() + make_interval(days => p_soon_days) then 'expiring'
      else 'stale'
    end
  from public.subscription_entitlements e
  join public.profiles p on p.id = e.profile_id
  where e.unlinked_at is null      -- CANDADO 1 · no desenganchada
    and p.deleted_at is null       -- CANDADO 2 · no anonimizada
    and (
         e.billing_issue_detected_at is not null
      or e.reconciled_at is null
      or e.reconciled_at < now() - make_interval(days => p_stale_days)
      or (e.access_until is not null
          and e.access_until < now() + make_interval(days => p_soon_days))
    )
  order by
    (e.billing_issue_detected_at is not null) desc,
    coalesce(e.reconciled_at, '-infinity'::timestamptz) asc,
    e.access_until asc nulls first
  limit greatest(p_limit, 0);
$$;

revoke all on function public.subscription_reconcile_candidates(integer, integer, integer) from public;
revoke all on function public.subscription_reconcile_candidates(integer, integer, integer) from anon, authenticated;
grant execute on function public.subscription_reconcile_candidates(integer, integer, integer) to service_role;

comment on function public.subscription_reconcile_candidates(integer, integer, integer) is
  'SU-6 — las ÚNICAS cuentas por las que se puede preguntar a RevenueCat. Excluye desenganchadas y anonimizadas: su GET /subscribers CREA el cliente (201), así que preguntar por una cuenta borrada la resucitaría (ADR-0022 §4). Orden: impago abierto, luego lo más rancio, luego lo que vence antes.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. reconcile_subscription_entitlement — aplicar lo que dijo RevenueCat.
--
--    Vuelve a comprobar los dos candados: la fila pudo desengancharse entre que se pidió
--    la lista y que llegó la respuesta HTTP. No es paranoia, es una ventana real de
--    segundos con un borrado de cuenta corriendo en paralelo.
--
--    Solo deja rastro en el libro de eventos cuando CAMBIA algo. Una reconciliación que
--    confirma lo que ya sabíamos actualiza `reconciled_at` y nada más: si no, el libro
--    se llenaría de ruido diario y los eventos de verdad quedarían enterrados.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reconcile_subscription_entitlement(
  p_profile_id              uuid,
  p_expires_at              timestamptz,
  p_grace_period_expires_at timestamptz,
  p_billing_issue_at        timestamptz,
  p_store                   text default null,
  p_product_id              text default null,
  p_store_transaction_id    text default null,
  p_rc_customer_id          text default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.subscription_entitlements%rowtype;
  v_changed boolean;
begin
  perform pg_advisory_xact_lock(hashtext('subscription:' || p_profile_id::text));

  select * into v_old
    from public.subscription_entitlements
   where profile_id = p_profile_id;

  if not found then
    -- No se crean filas aquí. Una cuenta sin entitlement no sale de
    -- `subscription_reconcile_candidates`, así que llegar con una es señal de que
    -- alguien preguntó por su cuenta sin pasar por el candado.
    return 'unknown_profile';
  end if;

  if v_old.unlinked_at is not null then
    return 'skipped_unlinked';
  end if;

  if exists (select 1 from public.profiles
              where id = p_profile_id and deleted_at is not null) then
    return 'skipped_deleted';
  end if;

  v_changed :=
       v_old.expires_at              is distinct from p_expires_at
    or v_old.grace_period_expires_at is distinct from p_grace_period_expires_at
    or v_old.billing_issue_detected_at is distinct from p_billing_issue_at;

  update public.subscription_entitlements
     set expires_at                = p_expires_at,
         grace_period_expires_at   = p_grace_period_expires_at,
         billing_issue_detected_at = p_billing_issue_at,
         store                     = coalesce(p_store, store),
         product_id                = coalesce(p_product_id, product_id),
         store_transaction_id      = coalesce(p_store_transaction_id, store_transaction_id),
         rc_customer_id            = coalesce(p_rc_customer_id, rc_customer_id),
         reconciled_at             = now(),
         updated_at                = case when v_changed then now() else updated_at end
   where profile_id = p_profile_id;

  if not v_changed then
    return 'noop';
  end if;

  -- Rastro SOLO cuando corrige. El `id` lleva milisegundos para no chocar con otra
  -- reconciliación del mismo segundo; el `on conflict` cubre el caso imposible.
  insert into public.subscription_events
    (event_id, type, app_user_id, profile_id, event_at, environment, store, applied, payload)
  values (
    'reconcile:' || p_profile_id::text || ':' || to_char(now(), 'YYYYMMDDHH24MISSMS'),
    'RECONCILE',
    p_profile_id::text,
    p_profile_id,
    now(),
    'PRODUCTION',
    coalesce(p_store, v_old.store),
    true,
    jsonb_build_object(
      'source', 'reconcile',
      'before', jsonb_build_object(
        'expires_at', v_old.expires_at,
        'grace_period_expires_at', v_old.grace_period_expires_at,
        'billing_issue_detected_at', v_old.billing_issue_detected_at
      ),
      'after', jsonb_build_object(
        'expires_at', p_expires_at,
        'grace_period_expires_at', p_grace_period_expires_at,
        'billing_issue_detected_at', p_billing_issue_at
      )
    )
  )
  on conflict (event_id) do nothing;

  return 'corrected';
end;
$$;

revoke all on function public.reconcile_subscription_entitlement(
  uuid, timestamptz, timestamptz, timestamptz, text, text, text, text) from public;
revoke all on function public.reconcile_subscription_entitlement(
  uuid, timestamptz, timestamptz, timestamptz, text, text, text, text) from anon, authenticated;
grant execute on function public.reconcile_subscription_entitlement(
  uuid, timestamptz, timestamptz, timestamptz, text, text, text, text) to service_role;

comment on function public.reconcile_subscription_entitlement(
  uuid, timestamptz, timestamptz, timestamptz, text, text, text, text) is
  'SU-6 — aplica lo que respondió RevenueCat. Vuelve a comprobar desenganche y anonimización (la fila pudo cambiar mientras iba la petición HTTP). Devuelve corrected/noop/skipped_unlinked/skipped_deleted/unknown_profile.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. notify_subscription_expiring — el AVISO.
--
--    Una sola notificación por FECHA DE VENCIMIENTO, no por día: la clave de dedupe
--    lleva la fecha, así que el cron puede correr todos los días sin repetir el aviso.
--    Si la persona renueva, la fecha cambia y el aviso siguiente será otro — correcto.
--
--    El literal del tipo se resuelve en EJECUCIÓN (cuerpo plpgsql), así que esta función
--    puede crearse en la misma migración que... no: el ALTER TYPE va en la hermana
--    `20261064000000`, que se aplica ANTES. Ver su cabecera.
--
--    El payload NO lleva "días restantes": `notifications.payload` es INMUTABLE (trigger
--    `notifications_protect_update`, medido en BC-7), así que un número de días sería
--    mentira al día siguiente. Va la fecha, que no caduca. Y no lleva nada personal.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.notify_subscription_expiring(
  p_days integer default 7
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  with candidatos as (
    select e.profile_id, e.access_until,
           e.billing_issue_detected_at is not null as billing_issue
      from public.subscription_entitlements e
      join public.profiles p on p.id = e.profile_id
     where e.unlinked_at is null
       and p.deleted_at is null
       and e.access_until is not null
       and e.access_until > now()
       and e.access_until <= now() + make_interval(days => p_days)
       -- Solo a quien de verdad paga: al staff no se le avisa de nada.
       and public.requires_subscription(e.profile_id)
  ), insertados as (
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      c.profile_id,
      'subscription_expiring'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'access_until', c.access_until,
        'billing_issue', c.billing_issue
      ),
      'subscription_expiring:' || c.profile_id::text || ':'
        || to_char(c.access_until, 'YYYY-MM-DD') || ':in_app'
    from candidatos c
    on conflict (dedupe_key) do nothing
    returning 1
  )
  select count(*)::integer into v_count from insertados;

  return v_count;
end;
$$;

revoke all on function public.notify_subscription_expiring(integer) from public;
revoke all on function public.notify_subscription_expiring(integer) from anon, authenticated;
grant execute on function public.notify_subscription_expiring(integer) to service_role;

comment on function public.notify_subscription_expiring(integer) is
  'SU-6 — avisa a quien PAGA de que su suscripción vence en <= p_days. Una notificación por fecha de vencimiento (la clave de dedupe la lleva), así que el cron puede correr a diario. El payload no lleva días restantes: notifications.payload es inmutable y un número de días sería mentira mañana.';
