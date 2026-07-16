-- F14F-2 — DÍAS FESTIVOS (instalaciones cerradas), a nivel de CLUB ENTERO.
--
-- Un festivo es una FECHA del club (no por equipo/categoría/sede). Lo marca SOLO
-- dirección/admin (admin_club|director; superadmin actúa como admin_club). Al
-- MARCAR, los entrenamientos del club de ese día pasan a CANCELADO con
-- cancellation_source='holiday' y cancelled_holiday_id = el festivo (reutiliza el
-- estado de cancelación de F14F-1). Al DESMARCAR, se reactivan SOLO esos
-- (los cancelados por PERSONA — lluvia — no se tocan).
--
-- La app (server action) emite los avisos a entrenadores + jugadores + familias:
-- las RPCs DEVUELVEN los eventos afectados (emitNotificationFanOut vive en TS).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabla holidays. unique(club_id, date): un día es festivo o no lo es.
--    reason OBLIGATORIO (1..100): un festivo siempre tiene nombre (Navidad,
--    fiesta local…). created_by SET NULL para no bloquear el borrado del perfil.
-- ─────────────────────────────────────────────────────────────────────────────
create table public.holidays (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  date       date not null,
  reason     text not null check (char_length(btrim(reason)) between 1 and 100),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (club_id, date)
);

comment on table public.holidays is
  'F14F-2 — días festivos del club (instalaciones cerradas). Un festivo cancela los entrenamientos del club de ese día (source=holiday). Marca/desmarca solo dirección/admin vía RPC.';

create index holidays_club_date_idx on public.holidays (club_id, date);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. FK diferida de F14F-1: events.cancelled_holiday_id → holidays(id).
--    ON DELETE RESTRICT (no CASCADE: borrar un festivo NUNCA debe borrar eventos;
--    no SET NULL: dejaría source='holiday' con holiday_id NULL y ROMPERÍA el CHECK
--    events_cancellation_consistency). Un festivo con eventos cancelados apuntándole
--    NO se puede borrar directamente: hay que pasar por unmark_holiday, que primero
--    limpia cancelled_holiday_id de esos eventos y luego borra el festivo.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.events
  add constraint events_cancelled_holiday_id_fkey
  foreign key (cancelled_holiday_id) references public.holidays(id)
  on delete restrict;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RLS: los festivos son visibles para CUALQUIERA relacionado con el club
--    (todos los roles, familias y seguidores) → el calendario los muestra a todos.
--    INSERT/UPDATE/DELETE NO tienen policy: solo se tocan vía las RPCs SECURITY
--    DEFINER (que saltan RLS). El gate de autorización vive en las RPCs.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.holidays enable row level security;

