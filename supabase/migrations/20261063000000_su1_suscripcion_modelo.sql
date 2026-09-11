-- SU-1 · MODELO de la suscripción anual (3 €/año, ADR-0022).
--
-- Decisión de fondo en ADR-0022: la capa de suscripción es RevenueCat, el App User ID
-- es `profiles.id`, y esta tabla NO es la verdad: es una PROYECCIÓN de la verdad de
-- RevenueCat, alimentada por sus webhooks. Existe porque el gate web se renderiza en el
-- servidor (Server Component, sin SDK móvil) y porque el antídoto contra la resurrección
-- necesita una fila nuestra.
--
-- Esta migración NO cobra nada ni bloquea nada todavía: pone el modelo, la regla de
-- quién paga y el desenganche del borrado de cuenta. El gate de interfaz va en SU-4/SU-5.
--
-- Tras aplicarla: añadir a mano las firmas nuevas a `packages/core/src/supabase/database.ts`
-- (NO `pnpm db:types` completo — borra los `| null` escritos a mano, ver PR #404).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. subscription_entitlements — la proyección. UNA fila por cuenta.
--
--    ADR-0022 §5 derogó el punto 2 de BC.0 §8: la clave NO es el identificador de la
--    tienda, es `profile_id`. Seguir una suscripción a través de las dos tiendas es
--    justo el problema que RevenueCat resuelve; `store_transaction_id` se guarda como
--    ATRIBUTO, para reconciliación y soporte.
--
--    `profile_id` va con NO ACTION (el default) a propósito, igual que
--    `account_deletion_requests`: la fila sobrevive a la anonimización del perfil y el
--    desenganche es una ESCRITURA EXPLÍCITA, nunca un efecto lateral de un DELETE.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.subscription_entitlements (
  profile_id                uuid primary key references public.profiles(id),
  -- Identificador de cliente en RevenueCat. Se guarda para poder pedir su BORRADO al
  -- rematar una cuenta (ADR-0022 §4c). Se vacía en el desenganche, no antes.
  rc_customer_id            text,
  -- Sin CHECK a propósito: RevenueCat añade tiendas (rc_billing, paddle, amazon…) y una
  -- tienda nueva no puede tumbar la ingesta. No es un campo que decida accesos.
  store                     text,
  product_id                text,
  store_transaction_id      text,
  -- Vencimiento normal del periodo pagado.
  expires_at                timestamptz,
  -- Fin del periodo de GRACIA de la tienda. Llega en `grace_period_expiration_at_ms`,
  -- que RevenueCat solo manda en el evento BILLING_ISSUE.
  grace_period_expires_at   timestamptz,
  billing_issue_detected_at timestamptz,
  -- Desenganche del borrado de cuenta. Con esto puesto no se aplica ningún evento más.
  unlinked_at               timestamptz,
  last_event_id             text,
  last_event_at             timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- La fecha hasta la que hay acceso. GENERADA, no escrita: la regla no se puede
  -- esquivar desde fuera.
  --
  -- Es el MÁXIMO, no el mínimo, y el detalle importa:
  --   · `expiration_at_ms` y `grace_period_expiration_at_ms` son campos DISTINTOS del
  --     webhook, y el segundo solo viaja en BILLING_ISSUE. En un impago el primero es el
  --     vencimiento que ya pasó y el segundo es hasta cuándo hay gracia. Con el MÍNIMO la
  --     gracia no daría ni un día de acceso, que es lo contrario de la decisión de Jose.
  --   · Si un día RevenueCat extendiera `expiration_at_ms` para cubrir la gracia, ambos
  --     valdrían lo mismo y el máximo seguiría siendo correcto.
  --   · Y si un evento de buen estado no llegara a limpiar `grace_period_expires_at`, el
  --     máximo deja pasar a quien SÍ ha pagado; el mínimo lo dejaría fuera. El modo de
  --     fallo del máximo es el benigno.
  -- El cierre del account hold de Google no depende de un evento: `grace_period_expires_at`
  -- ya lleva la fecha, y Google NO avisa de esa transición (ADR-0022 §6).
  access_until timestamptz generated always as (
    greatest(expires_at, grace_period_expires_at)
  ) stored
);

comment on table public.subscription_entitlements is
  'SU-1 — proyección del entitlement de RevenueCat (ADR-0022). NO es la verdad: la verdad es RevenueCat. Se escribe SOLO vía apply_subscription_event() y el desenganche de finalize_account_deletion.';
comment on column public.subscription_entitlements.access_until is
  'GENERADA = greatest(expires_at, grace_period_expires_at). La gracia DA acceso (decisión de Jose, revisión de ADR-0022 del 2026-09-11).';
comment on column public.subscription_entitlements.unlinked_at is
  'Desenganche por borrado de cuenta (ADR-0022 §4). Con esto puesto NINGÚN evento vuelve a tocar la fila: es el antídoto contra la resurrección.';

-- Barrido de reconciliación de SU-6: las cuentas con un impago abierto son el único
-- sitio donde nuestra proyección puede divergir de RevenueCat durante semanas.
create index subscription_entitlements_billing_issue_idx
  on public.subscription_entitlements (billing_issue_detected_at)
  where billing_issue_detected_at is not null and unlinked_at is null;

-- Vencimientos próximos (aviso de SU-6).
create index subscription_entitlements_access_until_idx
  on public.subscription_entitlements (access_until)
  where unlinked_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. subscription_events — el libro de eventos. Es NUESTRO y no desaparece con
--    RevenueCat: entregan *at least once*, avisan de que un mismo evento puede llegar
--    más de una vez, y NO garantizan el orden (ADR-0022 §6).
-- ─────────────────────────────────────────────────────────────────────────────
create table public.subscription_events (
  -- El `id` del webhook. PK = la deduplicación, impuesta por el motor y no por el código.
  event_id       text primary key,
  type           text not null,
  app_user_id    text not null,
  -- Resuelto a perfil. NULL si el App User ID no es un UUID nuestro (anónimo del SDK,
  -- o basura): se registra igual, no se aplica.
  profile_id     uuid references public.profiles(id),
  event_at       timestamptz not null,
  environment    text not null check (environment in ('SANDBOX', 'PRODUCTION')),
  store          text,
  applied        boolean not null default false,
  skipped_reason text,
  payload        jsonb not null,
  received_at    timestamptz not null default now()
);

comment on table public.subscription_events is
  'SU-1 — libro de eventos de RevenueCat. La PK es su `id` de webhook: la idempotencia la impone el motor. Un evento de una cuenta BORRADA se registra y NO se aplica (ADR-0022 §6).';

create index subscription_events_profile_idx
  on public.subscription_events (profile_id, event_at desc);
-- Los eventos que no se aplicaron son la cola de revisión de SU-3/SU-6.
create index subscription_events_skipped_idx
  on public.subscription_events (received_at desc)
  where applied = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. revenuecat_deletion_queue — el antídoto (ADR-0022 §4c).
--
--    Borrar el cliente en RevenueCat es una llamada HTTP y NO puede vivir dentro de la
--    transacción de Postgres que anonimiza la cuenta. Se encola aquí y la drena el
--    servidor, con reintento. La fila se conserva con `done_at` puesto: es la prueba de
--    que la supresión en el encargado de tratamiento se pidió.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.revenuecat_deletion_queue (
  profile_id  uuid primary key references public.profiles(id),
  app_user_id text not null,
  enqueued_at timestamptz not null default now(),
  attempts    integer not null default 0,
  last_error  text,
  done_at     timestamptz
);

comment on table public.revenuecat_deletion_queue is
  'SU-1 — cola del borrado de cliente en RevenueCat al rematar una cuenta (ADR-0022 §4c). La drena el servidor con la secret key; la fila se conserva como prueba.';

create index revenuecat_deletion_queue_pending_idx
  on public.revenuecat_deletion_queue (enqueued_at)
  where done_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS y privilegios.
--
--    OJO: en Supabase los privilegios por defecto ya conceden a `anon` y `authenticated`
--    POR NOMBRE sobre las tablas nuevas de `public`. Un REVOKE de PUBLIC no basta: hay
--    que revocar de los roles nombrados.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.subscription_entitlements  enable row level security;
alter table public.subscription_events        enable row level security;
alter table public.revenuecat_deletion_queue  enable row level security;

revoke all on public.subscription_entitlements  from anon, authenticated;
revoke all on public.subscription_events        from anon, authenticated;
revoke all on public.revenuecat_deletion_queue  from anon, authenticated;

-- La app necesita poder pintar "te renueva el 14 de marzo". Solo la fila propia y solo
-- lectura: escribir es exclusivo de las RPC y de service_role.
grant select on public.subscription_entitlements to authenticated;

create policy subscription_entitlements_select on public.subscription_entitlements
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_superadmin());

