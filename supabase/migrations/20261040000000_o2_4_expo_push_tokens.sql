-- O2-4 PR-1 — Push nativo (Expo). Tabla de tokens Expo + alta idempotente.
--
-- MisterFC envía push por Web Push/VAPID a `push_subscriptions` (endpoint/p256dh/
-- auth, formato del navegador). La app nativa recibe por Expo Push, cuyo token es
-- un `ExponentPushToken[...]` opaco que NO cabe en aquel esquema. Tabla nueva.
--
-- El envío (backend) ramifica: una notificación push va a las suscripciones Web
-- Push del user Y a sus expo_push_tokens, respetando UNA sola vez el gate
-- `user_wants_notification(user, type, 'push')` (mismo canal 'push', sin canal de
-- preferencia nuevo).
--
-- Alta idempotente con REASIGNACIÓN: un Expo push token identifica una INSTALACIÓN
-- de dispositivo. Si el aparato cambia de cuenta, el token debe pasar a recibir lo
-- del usuario que está logueado ahora; el anterior deja de recibir en ese aparato.
-- Bajo RLS un usuario B no puede hacer upsert sobre una fila cuyo user_id es A, así
-- que la reasignación va por una RPC SECURITY DEFINER.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla expo_push_tokens
-- ─────────────────────────────────────────────────────────────────────────────

create table public.expo_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  token         text not null,
  -- 'android' hoy; hueco para 'ios' cuando se añada APNs (pospuesto en el ADR).
  platform      text not null default 'android',
  device_info   text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  constraint expo_push_tokens_token_unique unique (token),
  constraint expo_push_tokens_platform_check check (platform in ('android', 'ios'))
);

comment on table public.expo_push_tokens is
  'O2-4 — Expo push tokens (ExponentPushToken) por dispositivo nativo. Un user puede tener N (móvil + tablet). token UNIQUE: se reasigna al último user que lo registra (ver register_expo_push_token). Paralelo nativo de push_subscriptions (Web Push).';
comment on column public.expo_push_tokens.token is
  'ExponentPushToken[...] opaco de Expo. Si Expo reporta DeviceNotRegistered al enviar, borrar la fila.';
comment on column public.expo_push_tokens.platform is
  'android hoy; ios reservado para cuando se añada APNs.';

create index expo_push_tokens_user_idx
  on public.expo_push_tokens (user_id);

alter table public.expo_push_tokens enable row level security;

-- RLS calcada de push_subscriptions: cada user solo gestiona/ve sus filas. El
-- backend de envío usa service_role (bypass RLS). La REASIGNACIÓN entre usuarios
-- NO pasa por estas policies: va por register_expo_push_token (security definer).
create policy expo_push_tokens_select_own on public.expo_push_tokens
  for select to authenticated
  using (user_id = auth.uid());

create policy expo_push_tokens_insert_own on public.expo_push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

create policy expo_push_tokens_update_own on public.expo_push_tokens
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy expo_push_tokens_delete_own on public.expo_push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RPC de alta idempotente con reasignación
-- ─────────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER para poder REASIGNAR un token que ahora pertenece a otro user
-- (las policies de arriba no dejarían a B tocar la fila de A). `auth.uid()` sigue
-- devolviendo el user del JWT dentro de un definer, así que la fila queda del
-- llamante. Guard anti-anónimo: sin sesión no se registra nada.

create or replace function public.register_expo_push_token(
  p_token text,
  p_platform text default 'android',
  p_device_info text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if coalesce(p_platform, 'android') not in ('android', 'ios') then
    raise exception 'invalid platform: %', p_platform using errcode = '22023';
  end if;

  insert into public.expo_push_tokens (user_id, token, platform, device_info, last_seen_at)
  values (v_uid, p_token, coalesce(p_platform, 'android'), p_device_info, now())
  on conflict (token) do update
    set user_id      = v_uid,
        platform     = coalesce(p_platform, public.expo_push_tokens.platform),
        device_info  = p_device_info,
        last_seen_at = now();
end;
$$;

comment on function public.register_expo_push_token(text, text, text) is
  'O2-4 — Alta idempotente del Expo push token del dispositivo. UNIQUE(token) + upsert: registrar un token existente lo REASIGNA al user actual (auth.uid()) y refresca last_seen_at, sin duplicar. Definer para permitir la reasignación entre usuarios (las policies own no bastan).';

revoke all on function public.register_expo_push_token(text, text, text) from public;
grant execute on function public.register_expo_push_token(text, text, text) to authenticated;
