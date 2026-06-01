-- F7.1 — Modelo de datos de la toma de datos en directo del partido.
--
-- Spec: docs/specs/7.0-toma-datos-en-directo.md (§3 modelo, §4 permisos/RLS, §6 reloj).
-- ADR-0009: <MatchFieldEditor> compartido F6/F7 (la UI de F7 lo consumirá; aquí solo modelo).
--
-- Alcance de ESTA migración (subfase 7.1, decisión 1A+2A del responsable):
--   - match_state     — cabecera de sesión 1:1 con el partido (status, lock, marcador).
--   - match_periods   — reloj persistente y recuperable (§6): clock_seconds absoluto.
--   - match_starters  — once inicial CONGELADO al pitido (§7), base del cálculo de minutos.
--   - match_events    — log del partido (propio + rival), corazón de F7.
--   - helper user_can_record_match(event_id) + RLS de las 4 tablas.
--   - relaja lineups_validate a type in ('match','friendly') (§5.2) para no excluir
--     amistosos de la toma de datos ni de la alineación que alimenta el once inicial.
--
-- FUERA de esta migración (llegan en su subfase):
--   - match_player_stats (consolidación) → subfase de CIERRE 7.10 (decisión 2A).
--   - toda la UI (pantalla, drag&drop, cronómetro) → 7.2+.
--
-- Patrón heredado (igual que F4/F6, ver 20260607000000_lineups.sql):
--   - Validación por TRIGGER (no CHECK con función) cuando depende de events/team_members.
--   - club_id denormalizado para multi-tenant (se DERIVA del evento en el trigger →
--     siempre coherente, el INSERT no necesita pasarlo).
--   - created_by := auth.uid() forzado en INSERT (solo match_events lo tiene).
--   - event_id inmutable en UPDATE; updated_at automático.
--   - Helper "autoridad por equipo": team_staff (no memberships.role), vía user_is_staff_of_team.
--
-- MVCC (lección NIDO, docs/architecture/rls-policies.md):
--   user_can_record_match lee events / memberships / team_staff — NINGUNA mutada por los
--   INSERT/UPDATE a las tablas de F7. Por tanto el RETURNING * tras INSERT pasa la policy
--   SELECT sin tropezar con filas mutadas en la misma TX (sin gotcha self-referential).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper RLS: user_can_record_match(event_id)
--
-- Decisión §4: la captura en vivo la hace el CUERPO TÉCNICO del equipo del partido
-- (team_staff activo: principal Y ayudante), NO solo quien creó la alineación, NI
-- mediante capability nueva. Gate = staff activo del team (user_is_staff_of_team) +
-- admin/coord del club. Resuelto por autoridad team_staff, no por memberships.role.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_record_match(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(e.club_id) in ('admin_club', 'coordinador')
    or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
    from public.events e
   where e.id = p_event_id;
$$;

comment on function public.user_can_record_match(uuid) is
  'F7 — TRUE si el user puede registrar datos en vivo del partido: admin/coord del club, o cualquier team_staff activo del team del evento (principal o ayudante). NO requiere capability propia (ver spec 7.0 §4).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Ajuste de gating: lineups_validate admite amistosos (§5.2)
--
-- F6 restringía las alineaciones a type='match'. F7 captura también amistosos, y el
-- once inicial puede venir de una alineación de amistoso → se relaja a match/friendly.
-- Migración NUEVA (nunca editar 20260607000000 ya aplicada). Resto del cuerpo idéntico.
-- ─────────────────────────────────────────────────────────────────────────────

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
  if v_event.type not in ('match', 'friendly') then
    raise exception 'event_not_match_or_friendly' using errcode = 'check_violation';
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. match_state — cabecera de sesión (1:1 con el partido)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.match_state (
  event_id        uuid primary key references public.events(id) on delete cascade,
  club_id         uuid not null references public.clubs(id) on delete cascade,  -- DERIVADO en trigger

  status          text not null default 'not_started' check (status in (
                    'not_started', 'live', 'closed')),

  goals_for       smallint check (goals_for is null or goals_for >= 0),
  goals_against   smallint check (goals_against is null or goals_against >= 0),

  post_match_notes text check (post_match_notes is null or char_length(post_match_notes) <= 4000),

  -- Mono-operador (§5.5): lock ADVISORY, no exclusión dura.
  operator_profile_id uuid references public.profiles(id),
  lock_heartbeat_at   timestamptz,

  reopened_count  smallint not null default 0 check (reopened_count >= 0),
  started_at      timestamptz,
  closed_at       timestamptz,
  closed_by       uuid references public.profiles(id),

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.match_state is
  'F7 — sesión de captura en vivo, 1:1 con el partido (events). status not_started→live→closed; reabrir vuelve a live e incrementa reopened_count. club_id derivado del evento. Marcador y notas se rellenan al cerrar (7.10/7.11).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. match_periods — reloj persistente y recuperable (§6)
--
-- clock_seconds absoluto de un instante =
--   base_offset_seconds + accumulated_seconds + (running ? now() - last_started_at : 0)
-- Tras una recarga el cliente reconstruye el cronómetro leyendo estas filas.
-- ─────────────────────────────────────────────────────────────────────────────

create table public.match_periods (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  period          text not null check (period in (
                    'first_half', 'second_half', 'extra_first', 'extra_second', 'penalties')),
  ordinal         smallint not null check (ordinal >= 1),

  base_offset_seconds  integer not null default 0 check (base_offset_seconds >= 0),
  accumulated_seconds  integer not null default 0 check (accumulated_seconds >= 0),
  running              boolean not null default false,
  last_started_at      timestamptz,
  ended                boolean not null default false,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint match_periods_unique_period  unique (event_id, period),
  constraint match_periods_unique_ordinal unique (event_id, ordinal),

  -- Si corre, hay marca de arranque; si no corre, no la hay.
  constraint match_periods_running_coherent check (
    (running and last_started_at is not null)
    or (not running and last_started_at is null))
);

comment on table public.match_periods is
  'F7 — reloj del partido por periodo (§6). clock_seconds absoluto = base_offset + accumulated + (running ? now()-last_started_at : 0). Recuperable tras recarga; descanso = ningún periodo running.';

create index match_periods_event_idx on public.match_periods (event_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. match_starters — once inicial congelado al pitido (§7)
--
-- Snapshot del 11/8/7 que EMPIEZA el partido. No se lee la alineación de F6 en vivo
-- (puede editarse después). Base del cálculo de minutos jugados (7.8).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.match_starters (
  event_id      uuid not null references public.events(id) on delete cascade,
  player_id     uuid not null references public.players(id) on delete cascade,
  position_code text check (position_code is null or char_length(position_code) between 1 and 20),
  created_at    timestamptz not null default now(),

  primary key (event_id, player_id)
);

comment on table public.match_starters is
  'F7 — once inicial CONGELADO al pitido (§7). Una fila por titular. Base del cálculo de minutos jugados (7.8). Inmutable salvo borrado/realta antes de iniciar.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. match_events — log del partido (corazón de F7)
--
-- side='own'   → actor por player_id (FK, opcional: eventos de equipo sin jugador).
-- side='rival' → actor por rival_dorsal (sin roster del rival, §3.4/§8).
-- substitution → player_id = SALE, related_player_id = ENTRA.
-- clock_seconds absoluto (§6) para minutos fiables; display_minute/period para la UI.
-- x_pct/y_pct (0-100, atacando hacia arriba como F6) solo en eventos de campo.
-- id lo genera el CLIENTE (UUID) → reintento idempotente tras corte de red (§10).
-- ─────────────────────────────────────────────────────────────────────────────

create table public.match_events (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  club_id       uuid not null references public.clubs(id) on delete cascade,  -- DERIVADO en trigger

  side          text not null check (side in ('own', 'rival')),
  type          text not null check (type in (
                  'goal', 'assist', 'yellow_card', 'red_card',
                  'substitution', 'corner', 'foul', 'offside', 'shot')),

  player_id         uuid references public.players(id) on delete set null,
  rival_dorsal      smallint check (rival_dorsal is null or rival_dorsal between 1 and 99),
  related_player_id uuid references public.players(id) on delete set null,

  period         text not null default 'first_half' check (period in (
                   'first_half', 'second_half', 'extra_first', 'extra_second', 'penalties')),
  display_minute smallint check (display_minute is null or display_minute between 0 and 130),
  clock_seconds  integer not null check (clock_seconds >= 0),

  x_pct         numeric(5,2) check (x_pct is null or (x_pct >= 0 and x_pct <= 100)),
  y_pct         numeric(5,2) check (y_pct is null or (y_pct >= 0 and y_pct <= 100)),

  metadata      jsonb not null default '{}'::jsonb,

  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Actor coherente con el bando.
  constraint match_events_actor_by_side check (
    (side = 'own'   and rival_dorsal is null)
    or (side = 'rival' and player_id is null and related_player_id is null)),

  -- related_player_id (jugador que entra) solo en sustituciones.
  constraint match_events_related_only_sub check (
    related_player_id is null or type = 'substitution'),

  -- Coordenadas solo en eventos de campo (no en gol/asistencia/tarjeta/cambio).
  constraint match_events_coords_field_only check (
    (x_pct is null and y_pct is null) or type in ('corner', 'foul', 'offside', 'shot'))
);

comment on table public.match_events is
  'F7 — log de eventos del partido en vivo (propio y rival). clock_seconds absoluto para minutos fiables (§6). id generado en cliente → reintento idempotente (§10). club_id derivado del evento.';

create index match_events_event_clock_idx on public.match_events (event_id, clock_seconds);
create index match_events_player_idx on public.match_events (player_id) where player_id is not null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Triggers de validación
--
-- Helper interno: valida el evento (existe, es match/friendly, tiene team) y devuelve
-- su rowtype, para no repetir el SELECT en cada trigger.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.match_assert_event(p_event_id uuid)
returns events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  select * into v_event from public.events where id = p_event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type not in ('match', 'friendly') then
    raise exception 'event_not_match_or_friendly' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;
  return v_event;
end;
$$;

comment on function public.match_assert_event(uuid) is
  'F7 — valida que el evento exista, sea match/friendly y tenga team; devuelve su rowtype. Usado por los triggers de las tablas de captura.';

-- Helper interno: el player pertenece al club del evento y al roster histórico del team
-- a la fecha del partido (mismo patrón que lineup_positions / callup).
create or replace function public.match_assert_player_in_team(p_player_id uuid, p_event events)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player  players%rowtype;
  v_belongs boolean;
begin
  select * into v_player from public.players where id = p_player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> p_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = p_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= p_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= p_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;
end;
$$;

comment on function public.match_assert_player_in_team(uuid, events) is
  'F7 — verifica que el player pertenezca al club del evento y al roster del team a la fecha del partido.';

-- match_state ─────────────────────────────────────────────────────────────────
create or replace function public.match_state_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  v_event := public.match_assert_event(new.event_id);
  new.club_id := v_event.club_id;  -- derivado, autoritativo

  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_match_state_validate
  before insert or update on public.match_state
  for each row execute function public.match_state_validate();

-- match_periods ───────────────────────────────────────────────────────────────
create or replace function public.match_periods_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.match_assert_event(new.event_id);

  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_match_periods_validate
  before insert or update on public.match_periods
  for each row execute function public.match_periods_validate();

-- match_starters ──────────────────────────────────────────────────────────────
create or replace function public.match_starters_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  v_event := public.match_assert_event(new.event_id);
  perform public.match_assert_player_in_team(new.player_id, v_event);

  if tg_op = 'UPDATE' then
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_match_starters_validate
  before insert or update on public.match_starters
  for each row execute function public.match_starters_validate();

-- match_events ────────────────────────────────────────────────────────────────
create or replace function public.match_events_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  v_event := public.match_assert_event(new.event_id);
  new.club_id := v_event.club_id;  -- derivado, autoritativo

  -- Eventos propios CON jugador: validar pertenencia (rival y eventos de equipo sin jugador no).
  if new.player_id is not null then
    perform public.match_assert_player_in_team(new.player_id, v_event);
  end if;
  if new.related_player_id is not null then
    perform public.match_assert_player_in_team(new.related_player_id, v_event);
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

create trigger trg_match_events_validate
  before insert or update on public.match_events
  for each row execute function public.match_events_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RLS — las 4 tablas ligadas a user_can_record_match(event_id).
--    Sin gotcha MVCC: el helper lee events/team_staff/memberships, no estas tablas.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.match_state    enable row level security;
alter table public.match_periods  enable row level security;
alter table public.match_starters enable row level security;
alter table public.match_events   enable row level security;

-- match_state
create policy match_state_select on public.match_state
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_state_insert on public.match_state
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_state_update on public.match_state
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_state_delete on public.match_state
  for delete to authenticated using (public.user_can_record_match(event_id));

-- match_periods
create policy match_periods_select on public.match_periods
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_periods_insert on public.match_periods
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_periods_update on public.match_periods
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_periods_delete on public.match_periods
  for delete to authenticated using (public.user_can_record_match(event_id));

-- match_starters
create policy match_starters_select on public.match_starters
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_starters_insert on public.match_starters
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_starters_update on public.match_starters
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_starters_delete on public.match_starters
  for delete to authenticated using (public.user_can_record_match(event_id));

-- match_events
create policy match_events_select on public.match_events
  for select to authenticated using (public.user_can_record_match(event_id));
create policy match_events_insert on public.match_events
  for insert to authenticated with check (public.user_can_record_match(event_id));
create policy match_events_update on public.match_events
  for update to authenticated
  using (public.user_can_record_match(event_id))
  with check (public.user_can_record_match(event_id));
create policy match_events_delete on public.match_events
  for delete to authenticated using (public.user_can_record_match(event_id));
