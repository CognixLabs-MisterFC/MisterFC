-- F14F-4 — ENTRENAR EN FESTIVO: pendiente + aprobación (última subfase de F14F).
--
-- Un entrenamiento SUELTO creado a mano en un día festivo queda PENDIENTE de
-- aprobación de dirección (admin/director). Si lo crea quien puede aprobar, se
-- crea APROBADO directo. El estado de aprobación es ORTOGONAL al de cancelación
-- (F14F-1): son columnas independientes que componen (un pending puede además
-- cancelarse por lluvia; ambos lo excluyen de lo operativo).
--
-- ADITIVO Y NO-REGRESIVO: approval_status IS NULL = evento NORMAL (todos los
-- existentes). El flujo pending/approved/rejected solo aparece en los overrides
-- de festivo. Calca el patrón de plays (status/approved_by/approved_at/
-- rejection_reason, 20260809 plays_club_bank).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Columnas de aprobación en events.
--    · approval_status  — NULL = normal; 'pending'|'approved'|'rejected'.
--    · rejection_reason — motivo del rechazo (obligatorio si rejected).
--    · approved_by      — quién decidió (aprobó o rechazó); set null al borrar perfil.
--    · approved_at      — cuándo se decidió.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.events
  add column approval_status text
    check (approval_status is null or approval_status in ('pending', 'approved', 'rejected')),
  add column rejection_reason text
    check (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 500),
  add column approved_by uuid references public.profiles(id) on delete set null,
  add column approved_at timestamptz;

comment on column public.events.approval_status is
  'F14F-4 — NULL = evento NORMAL. pending/approved/rejected solo para trainings sueltos creados en día festivo. Ortogonal a cancelled_at.';

-- Coherencia del estado de aprobación:
--   normal(NULL) → sin campos de decisión; pending → sin campos de decisión;
--   approved → sin rejection_reason; rejected → con rejection_reason.
alter table public.events add constraint events_approval_consistency check (
  (approval_status is null    and approved_by is null and approved_at is null and rejection_reason is null)
  or (approval_status = 'pending'  and approved_by is null and approved_at is null and rejection_reason is null)
  or (approval_status = 'approved' and rejection_reason is null)
  or (approval_status = 'rejected' and rejection_reason is not null)
);

-- Índice para la COLA de pendientes por club.
create index events_pending_approval_idx
  on public.events (club_id)
  where approval_status = 'pending';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. GUARD: pasar un evento a 'approved'/'rejected' es potestad EXCLUSIVA de
--    admin/director. Cierra el hueco de que un coach (user_can_manage_event, que
--    rige events_insert/update) se auto-apruebe por DML crudo saltándose la RPC.
--    'pending' y NULL son libres (el flujo de creación los pone). Si el estado
--    no cambia en un UPDATE, no aplica (editar título de un pending es libre).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.events_guard_approval()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and new.approval_status is not distinct from old.approval_status then
    return new;
  end if;
  if new.approval_status in ('approved', 'rejected')
     and not public.user_is_admin_or_director(new.club_id) then
    raise exception 'approval_forbidden';
  end if;
  return new;
end;
$$;

create trigger events_guard_approval
  before insert or update on public.events
  for each row execute function public.events_guard_approval();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC decide_event_approval — aprueba o rechaza un training PENDIENTE. Gate
