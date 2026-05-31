-- F6 Lote B — visibilidad, notas tácticas, cambios programados.
--
-- Spec: docs/specs/6.0-alineaciones.md (Lote B). Aditiva sobre Lote A
-- (20260607000000_lineups.sql).
--
-- Contenido:
--   1. lineups.visibility ('staff' default | 'team') — compartir con equipo.
--   2. lineup_tactical_notes (tabla aparte, SOLO staff) — notas tácticas que
--      NUNCA se exponen a jugador/familia (ver nota de diseño abajo).
--   3. planned_substitutions — cambios programados (SOLO staff).
--   4. Helper user_can_see_shared_lineup + ampliación de las policies SELECT
--      de lineups / lineup_positions para la vista de equipo/familia.
--
-- NOTA DE DISEÑO — por qué tactical_notes va en tabla aparte y no como
-- columna en lineups:
--   La RLS de Postgres es a nivel de FILA, no de COLUMNA. Si las notas fueran
--   una columna de lineups y ampliamos el SELECT de lineups a la vista de
--   equipo (visibility='team'), un jugador podría leer tactical_notes con un
--   GET REST directo a la fila — incumpliendo "las notas NUNCA se exponen".
--   Aislándolas en su propia tabla con RLS solo-staff, la fila de lineups se
--   comparte sin arrastrar las notas. Decisión de producto: notas sensibles.
--
-- NOTA — planned_substitutions es SOLO staff (no hereda la ampliación de
--   lineup_positions a 'team'): el smoke exige que el jugador NO vea los
--   cambios programados. Por eso su SELECT usa user_can_manage_lineup, no la
--   rama de visibilidad de equipo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. lineups.visibility
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.lineups
  add column visibility text not null default 'staff'
    check (visibility in ('staff', 'team'));

comment on column public.lineups.visibility is
  'F6 Lote B — staff (default, solo cuerpo técnico) | team (la alineación OFICIAL se muestra en lectura a jugadores del equipo y sus familias). Las notas tácticas nunca se exponen (viven en lineup_tactical_notes, solo-staff).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Helper: ¿el user es jugador/familia del equipo del evento de este lineup?
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_see_shared_lineup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    join public.team_members tm on tm.team_id = e.team_id and tm.left_at is null
    join public.player_accounts pa on pa.player_id = tm.player_id
    where e.id = p_event_id
      and pa.profile_id = auth.uid()
  );
$$;

comment on function public.user_can_see_shared_lineup(uuid) is
  'F6 Lote B — TRUE si el user actual está vinculado (player_accounts) a un jugador del roster activo del equipo del evento. Usado para exponer la alineación OFICIAL compartida (visibility=team) a jugadores y familias.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Ampliar SELECT de lineups y lineup_positions a la vista de equipo
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists lineups_select on public.lineups;
create policy lineups_select on public.lineups
  for select to authenticated
  using (
    public.user_can_manage_lineup(event_id)
    or (
      is_official
      and visibility = 'team'
      and public.user_can_see_shared_lineup(event_id)
    )
  );

drop policy if exists lineup_positions_select on public.lineup_positions;
create policy lineup_positions_select on public.lineup_positions
  for select to authenticated
  using (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and (
           public.user_can_manage_lineup(l.event_id)
           or (
             l.is_official
             and l.visibility = 'team'
             and public.user_can_see_shared_lineup(l.event_id)
           )
         )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. lineup_tactical_notes (SOLO staff)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.lineup_tactical_notes (
  lineup_id   uuid primary key references public.lineups(id) on delete cascade,
  notes       text not null check (char_length(notes) <= 2000),
  updated_at  timestamptz not null default now()
);

comment on table public.lineup_tactical_notes is
  'F6.9 — notas tácticas del partido (≤2000). Tabla aparte y solo-staff a propósito: nunca se exponen a jugador/familia aunque la alineación sea visibility=team (la RLS de Postgres no filtra columnas).';

alter table public.lineup_tactical_notes enable row level security;

create policy lineup_tactical_notes_all on public.lineup_tactical_notes
  for all to authenticated
  using (
    exists (select 1 from public.lineups l
             where l.id = lineup_tactical_notes.lineup_id
               and public.user_can_manage_lineup(l.event_id))
  )
  with check (
    exists (select 1 from public.lineups l
             where l.id = lineup_tactical_notes.lineup_id
               and public.user_can_manage_lineup(l.event_id))
  );

create trigger lineup_tactical_notes_set_updated_at
  before update on public.lineup_tactical_notes
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. planned_substitutions (F6.8) — SOLO staff
-- ─────────────────────────────────────────────────────────────────────────────

create table public.planned_substitutions (
  id                   uuid primary key default gen_random_uuid(),
  lineup_id            uuid not null references public.lineups(id) on delete cascade,
  minute_planned       smallint not null check (minute_planned >= 0 and minute_planned <= 120),
  player_out_id        uuid not null references public.players(id) on delete cascade,
  player_in_id         uuid not null references public.players(id) on delete cascade,
  position_code_target text check (position_code_target is null or char_length(position_code_target) between 1 and 20),
  created_at           timestamptz not null default now(),

  constraint planned_subs_distinct_players check (player_out_id <> player_in_id)
);

comment on table public.planned_substitutions is
  'F6.8 — cambios programados de un partido (plan, no ejecución). minuto + sale + entra + posición destino. SOLO staff (el jugador no ve el plan de cambios). F7 los convertirá en propuestas ejecutables.';

create index planned_subs_lineup_minute_idx
  on public.planned_substitutions (lineup_id, minute_planned);

alter table public.planned_substitutions enable row level security;

create policy planned_substitutions_all on public.planned_substitutions
  for all to authenticated
  using (
    exists (select 1 from public.lineups l
             where l.id = planned_substitutions.lineup_id
               and public.user_can_manage_lineup(l.event_id))
  )
  with check (
    exists (select 1 from public.lineups l
             where l.id = planned_substitutions.lineup_id
               and public.user_can_manage_lineup(l.event_id))
  );