-- `subscription_events` y `revenuecat_deletion_queue` se quedan SIN policies: son cocina
-- del servidor. service_role no pasa por RLS; nadie más las ve.

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. requires_subscription — QUIÉN paga.
--
--    Decisión 2 de Jose: paga cada FAMILIA; cuerpo técnico, coordinación y dirección NO.
--    Decisión 3 de la ronda de respuestas: los SEGUIDORES pagan, igual que los tutores.
--
--    Medido contra producción el 2026-09-11: los 5 perfiles con membership de rol
--    `jugador` son EXACTAMENTE los 5 tutores de `player_accounts`. O sea que `jugador`
--    es la membership de la cuenta FAMILIAR en el club, no una cuenta de menor aparte.
--
--    El staff GANA: una cuenta que además es entrenador tiene acceso gratis. Es la única
--    lectura coherente con "la suscripción es por CUENTA, no por club" (decisión 4).
--
--    SECURITY DEFINER porque `memberships`, `player_accounts`, `player_spectators` y
--    `team_follows` llevan RLS: un INVOKER vería solo un trozo y respondería que no paga
--    quien sí paga. Cerrada a authenticated/anon: para eso está `my_subscription_status()`.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.requires_subscription(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    -- Gratis: superadmin de plataforma.
    not exists (select 1 from public.platform_admins pa where pa.profile_id = p_profile_id)
    -- Gratis: cuerpo técnico, coordinación y dirección, con la membership VIVA.
    and not exists (
      select 1 from public.memberships m
       where m.profile_id = p_profile_id
         and m.left_at is null
         and m.role in ('admin_club', 'director', 'coordinador',
                        'entrenador_principal', 'entrenador_ayudante')
    )
    -- Paga: tutor, seguidor, o miembro familiar del club.
    and (
         exists (select 1 from public.player_accounts    pa where pa.profile_id = p_profile_id)
      or exists (select 1 from public.player_spectators  ps where ps.spectator_profile_id = p_profile_id)
      or exists (select 1 from public.team_follows       tf where tf.profile_id = p_profile_id)
      or exists (select 1 from public.memberships m
                  where m.profile_id = p_profile_id and m.left_at is null and m.role = 'jugador')
    );
$$;

revoke all on function public.requires_subscription(uuid) from public;
revoke all on function public.requires_subscription(uuid) from anon, authenticated;
grant execute on function public.requires_subscription(uuid) to service_role;

comment on function public.requires_subscription(uuid) is
  'SU-1 — true si esta cuenta necesita suscripción. El staff (y el superadmin) van gratis y GANAN sobre el vínculo familiar. Cerrada a authenticated: la app usa my_subscription_status().';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. my_subscription_status — lo que lee el gate. Una sola ida y vuelta.
--
--    Estados: `staff_free` (no paga) · `active` · `grace` (impago abierto pero DENTRO de
--    la gracia de la tienda: DA ACCESO) · `expired` · `none` (nunca hubo) ·
--    `unlinked` (cuenta borrada).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.my_subscription_status()
returns table (
  requires_subscription boolean,
  has_access            boolean,
  state                 text,
  access_until          timestamptz,
  billing_issue         boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_req   boolean;
  v_ent   public.subscription_entitlements%rowtype;
begin
  if v_uid is null then
    raise exception 'no_session';
  end if;

  v_req := public.requires_subscription(v_uid);

  if not v_req then
    return query select false, true, 'staff_free'::text, null::timestamptz, false;
    return;
  end if;

  select * into v_ent from public.subscription_entitlements where profile_id = v_uid;

  if not found then
    return query select true, false, 'none'::text, null::timestamptz, false;
    return;
  end if;

  if v_ent.unlinked_at is not null then
    return query select true, false, 'unlinked'::text, null::timestamptz, false;
    return;
  end if;

  if v_ent.access_until is null or v_ent.access_until <= now() then
    return query select true, false, 'expired'::text, v_ent.access_until,
                        v_ent.billing_issue_detected_at is not null;
    return;
  end if;

  return query select
    true,
    true,
    case when v_ent.billing_issue_detected_at is not null then 'grace' else 'active' end,
    v_ent.access_until,
    v_ent.billing_issue_detected_at is not null;
end;
$$;

revoke all on function public.my_subscription_status() from public;
revoke all on function public.my_subscription_status() from anon;
grant execute on function public.my_subscription_status() to authenticated;

comment on function public.my_subscription_status() is
  'SU-1 — estado de suscripción de quien llama. `grace` DA ACCESO (revisión de ADR-0022 del 2026-09-11).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. apply_subscription_event — la ingesta. Vive en SQL, no en TypeScript, porque es
--    la pieza que hay que poder probar con pgTAP: la idempotencia y el orden son
--    nuestros (ADR-0022 §6) y son lo único que puede corromper la proyección.
--
--    Devuelve por qué hizo lo que hizo, para que SU-3 lo instrumente:
--      applied · duplicate · stale · sandbox · unknown_profile · deleted_profile ·
--      transfer_to_deleted_profile  ← ESTE es el cable trampa de ADR-0022 §4d.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apply_subscription_event(
  p_event_id                text,
  p_type                    text,
  p_app_user_id             text,
  p_event_at                timestamptz,
  p_environment             text,
  p_store                   text,
  p_product_id              text,
  p_store_transaction_id    text,
  p_expires_at              timestamptz,
  p_grace_period_expires_at timestamptz,
  p_rc_customer_id          text,
  p_payload                 jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile uuid;
  v_ent     public.subscription_entitlements%rowtype;
  v_reason  text;
begin
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
  elsif upper(p_environment) <> 'PRODUCTION' then
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
    p_expires_at,
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
$$;

revoke all on function public.apply_subscription_event(
  text, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz, text, jsonb) from public;
revoke all on function public.apply_subscription_event(
  text, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz, text, jsonb) from anon, authenticated;
grant execute on function public.apply_subscription_event(
  text, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz, text, jsonb) to service_role;

comment on function public.apply_subscription_event(
  text, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz, text, jsonb) is
  'SU-1 — ingesta idempotente de un webhook de RevenueCat. Devuelve applied/duplicate/stale/sandbox/unknown_profile/deleted_profile/transfer_to_deleted_profile.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. finalize_account_deletion — el gancho del desenganche.
--
--    Definición VERBATIM de producción (`pg_get_functiondef`, 2026-09-11) con UN bloque
--    nuevo insertado antes de 5.4 y `entitlement_suspended_at` añadido al UPDATE que ya
--    cerraba la solicitud. Todo lo demás queda byte a byte como está en la BD viva.
--
--    `create or replace`, nunca `drop` + `create`: conserva dueño y ACL.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_account_deletion(p_profile_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_req    public.account_deletion_requests%rowtype;
  v_avatar text;
  v_email  text;
begin
  perform pg_advisory_xact_lock(hashtext('account_deletion:' || p_profile_id::text));

  select * into v_req
    from public.account_deletion_requests
   where profile_id = p_profile_id and status = 'pending'
   limit 1;

  -- Idempotente para el cron: si ya está completado (o cancelado), no hay nada que hacer.
  if not found then
    return null;
  end if;

  select avatar_url into v_avatar from public.profiles where id = p_profile_id;
  select email       into v_email  from auth.users     where id = p_profile_id;

  -- 5.1 · El perfil: fuera la PII, queda la fila (la sostienen 52 FK, ADR-0021).
  update public.profiles
     set full_name     = null,
         avatar_url    = null,
         phone         = null,
         date_of_birth = null,
         deleted_at    = now(),
         updated_at    = now()
   where id = p_profile_id;

  -- 5.2 · Contacto que gestiona el club (no es el login).
  update public.memberships
     set phone = null, contact_email = null
   where profile_id = p_profile_id;

  -- 5.3 · Invitaciones DIRIGIDAS a esta persona: el email es suyo. Las que ÉL envió a
  -- otros no se tocan (ese email es de un tercero). Las no aceptadas se invalidan.
  update public.invitations
     set email      = 'deleted-' || id::text || '@deleted.invalid',
         expires_at = least(expires_at, now())
   where accepted_at is null
     and (invited_user_id = p_profile_id
          or (v_email is not null and lower(email) = lower(v_email)));

  update public.invitations
     set email = 'deleted-' || id::text || '@deleted.invalid'
   where accepted_at is not null
     and (invited_user_id = p_profile_id
          or (v_email is not null and lower(email) = lower(v_email)));

  -- ── BC-7 · AVISOS DEL REMATE ───────────────────────────────────────────────
  -- Va ANTES de 5.4 porque `tutor_unlinked` necesita player_accounts INTACTO: despues
  -- del delete ya no se sabe de que jugadores era tutor.
  --
  -- Un SAVEPOINT POR AVISO (BEGIN...EXCEPTION separados), no uno para los dos: si uno
  -- falla, el otro tiene que salir igual. En el ensayo de esta migracion un solo bloque
  -- se llevo por delante los dos avisos de golpe.
  --
  -- Best-effort en cualquier caso: un aviso que falle NO puede revertir una
  -- anonimizacion ya aplicada (5.1 ya vacio el perfil). Mismo criterio que
  -- trg_notify_erasure_requested.
  begin
    -- 1) OTRO TUTOR del mismo jugador. Se avisa al COMPLETAR y no al solicitar: hasta
    --    aqui el borrado era cancelable, y decirle a alguien "el otro tutor se va" por
    --    algo que puede no ocurrir es filtrar una intencion ajena. Ahora es un hecho, y
    --    ademas es accionable: pasa a ser el unico tutor del menor.
    --    Solo salen los jugadores que TIENEN otro tutor; de los que era unico tutor no
    --    hay a quien avisar (esos van por la via de erasure_requests).
    --    El nombre del MENOR si viaja: el destinatario es su propio tutor.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      other.profile_id,
      'tutor_unlinked'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'player_id', p.id,
        'player_first_name', p.first_name,
        'club_id', p.club_id
      ),
      'tutor_unlinked:' || v_req.id::text || ':' || p.id::text
        || ':' || other.profile_id::text || ':in_app'
    from public.player_accounts mine
    join public.players p on p.id = mine.player_id
    join public.player_accounts other
      on other.player_id = mine.player_id and other.profile_id <> p_profile_id
    where mine.profile_id = p_profile_id
      and p.erased_at is null
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: tutor_unlinked fallo para %: %', p_profile_id, sqlerrm;
  end;

  begin
    -- 2) SUPERADMIN, por cada club donde era admin_club. Es el momento en que el club
    --    se queda sin admin de verdad: la membership lleva de baja desde la solicitud y
    --    5.5 esta a punto de soltar clubs.owner_profile_id. El aviso de la SOLICITUD
    --    daba 30 dias de margen; este dice que se acabaron.
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
    select
      pa.profile_id,
      'account_deletion_completed'::public.notification_type,
      'in_app'::public.notification_channel,
      jsonb_build_object(
        'deletion_id', v_req.id,
        'club_id', m.club_id,
        'club_name', c.name,
        'role', 'admin_club',
        'is_platform', true
      ),
      'account_deletion_completed:' || v_req.id::text || ':' || m.club_id::text
        || ':' || pa.profile_id::text || ':in_app'
    from public.memberships m
    join public.clubs c on c.id = m.club_id
    cross join public.platform_admins pa
    where m.profile_id = p_profile_id
      and m.role = 'admin_club'
      and pa.profile_id <> p_profile_id
    on conflict (dedupe_key) do nothing;
  exception
    when others then
      raise warning 'BC-7: account_deletion_completed fallo para %: %', p_profile_id, sqlerrm;
  end;

  -- BC-7 · Las asignaciones de equipo se CIERRAN aqui, no al solicitar.
  -- `request_account_deletion` pone left_at en memberships con un UPDATE directo, sin
  -- pasar por `set_membership_left`, que es quien cierra team_staff en una baja normal
  -- — asi que hasta ahora el equipo seguia listando como entrenador ACTIVO a alguien
  -- que se habia ido. Cerrarlo en la SOLICITUD seria peor: el borrado es cancelable y
  -- `set_membership_left` no reabre team_staff al reactivar (migracion
  -- 20261053000000), o sea que arrepentirse dejaria al entrenador sin sus equipos.
  -- Aqui ya no hay vuelta atras. Esto NO es un aviso: va fuera del best-effort, porque
  -- es parte del borrado y tiene que ser atomico con el.
  -- `greatest` protege el CHECK team_staff_check (left_at >= joined_at).
  update public.team_staff ts
     set left_at = greatest(current_date, ts.joined_at)
    from public.memberships m
   where m.id = ts.membership_id
     and m.profile_id = p_profile_id
     and ts.left_at is null;

  -- ── SU-1 · DESENGANCHE DE LA SUSCRIPCIÓN (ADR-0022 §4c) ────────────────────
  -- NO es best-effort y NO va en un savepoint: es parte del borrado. Si esto falla,
  -- la anonimización debe fallar entera, porque una cuenta anonimizada cuyo cliente
  -- de RevenueCat sigue vivo es exactamente el incidente que ADR-0021 evita.
  --
  -- El orden importa: la cola se lee ANTES de vaciar `rc_customer_id`, porque el
  -- servidor necesita el App User ID para llamar a su API de borrado.
  insert into public.revenuecat_deletion_queue (profile_id, app_user_id)
  values (p_profile_id, p_profile_id::text)
  on conflict (profile_id) do nothing;

  -- La fila NO se borra (FK NO ACTION, ADR-0022 §5): queda desenganchada. Con
  -- `unlinked_at` puesto, `apply_subscription_event` ya no vuelve a tocarla nunca.
  update public.subscription_entitlements
     set unlinked_at     = now(),
         rc_customer_id  = null,
         updated_at      = now()
   where profile_id = p_profile_id
     and unlinked_at is null;

  -- 5.4 · Vínculos y canales: se borran de verdad.
  delete from public.player_accounts          where profile_id = p_profile_id;
  delete from public.team_follows             where profile_id = p_profile_id;
  delete from public.player_spectators        where spectator_profile_id = p_profile_id;
  delete from public.team_chat_participation  where profile_id = p_profile_id;
  delete from public.team_conversation_reads  where profile_id = p_profile_id;
  delete from public.staff_conversation_reads where profile_id = p_profile_id;
  delete from public.expo_push_tokens         where user_id = p_profile_id;
  delete from public.push_subscriptions       where user_id = p_profile_id;
  delete from public.notification_preferences where user_id = p_profile_id;
  delete from public.notifications            where user_id = p_profile_id;

  -- 5.5 · Si era el dueño de un club, se libera el hueco. `assign_club_owner_on_admin`
  -- solo escribe cuando owner_profile_id es NULL, así que sin esto el admin_club nuevo
  -- que designe la plataforma nunca pasaría a ser owner.
  update public.clubs set owner_profile_id = null where owner_profile_id = p_profile_id;

  -- 5.6 · Las supresiones de menor que sigan pendientes SE QUEDAN pendientes: el dato
  -- del menor tiene otro responsable (el club) y otro plazo. Solo cambia que quien las
  -- pidió aparecerá ya como "Usuario eliminado".

  -- `entitlement_suspended_at` es el hueco que BC-1 reservó para esto (migración
  -- 20261058000000). Se sella en el MISMO update que cierra la solicitud: una escritura,
  -- no dos.
  update public.account_deletion_requests
     set status = 'completed', completed_at = now(),
         entitlement_suspended_at = now()
   where id = v_req.id;

  insert into public.audit_log (actor_profile_id, action, target_kind, target_id, club_id, reason)
  select p_profile_id, 'account.deleted', 'profile', p_profile_id, m.club_id,
         'Cuenta anonimizada: fin del proceso de borrado'
    from public.memberships m
   where m.profile_id = p_profile_id;

  return v_avatar;  -- ruta del objeto a borrar por Storage API (NULL si no había)
end;
$function$
;