--    user_is_admin_or_director (NO user_can_manage_event → excluye coordinador y
--    principal). Atómica, sin EXCEPTION handlers. Devuelve datos para avisar al
--    creador. El rechazo exige motivo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.decide_event_approval(
  p_event_id uuid,
  p_approve  boolean,
  p_reason   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_club uuid;
  v_team uuid;
  v_status text;
  v_title text;
  v_starts timestamptz;
  v_creator uuid;
  v_reason text;
begin
  if auth.uid() is null then raise exception 'no_session'; end if;

  select club_id, team_id, approval_status, title, starts_at, created_by
    into v_club, v_team, v_status, v_title, v_starts, v_creator
  from public.events where id = p_event_id;
  if not found then raise exception 'not_found'; end if;

  if not public.user_is_admin_or_director(v_club) then
    raise exception 'forbidden';
  end if;
  if v_status is distinct from 'pending' then raise exception 'not_pending'; end if;

  if p_approve then
    update public.events set
      approval_status  = 'approved',
      approved_by      = auth.uid(),
      approved_at      = now(),
      rejection_reason = null,
      updated_at       = now()
    where id = p_event_id;
  else
    v_reason := nullif(btrim(coalesce(p_reason, '')), '');
    if v_reason is null then raise exception 'reason_required'; end if;
    update public.events set
      approval_status  = 'rejected',
      approved_by      = auth.uid(),
      approved_at      = now(),
      rejection_reason = v_reason,
      updated_at       = now()
    where id = p_event_id;
  end if;

  return jsonb_build_object(
    'event_id',   p_event_id,
    'team_id',    v_team,
    'title',      v_title,
    'starts_at',  v_starts,
    'created_by', v_creator,
    'status',     case when p_approve then 'approved' else 'rejected' end
  );
end;
$$;

comment on function public.decide_event_approval(uuid, boolean, text) is
  'F14F-4 — aprueba/rechaza un training PENDIENTE. Gate admin/director. Rechazo exige motivo. Devuelve {event_id,team_id,title,starts_at,created_by,status} para avisar al creador. SECURITY DEFINER.';

revoke all on function public.decide_event_approval(uuid, boolean, text) from public;
grant execute on function public.decide_event_approval(uuid, boolean, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS events_select — OCULTAR los pendientes/rechazados a jugadores/familias.
--    Se recrea la def VIVA (C-1a, 20261009) SIN perder ninguna de sus 8 ramas
--    (incluida FIX-DIRECTO #333, ramas 7 y 8 de tipo partido club-wide). El
--    ÚNICO cambio: los eventos con approval_status pending/rejected solo los ven
--    admin/director, el STAFF del equipo, o el propio CREADOR. Los normales y
--    aprobados (approval_status NULL o 'approved') conservan EXACTAMENTE las 8
--    ramas de hoy → cero regresión.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists events_select on public.events;
create policy events_select
  on public.events
  for select
  to authenticated
  using (
    (
      -- Estado VISIBLE PARA TODOS (normal o aprobado): las 8 ramas vivas de C-1a.
      (approval_status is null or approval_status = 'approved')
      and (
        -- admin o director del club (club-wide)
        public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
        -- coordinador SOLO de ESE equipo (C-1a)
        or (team_id is not null and public.user_coordinates_team(team_id))
        -- evento club-level (sin equipo): cualquier miembro del club
        or (team_id is null and public.user_role_in_club(club_id) is not null)
        -- staff del equipo del evento
        or (team_id is not null and public.user_is_staff_of_team(team_id))
        -- jugador/familia (cuenta) del equipo del evento
        or (team_id is not null and public.user_is_team_member_account(team_id))
        -- espectador del equipo del evento
        or (team_id is not null and public.is_spectator_of_team(team_id))
        -- eventos de tipo partido: cualquier miembro del club (FIX-DIRECTO #333)
        or (
          type = any (array['match', 'friendly', 'tournament'])
          and public.user_role_in_club(club_id) is not null
        )
        -- eventos de tipo partido: espectador del club (FIX-DIRECTO #333)
        or (
          type = any (array['match', 'friendly', 'tournament'])
          and public.is_spectator_of_club(club_id)
        )
      )
    )
    or (
      -- PENDIENTE/RECHAZADO: solo dirección, staff del equipo, o el creador. Un
      -- training sin aprobar no existe todavía para jugadores/familias.
      approval_status = any (array['pending', 'rejected'])
      and (
        public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
        or (team_id is not null and public.user_is_staff_of_team(team_id))
        or created_by = auth.uid()
      )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Tipos de notificación: solicitud (a dirección) + resultado (al creador).
-- ─────────────────────────────────────────────────────────────────────────────
alter type public.notification_type add value if not exists 'training_approval_requested';
alter type public.notification_type add value if not exists 'training_approved';
alter type public.notification_type add value if not exists 'training_rejected';
