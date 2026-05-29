-- Subfase 3.1 — Modelo de eventos del calendario.
--
-- Especificación completa: docs/specs/3.0-calendario-eventos.md
-- ADR-0005: estrategia de recurrencia (parent + children explícitos).
-- ADR-0006: la UI vive en apps/web como componente propio (no FullCalendar).
--
-- Modelo:
--   clubs → events (raíz multi-tenant, club_id obligatorio)
--   events.team_id     → equipo concreto (si NULL → no es de equipo)
--   events.category_id → categoría completa (si NULL → no es de categoría)
--   events.parent_event_id → hijo de una serie weekly (recurrencia)
--
--   "at most one set" entre team_id y category_id:
--     (team, NULL)     → evento de equipo
--     (NULL, category) → evento de categoría
--     (NULL, NULL)     → evento de club
--     (team, category) → REJECTED por CHECK
--
-- RLS — D6 de la spec (decisión deliberada de Ola 1):
--   SELECT abierto a cualquier miembro del club. Los eventos son
--   semi-públicos dentro de un club (título, fecha, lugar; sin datos
--   sensibles). El filtro "jugador ve solo eventos de sus equipos y de
--   club" es UX, no seguridad: la query del Server Component filtra lo
--   que muestra.
--
--   Implicación operativa: un jugador autenticado puede consultar vía
--   REST/RPC con cualquier team_id de su club y recuperar eventos a los
--   que no pertenece. Esto es intencional en Ola 1 y se documenta como
--   known-issue `F3-rls-events-visibilidad`. Endurecimiento previsto en
--   F14 (RGPD para menores) mediante helper user_can_see_event(event_id).
--
--   Razones para no endurecer ahora:
--     - Beta cerrada con un solo club piloto: superficie de abuso casi nula.
--     - No expone datos sensibles (medical vive en players.medical_notes
--       con RLS estricta de F2.2).
--     - Simplifica la matriz de policies (sin esta apertura habría 4–5
--       ramas SELECT distintas por rol).
--     - Permite que admin/coord vean todo sin policies separadas.
--     - Endurecimiento posterior es localizado: cambiar policy SELECT +
--       helper; no requiere refactor del modelo.
--
--   INSERT/UPDATE/DELETE: por rol + nueva capability can_manage_calendar
--   (migración 20260530000001) vía helper user_can_manage_event(club,team).
--
-- MVCC (lección heredada de NIDO, ver docs/architecture/rls-policies.md):
--   El helper user_can_manage_event consulta memberships, team_staff y
--   capabilities — NINGUNA de las cuales se modifica en INSERT/UPDATE/
--   DELETE a events. Por tanto el RETURNING * tras INSERT pasa la policy
--   SELECT sin tropezar con filas mutadas en la misma TX.

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla events
-- ─────────────────────────────────────────────────────────────────────────────

