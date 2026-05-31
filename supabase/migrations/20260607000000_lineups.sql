-- F6 Lote A — Modelo de alineaciones: lineups + lineup_positions.
--
-- Spec: docs/specs/6.0-alineaciones.md (§2 Decisión 1, §5 Decisión 4).
-- ADR-0012: modelo normalizado (tablas) vs JSON blob.
-- ADR-0009: <MatchFieldEditor> compartido F6/F7 (consume este modelo).
--
-- Alcance de ESTA migración (Lote A):
--   - lineups            — cabecera; varias por partido (F6.4), una oficial.
--   - lineup_positions   — jugador en field/bench/out (F6.3, F6.5, F6.7);
--                          drag&drop bidireccional campo↔banquillo↔fuera.
--   - helper user_can_manage_lineup(event_id) + RLS.
--   - capability: REUTILIZA can_create_lineups (F1.4). No se crea ninguna.
--
-- Fuera de esta migración (llegan en Lote B):
--   - lineup_positions.callup_status  (F6.6, snapshot de convocatoria).
--   - lineups.visibility / tactical_notes (F6.9 + compartir con familia).
--   - planned_substitutions (F6.8), lineup_objectives / _player_notes /
--     _phase_notes (F6.9).
--
-- Patrón heredado:
--   - Triggers (no CHECK con función) para validaciones que dependen de
--     `events` y `team_members` — igual que F4 (match_callup).
--   - Helper "autoridad por equipo": entrenador principal se resuelve por
--     team_staff.staff_role, NO por memberships.role (fix F4 Lote B,
--     20260603000000_callup_manage_team_staff.sql).
--
-- MVCC (lección NIDO, docs/architecture/rls-policies.md):
--   user_can_manage_lineup lee events / team_staff / memberships /
--   capabilities — NINGUNA mutada por INSERT/UPDATE a lineups o
--   lineup_positions. Por tanto el RETURNING * tras INSERT pasa la policy
--   SELECT sin tropezar con filas mutadas en la misma TX. La policy SELECT
--   de lineup_positions lee la tabla `lineups` (distinta de la insertada),
--   así que tampoco aplica el gotcha self-referential.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper RLS: user_can_manage_lineup(event_id)
--
-- Espejo de user_can_manage_callup (F4.3 bis). Reglas:
--   - admin/coord del club → siempre.
--   - principal del TEAM (team_staff.staff_role, NO memberships.role).
--   - staff activo del team con capability can_create_lineups (ayudantes).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_manage_lineup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- admin/coord del club: siempre.
    public.user_role_in_club(e.club_id) in ('admin_club', 'coordinador')
    -- principal del TEAM (autoridad: team_staff.staff_role, no memberships.role).
    or (
      e.team_id is not null
      and exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = e.team_id
          and ts.staff_role = 'entrenador_principal'
          and ts.left_at is null
          and m.profile_id = auth.uid()
          and m.club_id = e.club_id
      )
    )
    -- staff activo del team con capability can_create_lineups (ayudantes).
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_create_lineups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

comment on function public.user_can_manage_lineup(uuid) is
  'F6 — TRUE si el user puede crear/editar alineaciones del evento. admin/coord del club, principal del team (team_staff.staff_role, NO memberships.role), o staff del team con capability can_create_lineups.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. lineups (cabecera)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.lineups (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 60),
  formation_code  text not null check (char_length(formation_code) between 1 and 40),
  is_official     boolean not null default false,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.lineups is
  'F6 — cabecera de alineación de un partido. Varias por evento (titular/plan B/2ª parte, F6.4). formation_code referencia el catálogo en código (packages/core/lineups, ADR-0013), no una tabla. visibility/tactical_notes llegan en Lote B.';
comment on column public.lineups.formation_code is
  'Código de formación del catálogo en código (ej. 4-3-3, 1-3-3). No es FK: el catálogo vive en packages/core. Si el código se retira del catálogo, la UI degrada mostrando el code crudo.';
comment on column public.lineups.is_official is
  'Marca la alineación oficial del partido. Máximo una por evento (índice parcial único).';

-- Una sola alineación oficial por partido.
create unique index lineups_one_official_per_event
  on public.lineups (event_id) where is_official;

create index lineups_event_idx on public.lineups (event_id);

-- Trigger de validación: el evento debe ser un partido con team, created_by
-- forzado a auth.uid(), inmutabilidad de event_id, updated_at automático.
create or replace function public.lineups_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type <> 'match' then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_lineups_validate
  before insert or update on public.lineups
  for each row execute function public.lineups_validate();

alter table public.lineups enable row level security;

-- SELECT (Lote A): solo quien puede gestionar (staff). La apertura a
-- familia/jugador (visibility='team' sobre la oficial) llega en Lote B.
create policy lineups_select on public.lineups
  for select to authenticated
  using (public.user_can_manage_lineup(event_id));