create policy holidays_select on public.holidays
  for select to authenticated
  using (
    -- miembros del club (admin/coordinador/director/entrenadores/jugadores)
    public.user_role_in_club(club_id) is not null
    -- seguidores del club
    or public.is_spectator_of_club(club_id)
    -- familias/jugadores vinculados por player_accounts a algún equipo del club
    or exists (
      select 1 from public.teams t
      where t.club_id = holidays.club_id
        and public.user_is_team_member_account(t.id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. mark_holiday — marca un festivo y cancela ATÓMICAMENTE los entrenamientos
--    del club de ese día. Gate admin_club|director (NO coordinador; por eso
--    user_is_admin_or_director, no user_can_manage_event). Devuelve el festivo y
--    los eventos que canceló para que la app avise. Sin EXCEPTION handlers: si algo
--    falla, la transacción entera aborta.
--
--    Fecha: un entrenamiento pertenece al día del festivo si su starts_at, en la
--    zona del club (Europe/Madrid), cae en esa fecha. Solo se cancelan los que
--    están ACTIVOS (cancelled_at IS NULL): un entreno ya cancelado por PERSONA
--    (lluvia) NO se toca ni cambia de origen (caso borde de Jose).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.mark_holiday(
  p_club_id uuid,
  p_date    date,
  p_reason  text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_holiday_id uuid;
  v_reason     text;
  v_cancelled  jsonb;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;
  if not public.user_is_admin_or_director(p_club_id) then
    raise exception 'forbidden';
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is null then raise exception 'reason_required'; end if;

  -- Inserta el festivo. on conflict do nothing + not found → ya existía (sin
  -- handler de excepción; la unicidad protege también de carreras).
  insert into public.holidays (club_id, date, reason, created_by)
  values (p_club_id, p_date, v_reason, auth.uid())
  on conflict (club_id, date) do nothing
  returning id into v_holiday_id;

  if v_holiday_id is null then raise exception 'already_holiday'; end if;

  -- Cancela los entrenamientos ACTIVOS del club de ese día (source=holiday).
  with cancelled as (
    update public.events set
      cancelled_at         = now(),
      cancelled_by         = auth.uid(),
      cancellation_reason  = v_reason,
      cancellation_source  = 'holiday',
      cancelled_holiday_id = v_holiday_id,
      updated_at           = now()
    where club_id = p_club_id
      and type = 'training'
      and cancelled_at is null
      and (starts_at at time zone 'Europe/Madrid')::date = p_date
    returning id, team_id, title, starts_at
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'event_id', id, 'team_id', team_id, 'title', title, 'starts_at', starts_at
    )),
    '[]'::jsonb
  ) into v_cancelled from cancelled;

  return jsonb_build_object(
    'holiday_id', v_holiday_id,
    'reason',     v_reason,
    'cancelled',  v_cancelled
  );
end;
$$;

comment on function public.mark_holiday(uuid, date, text) is
  'F14F-2 — marca festivo del club y cancela (source=holiday) los entrenamientos ACTIVOS de ese día. Gate admin_club|director. Devuelve {holiday_id, reason, cancelled:[{event_id,team_id,title,starts_at}]}. No toca los cancelados por persona.';

revoke all on function public.mark_holiday(uuid, date, text) from public;
grant execute on function public.mark_holiday(uuid, date, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. unmark_holiday — desmarca un festivo: reactiva SOLO los eventos que canceló
--    ESE festivo (cancelled_holiday_id = él) y borra el festivo. Mismo gate. Los
--    cancelados por PERSONA (cancelled_holiday_id NULL) NO se tocan. Se limpia
--    cancelled_holiday_id ANTES del delete → la FK RESTRICT no bloquea. Devuelve
--    los eventos reactivados para avisar de la reactivación.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.unmark_holiday(
  p_holiday_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club        uuid;
  v_reactivated jsonb;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;

  select club_id into v_club from public.holidays where id = p_holiday_id;
  if not found then raise exception 'not_found'; end if;

  if not public.user_is_admin_or_director(v_club) then
    raise exception 'forbidden';
  end if;

  -- Reactiva SOLO los cancelados por ESTE festivo (limpia todos los campos de
  -- cancelación → estado ACTIVO válido según el CHECK de consistencia).
  with reactivated as (
    update public.events set
      cancelled_at         = null,
      cancelled_by         = null,
      cancellation_reason  = null,
      cancellation_source  = null,
      cancelled_holiday_id = null,
      updated_at           = now()
    where cancelled_holiday_id = p_holiday_id
    returning id, team_id, title, starts_at
  )
  select coalesce(
    jsonb_agg(jsonb_build_object(
      'event_id', id, 'team_id', team_id, 'title', title, 'starts_at', starts_at
    )),
    '[]'::jsonb
  ) into v_reactivated from reactivated;

  -- Ya sin eventos apuntándole → el delete no choca con la FK RESTRICT.
  delete from public.holidays where id = p_holiday_id;

  return jsonb_build_object(
    'holiday_id',  p_holiday_id,
    'reactivated', v_reactivated
  );
end;
$$;

comment on function public.unmark_holiday(uuid) is
  'F14F-2 — desmarca festivo: reactiva SOLO los eventos cancelados por ese festivo (los de persona NO) y borra el festivo. Gate admin_club|director. Devuelve {holiday_id, reactivated:[{event_id,team_id,title,starts_at}]}.';

revoke all on function public.unmark_holiday(uuid) from public;
grant execute on function public.unmark_holiday(uuid) to authenticated;
