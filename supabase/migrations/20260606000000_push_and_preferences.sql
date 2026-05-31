-- F5 Lote B — Web Push: suscripciones + preferencias.
--
-- Cierra el lazo de F4.7 (cola `notifications` futuro-proof) → F5.7 (drain
-- a push real via web-push lib). El cron `/api/cron/reminders` ya escribe
-- a `notifications` con `channel='in_app'`; ahora también escribe `'push'`
-- y un drainer (mismo cron / eager en server actions) las envía via VAPID.
--
-- Cambios:
--   1. Enum `notification_type` extendido con tipos que F5 Lote A ya
--      empieza a producir y que las preferences debe contemplar:
--        - callup_published    (admin/coord publica convocatoria → jugador/familia)
--        - training_reminder   (día anterior a entrenamiento, opcional)
--      (`new_message` y `new_announcement` ya añadidos en
--      `20260605000000_messaging.sql`. `match_callup_reminder` y
--      `attendance_pending_reminder` ya existían de F4.)
--
--   2. Tabla `push_subscriptions` — endpoints VAPID por dispositivo.
--      Un user puede tener N suscripciones (móvil + desktop + iPad).
--
--   3. Tabla `notification_preferences` — matriz tipo × canal con
--      `enabled`. LEFT JOIN default true: si no hay fila, asume opt-in.
--
--   4. RLS estricta: cada user solo gestiona/ve sus propias filas.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Extender notification_type enum
-- ─────────────────────────────────────────────────────────────────────────────

alter type public.notification_type add value if not exists 'callup_published';
alter type public.notification_type add value if not exists 'training_reminder';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. push_subscriptions
-- ─────────────────────────────────────────────────────────────────────────────

create table public.push_subscriptions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  endpoint      text not null,
  p256dh        text not null,
  auth          text not null,
  user_agent    text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint push_subscriptions_endpoint_unique unique (endpoint)
);

comment on table public.push_subscriptions is
  'F5.5 — endpoints Web Push (VAPID) por dispositivo. Un user puede tener N filas (móvil + desktop + iPad).';
comment on column public.push_subscriptions.endpoint is
  'URL única del push service del navegador. Si retorna 410/404, borrar la fila.';
comment on column public.push_subscriptions.auth is
  'Auth secret del cliente (16 bytes base64url). Necesario para encriptar payload.';

create index push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- SELECT/INSERT/UPDATE/DELETE: solo el propio user. El cron usa service_role.
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = auth.uid());

create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated
  with check (user_id = auth.uid());

create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. notification_preferences
-- ─────────────────────────────────────────────────────────────────────────────

create table public.notification_preferences (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        public.notification_type not null,
  channel     public.notification_channel not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (user_id, type, channel)
);

comment on table public.notification_preferences is
  'F5.6 — matriz tipo × canal con enabled. LEFT JOIN default true: si no hay fila, asume opt-in (consulta server-side antes de enviar push).';
comment on column public.notification_preferences.enabled is
  'OFF significa el user NO quiere notificación de ese tipo por ese canal. ON o ausencia = sí.';

create index notification_preferences_user_idx
  on public.notification_preferences (user_id);

alter table public.notification_preferences enable row level security;

create policy notification_preferences_select_own on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid());

create policy notification_preferences_insert_own on public.notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid());

create policy notification_preferences_update_own on public.notification_preferences
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notification_preferences_delete_own on public.notification_preferences
  for delete to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Helper: ¿quiere el user recibir notif tipo X por canal Y?
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER + parametrizado por p_user_id para que el cron (service
-- role) pueda llamarlo sin asumir el usuario actual. Default true si no hay
-- fila explícita (opt-in por defecto).

create or replace function public.user_wants_notification(
  p_user_id uuid,
  p_type public.notification_type,
  p_channel public.notification_channel
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select enabled
        from public.notification_preferences
       where user_id = p_user_id
         and type    = p_type
         and channel = p_channel
       limit 1
    ),
    true
  );
$$;

comment on function public.user_wants_notification(uuid, public.notification_type, public.notification_channel) is
  'F5.6 — true si el user permite (o no ha desactivado) ese tipo por ese canal. LEFT JOIN default true: ausencia de fila = opt-in.';
