-- Subfase 4.7 — Tabla `notifications` futuro-proof para F5/F16.
--
-- Spec: docs/specs/4.0-asistencia-convocatorias.md §5.1.
--
-- Schema diseñado para que F5 (push) y F16 (email) no necesiten migrar la
-- tabla. F4 solo escribe `channel='in_app'`; F5/F16 añadirán 'push' y
-- 'email' como nuevos transportes consumiendo filas pending.
--
-- Política de escritura: solo `service_role` (bypass RLS desde el cron).
-- El user dueño puede pasar pending → sent al "marcar como leída" la
-- notificación in-app.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enums
-- ─────────────────────────────────────────────────────────────────────────────

create type public.notification_type as enum (
  'match_callup_reminder',
  'attendance_pending_reminder'
);

create type public.notification_channel as enum (
  'in_app',
  'push',
  'email'
);

create type public.notification_status as enum (
  'pending',
  'sent',
  'failed',
  'skipped'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabla notifications
-- ─────────────────────────────────────────────────────────────────────────────

create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  type          public.notification_type not null,
  channel       public.notification_channel not null,
  status        public.notification_status not null default 'pending',
  -- payload llevará lo que necesite el transporte:
  --  - in_app  : { event_id, title_hint, deep_link }
  --  - push    : { title, body, deep_link }       (F5)
  --  - email   : { subject, html_body_id, vars }  (F16)
  payload       jsonb not null default '{}'::jsonb,
  -- dedupe_key: clave estable producida por el caller.
  --  F4 la compone como '<type>:<channel>:<event_id>:<YYYY-MM-DD>:<user_id>'.
  --  UNIQUE sobre esta única columna evita doble envío del MISMO concepto
  --  aunque el cron corra dos veces.
  dedupe_key    text not null,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  constraint notifications_dedupe_unique unique (dedupe_key)
);

create index notifications_user_unread_idx
  on public.notifications (user_id, created_at desc)
  where status = 'pending';

comment on table public.notifications is
  'F4.7 — cola interna de notificaciones futuro-proof para F5 (push) y F16 (email). F4 solo escribe in_app.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.notifications enable row level security;

-- SELECT: el propio user.
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

-- INSERT: nadie a nivel authenticated. El cron usa service_role (bypass RLS).
-- No declaramos policy INSERT → cualquier intento desde authenticated falla
-- con 42501.

-- UPDATE: el dueño puede marcar como leída (status pending → sent + sent_at).
-- Cualquier otra mutación se rechaza vía trigger.
create policy notifications_update_own_read on public.notifications
  for update to authenticated
  using      (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.notifications_protect_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Inmutables tras INSERT.
  if new.user_id is distinct from old.user_id then
    raise exception 'user_id_immutable' using errcode = 'check_violation';
  end if;
  if new.type is distinct from old.type then
    raise exception 'type_immutable' using errcode = 'check_violation';
  end if;
  if new.channel is distinct from old.channel then
    raise exception 'channel_immutable' using errcode = 'check_violation';
  end if;
  if new.dedupe_key is distinct from old.dedupe_key then
    raise exception 'dedupe_key_immutable' using errcode = 'check_violation';
  end if;
  if new.payload is distinct from old.payload then
    raise exception 'payload_immutable' using errcode = 'check_violation';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at_immutable' using errcode = 'check_violation';
  end if;

  -- Status: el authenticated solo puede ir pending → sent y debe setear
  -- sent_at. service_role puede mover libremente (sin trigger restrictivo
  -- — service_role bypassa esto porque la función es security definer y
  -- los inserts del cron evitan el trigger UPDATE).
  if auth.uid() is not null then
    if old.status <> 'pending' or new.status <> 'sent' then
      raise exception 'status_transition_not_allowed' using errcode = 'check_violation';
    end if;
    if new.sent_at is null then
      new.sent_at := now();
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_notifications_protect_update
  before update on public.notifications
  for each row execute function public.notifications_protect_update();
