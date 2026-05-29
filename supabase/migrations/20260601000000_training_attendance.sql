-- Subfase 4.1 — Modelo de asistencia a entrenamientos.
--
-- Spec: docs/specs/4.0-asistencia-convocatorias.md (Lote A, D1+D2).
--
-- Decisiones cubiertas:
--   D1. Enum `attendance_code` con 10 valores. Justificación: contrato shared
--       con F8 (valoraciones) y F9 (perfil) — ver ADR-0007.
--   D2. Tabla `training_attendance` con UNIQUE (event_id, player_id).
--       - `event_id` y `player_id` inmutables tras INSERT (trigger).
--       - `recorded_by` forzado a auth.uid() (trigger).
--       - Solo eventos type='training' admiten asistencia (trigger).
--       - Solo eventos pasados o en curso admiten asistencia (trigger):
--         no se permite marcar entrenamientos futuros.
--       - Solo jugadores que pertenecían al team del evento en la fecha del
--         evento (team_members.joined_at <= event_date AND (left_at IS NULL
--         OR left_at >= event_date)).
--
--   Triggers en lugar de CHECK con función: las validaciones dependen de
--   `events` y `team_members`, tablas externas a `training_attendance`.
--   Postgres acepta la sintaxis CHECK con función pero no la re-evalúa al
--   modificar la tabla referenciada, así que un CHECK quedaría latente.
--   El trigger es la fuente de verdad.
--
--   MVCC (lección heredada de NIDO + F3):
--     - El helper `user_can_record_attendance(event_id)` consulta `events`
--       + `memberships` + `team_staff`. NINGUNA muta en INSERT/UPDATE/
--       DELETE a training_attendance. Por tanto RETURNING * tras INSERT
--       pasa la policy SELECT sin tropezar con filas en flight.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Enum attendance_code
-- ─────────────────────────────────────────────────────────────────────────────

create type public.attendance_code as enum (
  'presente',
  'ausente',
  'ausente_con_aviso',
  'entreno_diferenciado',
  'lesionado',
  'enfermo',
  'partido_oficial',
  'viaje',
  'sancionado',
  'descanso'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Tabla training_attendance
-- ─────────────────────────────────────────────────────────────────────────────

create table public.training_attendance (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  player_id    uuid not null references public.players(id) on delete cascade,
  code         public.attendance_code not null,
  notes        text check (notes is null or char_length(notes) <= 500),
  recorded_by  uuid not null references public.profiles(id),
  recorded_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint training_attendance_unique_event_player
    unique (event_id, player_id)
);

create index training_attendance_player_recent_idx
  on public.training_attendance (player_id, recorded_at desc);

create index training_attendance_event_idx
  on public.training_attendance (event_id);

comment on table public.training_attendance is
  'F4.1 — asistencia a entrenamientos. Una fila por (evento, jugador).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Helper RLS: user_can_record_attendance(event_id)
--
-- Mismo patrón que F3.user_can_manage_event pero con la capability propia
-- de F4 (`can_mark_attendance`) en lugar de `can_manage_calendar`. NO se
-- delega a user_can_manage_event porque conflaria semánticas: crear un
-- evento ≠ marcar asistencia sobre él (el ayudante puede tener una sin la
-- otra). La capability `can_mark_attendance` se añade en la migración
-- siguiente (20260601000001); hasta entonces el helper devuelve false para
-- el ayudante. La policy SELECT contra `capabilities` tolera el nombre
-- inexistente (lookup → 0 filas → false).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_record_attendance(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(e.club_id) in ('admin_club', 'coordinador')
    or (
      e.team_id is not null
      and public.user_role_in_club(e.club_id) = 'entrenador_principal'
      and public.user_is_staff_of_team(e.team_id)
    )
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_mark_attendance')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

comment on function public.user_can_record_attendance(uuid) is
  'F4.1 — TRUE si el user actual puede registrar asistencia del evento. admin/coord o principal/ayudante con can_mark_attendance del team del evento.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Trigger: validaciones BEFORE INSERT
--
-- - event.type debe ser 'training'.
-- - event.starts_at <= now() (no se marca asistencia de futuro).
-- - player.club_id == event.club_id.
-- - player era miembro activo del event.team_id en la fecha del evento.
-- - recorded_by forzado a auth.uid() para evitar suplantación.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.training_attendance_validate_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_player players%rowtype;
  v_belongs boolean;
begin
  -- Resolver evento.
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;

  -- Solo entrenamientos.
  if v_event.type <> 'training' then
    raise exception 'event_not_training' using errcode = 'check_violation';
  end if;

  -- No marcar futuro.
  if v_event.starts_at > now() then
    raise exception 'event_in_future' using errcode = 'check_violation';
  end if;

  -- Sin team_id no hay roster que validar.
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  -- Resolver player y validar club.
  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico: el jugador debía estar en team_members del team del
  -- evento en la fecha del evento.
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;

  if not v_belongs then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  -- Forzar recorded_by = auth.uid() (evita suplantación).
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;

  -- updated_at == recorded_at en el alta.
  new.updated_at := new.recorded_at;

  return new;
end;
$$;

create trigger trg_training_attendance_validate_insert
  before insert on public.training_attendance
  for each row execute function public.training_attendance_validate_insert();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trigger: inmutabilidad de FKs + bump updated_at en UPDATE
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.training_attendance_protect_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.event_id is distinct from old.event_id then
    raise exception 'event_id_immutable' using errcode = 'check_violation';
  end if;
  if new.player_id is distinct from old.player_id then
    raise exception 'player_id_immutable' using errcode = 'check_violation';
  end if;
  if new.recorded_by is distinct from old.recorded_by then
    raise exception 'recorded_by_immutable' using errcode = 'check_violation';
  end if;
  if new.recorded_at is distinct from old.recorded_at then
    raise exception 'recorded_at_immutable' using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_training_attendance_protect_update
  before update on public.training_attendance
  for each row execute function public.training_attendance_protect_update();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. RLS
--
-- SELECT: hereda el patrón de events_select_member — cualquier miembro del
--         club del evento. El bug F3-rls-events-visibilidad se hereda
--         (documentado en known-issues.md). Endurecimiento conjunto en F14.
-- INSERT/UPDATE/DELETE: user_can_record_attendance(event_id).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.training_attendance enable row level security;

create policy training_attendance_select_member on public.training_attendance
  for select to authenticated
  using (
    exists (
      select 1 from public.events e
       where e.id = training_attendance.event_id
         and public.user_role_in_club(e.club_id) is not null
    )
  );

create policy training_attendance_insert_managers on public.training_attendance
  for insert to authenticated
  with check (public.user_can_record_attendance(event_id));

create policy training_attendance_update_managers on public.training_attendance
  for update to authenticated
  using      (public.user_can_record_attendance(event_id))
  with check (public.user_can_record_attendance(event_id));

create policy training_attendance_delete_managers on public.training_attendance
  for delete to authenticated
  using (public.user_can_record_attendance(event_id));