create policy lineups_insert on public.lineups
  for insert to authenticated
  with check (public.user_can_manage_lineup(event_id));

create policy lineups_update on public.lineups
  for update to authenticated
  using      (public.user_can_manage_lineup(event_id))
  with check (public.user_can_manage_lineup(event_id));

create policy lineups_delete on public.lineups
  for delete to authenticated
  using (public.user_can_manage_lineup(event_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. lineup_positions (jugador en field/bench/out)
--
-- location separa el rol del jugador en la alineación:
--   field → titular (exige position_code; x/y opcionales para snap del preset).
--   bench → suplente.
--   out   → fuera de convocatoria (exige out_reason).
-- Invariante "un jugador, una zona": unique (lineup_id, player_id).
--
-- position_code NO se valida contra el catálogo en BD (el catálogo vive en
-- código, ADR-0013). La app valida que el code pertenezca a la formación.
-- La BD solo garantiza la coherencia location ↔ position_code / out_reason.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.lineup_positions (
  id              uuid primary key default gen_random_uuid(),
  lineup_id       uuid not null references public.lineups(id) on delete cascade,
  player_id       uuid not null references public.players(id) on delete cascade,
  location        text not null default 'bench' check (location in ('field', 'bench', 'out')),
  position_code   text check (position_code is null or char_length(position_code) between 1 and 20),
  x_pct           numeric(5,2) check (x_pct is null or (x_pct >= 0 and x_pct <= 100)),
  y_pct           numeric(5,2) check (y_pct is null or (y_pct >= 0 and y_pct <= 100)),
  out_reason      text check (out_reason is null or out_reason in (
    'tecnico', 'fisico', 'disciplinario', 'personal')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- Un jugador ocupa una sola zona dentro de la alineación.
  constraint lineup_positions_unique_player unique (lineup_id, player_id),

  -- field exige position_code; bench/out NO lo llevan.
  constraint lineup_positions_field_has_position check (
    (location = 'field' and position_code is not null)
    or (location in ('bench', 'out') and position_code is null)),

  -- out exige out_reason; field/bench NO lo llevan.
  constraint lineup_positions_out_reason_coherent check (
    (location = 'out'  and out_reason is not null)
    or (location <> 'out' and out_reason is null)),

  -- x/y solo tienen sentido en el campo.
  constraint lineup_positions_coords_only_field check (
    location = 'field' or (x_pct is null and y_pct is null))
);

comment on table public.lineup_positions is
  'F6 — posición de cada jugador en una alineación: field (titular) / bench (suplente) / out (fuera de convocatoria). Un jugador, una zona (unique lineup_id+player_id). callup_status (F6.6 snapshot) se añade en Lote B.';

create index lineup_positions_lineup_idx on public.lineup_positions (lineup_id);
-- Índice por player_id pensado para las stats posicionales de F9.
create index lineup_positions_player_idx on public.lineup_positions (player_id);

-- Trigger de validación: el player pertenece al club del evento y al roster
-- histórico del team a la fecha del partido (mismo patrón que callup). Evita
-- colar jugadores ajenos al equipo en la alineación.
create or replace function public.lineup_positions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   events%rowtype;
  v_player  players%rowtype;
  v_belongs boolean;
begin
  select e.* into v_event
    from public.events e
    join public.lineups l on l.event_id = e.id
   where l.id = new.lineup_id;
  if not found then
    raise exception 'lineup_or_event_not_found' using errcode = 'foreign_key_violation';
  end if;

  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del partido (igual que F4).
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

  if tg_op = 'UPDATE' then
    if new.lineup_id is distinct from old.lineup_id then
      raise exception 'lineup_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_lineup_positions_validate
  before insert or update on public.lineup_positions
  for each row execute function public.lineup_positions_validate();

alter table public.lineup_positions enable row level security;

-- RLS: ligada a la gestión del lineup padre. Lee la tabla `lineups` (distinta
-- de lineup_positions) → sin gotcha MVCC self-referential.
create policy lineup_positions_select on public.lineup_positions
  for select to authenticated
  using (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and public.user_can_manage_lineup(l.event_id)
    )
  );

create policy lineup_positions_insert on public.lineup_positions
  for insert to authenticated
  with check (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and public.user_can_manage_lineup(l.event_id)
    )
  );

create policy lineup_positions_update on public.lineup_positions
  for update to authenticated
  using (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and public.user_can_manage_lineup(l.event_id)
    )
  )
  with check (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and public.user_can_manage_lineup(l.event_id)
    )
  );

create policy lineup_positions_delete on public.lineup_positions
  for delete to authenticated
  using (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and public.user_can_manage_lineup(l.event_id)
    )
  );