create table public.events (
  id                uuid primary key default gen_random_uuid(),

  club_id           uuid not null references public.clubs(id)      on delete cascade,
  team_id           uuid     null references public.teams(id)      on delete cascade,
  category_id       uuid     null references public.categories(id) on delete cascade,

  type              text not null check (type in (
    'training', 'match', 'tournament', 'friendly', 'other'
  )),

  title             text not null check (char_length(title) between 1 and 200),
  notes             text,

  starts_at         timestamptz not null,
  ends_at           timestamptz,
  all_day           boolean not null default false,

  location_name     text check (location_name is null or char_length(location_name) between 1 and 160),
  location_address  text check (location_address is null or char_length(location_address) between 1 and 240),

  opponent_name     text check (opponent_name is null or char_length(opponent_name) between 1 and 120),

  parent_event_id   uuid references public.events(id) on delete cascade,
  recurrence_rule   jsonb,

  created_by        uuid not null references public.profiles(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- "at most one set" entre team_id y category_id:
  -- permite (team, NULL), (NULL, category) y (NULL, NULL).
  constraint events_target_at_most_one check (team_id is null or category_id is null),

  -- ends_at >= starts_at cuando esté presente
  constraint events_window_valid check (ends_at is null or ends_at >= starts_at),

  -- recurrence_rule SOLO en parents (children no la llevan)
  constraint events_recurrence_only_in_parent check (
    parent_event_id is null or recurrence_rule is null
  )
);

comment on table public.events is
  'Eventos del calendario (entrenamientos, partidos, torneos, amistosos, otros). Modelo introducido en F3. RLS SELECT abierta a miembros del club (semi-públicos); ver comentario de cabecera para detalle.';
comment on column public.events.club_id is
  'Denormalizado para multi-tenant y para soportar eventos a nivel club (team_id y category_id ambos NULL).';
comment on column public.events.parent_event_id is
  'Si NULL → parent (o evento aislado). Si rellena → child generado por la regla del parent.';
comment on column public.events.recurrence_rule is
  'jsonb con esquema rígido: {freq:''weekly'', interval, by_weekday[], (count XOR until)}. count = SEMANAS de la serie (no hijos). Validado por Zod en packages/core.';

create index events_club_starts_idx
  on public.events (club_id, starts_at);
create index events_team_starts_idx
  on public.events (team_id, starts_at) where team_id is not null;
create index events_category_starts_idx
  on public.events (category_id, starts_at) where category_id is not null;
create index events_parent_idx
  on public.events (parent_event_id) where parent_event_id is not null;

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

alter table public.events enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger de coherencia club_id ↔ team_id / category_id
--
-- Mismo patrón que invitations_assert_team_same_club: cuando se referencia un
-- team o una categoría, ambos deben pertenecer al club indicado en
-- events.club_id. Errores 23514 (check_violation) para detectar fácil.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.events_assert_target_same_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  derived_club uuid;
begin
  if new.team_id is not null then
    select c.club_id into derived_club
    from public.teams t
    join public.categories c on c.id = t.category_id
    where t.id = new.team_id;

    if derived_club is null then
      raise exception 'team not found' using errcode = '23503';
    end if;
    if derived_club <> new.club_id then
      raise exception 'team belongs to a different club' using errcode = '23514';
    end if;
  end if;

  if new.category_id is not null then
    select c.club_id into derived_club
    from public.categories c
    where c.id = new.category_id;

    if derived_club is null then
      raise exception 'category not found' using errcode = '23503';
    end if;
    if derived_club <> new.club_id then
      raise exception 'category belongs to a different club' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.events_assert_target_same_club() is
  'Verifica que team_id y category_id (si presentes) pertenezcan al club_id indicado. Errores: 23503 (target no existe), 23514 (cross-club).';

create trigger events_target_same_club_check
  before insert or update of club_id, team_id, category_id on public.events
  for each row execute function public.events_assert_target_same_club();

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper RLS: user_can_manage_event
--
-- Devuelve TRUE si el user actual puede crear/editar/borrar el evento.
-- Reglas:
--   - admin_club o coordinador del club → cualquier evento.
--   - entrenador_principal del team específico (vía team_staff activa) →
--     eventos de ese team. NO puede crear eventos de club (team_id NULL).
--   - entrenador_ayudante con can_manage_calendar concedida en el club Y
--     team_staff activa en el team → eventos de ese team. NO puede crear
--     eventos de club.
--   - jugador → nunca.
--
-- Nota: los eventos a nivel club (team_id IS NULL) o categoría
-- (category_id IS NOT NULL) solo los manejan admin/coord. Decisión: un
-- principal/ayudante no debería poder programar a otros equipos.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_manage_event(
  p_club_id uuid,
  p_team_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador')
    or (
      p_team_id is not null
      and public.user_role_in_club(p_club_id) = 'entrenador_principal'
      and public.user_is_staff_of_team(p_team_id)
    )
    or (
      p_team_id is not null
      and public.user_has_capability_in_club(p_club_id, 'can_manage_calendar')
      and public.user_is_staff_of_team(p_team_id)
    );
$$;

comment on function public.user_can_manage_event(uuid, uuid) is
  'TRUE si el user actual puede crear/editar/borrar un evento con (club_id, team_id). Eventos sin team_id solo los manejan admin/coord. Ayudantes requieren can_manage_calendar (F3) + staff activo del team.';

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS policies
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: cualquier miembro del club. Ver comentario de cabecera para D6.
create policy events_select_member on public.events
  for select to authenticated
  using (public.user_role_in_club(club_id) is not null);

create policy events_insert_managers on public.events
  for insert to authenticated
  with check (public.user_can_manage_event(club_id, team_id));

create policy events_update_managers on public.events
  for update to authenticated
  using      (public.user_can_manage_event(club_id, team_id))
  with check (public.user_can_manage_event(club_id, team_id));

create policy events_delete_managers on public.events
  for delete to authenticated
  using (public.user_can_manage_event(club_id, team_id));
