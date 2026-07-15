-- F14F-1 — Estado de CANCELACIÓN en eventos (cimiento de F14F días festivos).
--
-- Añade a `events` la capacidad de estar CANCELADO sin desaparecer del calendario,
-- distinguiendo el ORIGEN de la cancelación (una PERSONA vs un FESTIVO) para que
-- F14F-2 (festivos) pueda reactivar SOLO los que canceló un festivo concreto sin
-- tocar los que canceló un entrenador por su cuenta.
--
-- ADITIVO Y NO-REGRESIVO: `cancelled_at IS NULL` = evento ACTIVO. Todos los eventos
-- existentes quedan activos; ninguna pantalla que lea `events` cambia su
-- comportamiento (las columnas nuevas son opcionales).
--
-- Modelo abierto (cualquier tipo de evento PODRÍA cancelarse a nivel de columnas),
-- pero el FLUJO de F14F-1 (RPC + UI) es SOLO para entrenamientos (type='training').

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas de cancelación en events.
--    · cancelled_at         — sello temporal; NULL = activo (el flag).
--    · cancelled_by         — quién canceló (persona; para festivos, el director
--                             que lo marcó). on delete set null (no bloquea borrado
--                             de perfiles; el evento sigue cancelado sin autor).
--    · cancellation_reason  — motivo LIBRE y OPCIONAL (1..500).
--    · cancellation_source  — 'person' | 'holiday'. Origen de la cancelación.
--    · cancelled_holiday_id — festivo que la originó (F14F-2). La FK a la tabla
--                             `holidays` se añade en F14F-2 (aún no existe); aquí
--                             es un uuid suelto para no forzar orden entre fases.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.events
  add column cancelled_at         timestamptz,
  add column cancelled_by         uuid references public.profiles(id) on delete set null,
  add column cancellation_reason  text
    check (cancellation_reason is null or char_length(cancellation_reason) between 1 and 500),
  add column cancellation_source  text
    check (cancellation_source is null or cancellation_source in ('person', 'holiday')),
  add column cancelled_holiday_id uuid;

comment on column public.events.cancelled_at is
  'F14F-1 — sello de cancelación. NULL = evento ACTIVO. NOT NULL = cancelado (se pinta tachado en el calendario, no desaparece).';
comment on column public.events.cancelled_by is
  'F14F-1 — perfil que canceló (persona; para festivos, el director que marcó el festivo). SET NULL si se borra el perfil.';
comment on column public.events.cancellation_reason is
  'F14F-1 — motivo libre y OPCIONAL de la cancelación (1..500).';
comment on column public.events.cancellation_source is
  'F14F-1 — origen: person = lo canceló un usuario; holiday = lo canceló un festivo (F14F-2). Permite reactivar selectivamente al desmarcar un festivo.';
comment on column public.events.cancelled_holiday_id is
  'F14F-1 — festivo (F14F-2) que originó la cancelación cuando source=holiday. FK a holidays(id) se añadirá en F14F-2. NULL si source=person.';

-- Coherencia del estado: ACTIVO ⇔ todas las columnas de cancelación NULL;
-- CANCELADO ⇒ source no NULL; y cancelled_holiday_id presente ⇔ source='holiday'.
alter table public.events add constraint events_cancellation_consistency check (
  (
    cancelled_at is null
    and cancelled_by is null
    and cancellation_reason is null
    and cancellation_source is null
    and cancelled_holiday_id is null
  )
  or (
    cancelled_at is not null
    and cancellation_source is not null
    and (cancelled_holiday_id is not null) = (cancellation_source = 'holiday')
  )
);

-- Índice para la reactivación selectiva de F14F-2 (desmarcar un festivo →
-- reactivar solo sus eventos). Parcial: solo cancelados por festivo.
create index events_cancelled_holiday_idx
  on public.events (cancelled_holiday_id)
  where cancelled_holiday_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tipo de notificación para el aviso "entrenamiento cancelado".
-- ─────────────────────────────────────────────────────────────────────────────
alter type public.notification_type add value if not exists 'training_cancelled';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPCs de cancelar / descancelar (SECURITY DEFINER; gate = user_can_manage_event,
--    def viva C-1a). Solo aplican a entrenamientos en F14F-1. La cancelación de
--    F14F-1 es siempre source='person'; descancelar solo reactiva lo cancelado por
--    persona (lo cancelado por festivo se reactiva en F14F-2).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.cancel_event(
  p_event_id uuid,
  p_reason   text default null
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club uuid;
  v_team uuid;
  v_type text;
  v_cancelled timestamptz;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;

  select club_id, team_id, type, cancelled_at
    into v_club, v_team, v_type, v_cancelled
  from public.events where id = p_event_id;
  if not found then raise exception 'not_found'; end if;

  if not public.user_can_manage_event(v_club, v_team) then
    raise exception 'forbidden';
  end if;
  if v_type <> 'training' then raise exception 'not_training'; end if;
  if v_cancelled is not null then raise exception 'already_cancelled'; end if;

  update public.events set
    cancelled_at         = now(),
    cancelled_by         = auth.uid(),
    cancellation_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
    cancellation_source  = 'person',
    cancelled_holiday_id = null,
    updated_at           = now()
  where id = p_event_id;
end;
$$;

comment on function public.cancel_event(uuid, text) is
  'F14F-1 — cancela un entrenamiento (source=person) con motivo opcional. Gate user_can_manage_event. No borra: marca cancelled_at. SECURITY DEFINER.';

create or replace function public.uncancel_event(
  p_event_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club uuid;
  v_team uuid;
  v_source text;
  v_cancelled timestamptz;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;

  select club_id, team_id, cancellation_source, cancelled_at
    into v_club, v_team, v_source, v_cancelled
  from public.events where id = p_event_id;
  if not found then raise exception 'not_found'; end if;

  if not public.user_can_manage_event(v_club, v_team) then
    raise exception 'forbidden';
  end if;
  if v_cancelled is null then raise exception 'not_cancelled'; end if;
  -- Solo se reactiva manualmente lo cancelado por PERSONA. Lo cancelado por un
  -- FESTIVO se reactiva desde F14F-2 (al desmarcar el festivo) → protege el
  -- invariante de reactivación selectiva.
  if v_source <> 'person' then raise exception 'cancelled_by_holiday'; end if;

  update public.events set
    cancelled_at         = null,
    cancelled_by         = null,
    cancellation_reason  = null,
    cancellation_source  = null,
    cancelled_holiday_id = null,
    updated_at           = now()
  where id = p_event_id;
end;
$$;

comment on function public.uncancel_event(uuid) is
  'F14F-1 — reactiva (descancela) un entrenamiento cancelado por PERSONA. Gate user_can_manage_event. Rechaza los cancelados por festivo (F14F-2 los reactiva). SECURITY DEFINER.';

revoke all on function public.cancel_event(uuid, text) from public;
grant execute on function public.cancel_event(uuid, text) to authenticated;
revoke all on function public.uncancel_event(uuid) from public;
grant execute on function public.uncancel_event(uuid) to authenticated;
