-- Subfase 1.3 — Players + player_accounts + team_members
--
-- Modelo:
--   players (ficha del jugador del club)
--      │
--      ├──< player_accounts (0..N profiles vinculados: self/parent/guardian)
--      │
--      └──< team_members (historial: jugador en N equipos a lo largo del tiempo)
--
-- Decisión: el jugador es una "ficha" del club que existe sin necesidad de cuenta.
-- Una cuenta (profile con rol jugador) se vincula al jugador vía player_accounts.
-- Esto cubre los tres casos del producto:
--   - jugador adulto con su propia cuenta (1 fila, relation='self')
--   - menor sin cuenta (0 filas)
--   - menor con 1+ familiares vinculados (N filas, relation='parent'|'guardian')

-- ─────────────────────────────────────────────────────────────────────────────
-- players (ficha del jugador en el club)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.players (
  id                    uuid primary key default gen_random_uuid(),
  club_id               uuid not null references public.clubs(id) on delete cascade,
  first_name            text not null check (char_length(first_name) between 1 and 80),
  last_name             text not null check (char_length(last_name) between 1 and 120),
  date_of_birth         date not null,
  dorsal                integer check (dorsal is null or dorsal between 1 and 99),
  position_main         text check (position_main is null or position_main in (
    'goalkeeper', 'defender', 'midfielder', 'forward'
  )),
  positions_secondary   text[] not null default '{}'::text[],
  foot                  text check (foot is null or foot in ('right', 'left', 'both')),
  height_cm             integer check (height_cm is null or height_cm between 50 and 250),
  weight_kg             numeric(5,2) check (weight_kg is null or weight_kg between 10 and 200),
  origin                text check (origin is null or char_length(origin) between 1 and 120),
  medical_notes         text,
  photo_url             text check (photo_url is null or photo_url ~ '^https?://'),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.players is
  'Ficha del jugador en el club. Existe independientemente de tener o no una cuenta vinculada (player_accounts).';
comment on column public.players.dorsal is
  'Dorsal "principal" del jugador en el club. El dorsal por equipo concreto va en team_members.';
comment on column public.players.medical_notes is
  'Notas médicas sensibles. Visibles solo a roles con can_see_medical (1.4) o admin_club.';

create index players_club_idx on public.players (club_id);
create index players_last_name_idx on public.players (club_id, last_name);

create trigger players_set_updated_at
  before update on public.players
  for each row execute function public.set_updated_at();

alter table public.players enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- player_accounts (vínculo profile ↔ player)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.player_accounts (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references public.players(id) on delete cascade,
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  relation    text not null check (relation in ('self', 'parent', 'guardian')),
  created_at  timestamptz not null default now(),
  unique (player_id, profile_id)
);

comment on table public.player_accounts is
  'Vincula un profile (rol jugador) a la ficha de un jugador. Permite 0..N cuentas por jugador.';
comment on column public.player_accounts.relation is
  'self = el propio jugador adulto · parent = padre/madre · guardian = tutor legal. Para menores típicamente N filas parent/guardian, ninguna self.';

create index player_accounts_player_idx on public.player_accounts (player_id);
create index player_accounts_profile_idx on public.player_accounts (profile_id);

alter table public.player_accounts enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- team_members (historial jugador ↔ equipo)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.team_members (
  id                  uuid primary key default gen_random_uuid(),
  player_id           uuid not null references public.players(id) on delete cascade,
  team_id             uuid not null references public.teams(id) on delete cascade,
  joined_at           date not null default current_date,
  left_at             date check (left_at is null or left_at >= joined_at),
  dorsal_in_team      integer check (dorsal_in_team is null or dorsal_in_team between 1 and 99),
  position_in_team    text check (position_in_team is null or position_in_team in (
    'goalkeeper', 'defender', 'midfielder', 'forward'
  )),
  created_at          timestamptz not null default now()
);

comment on table public.team_members is
  'Historial de pertenencia del jugador a equipos. Al cambiar de equipo no se borra: se cierra con left_at y se inserta nueva fila.';
comment on column public.team_members.left_at is
  'NULL = jugador activo en el equipo. Una fecha = jugador histórico (dejó el equipo).';
comment on column public.team_members.dorsal_in_team is
  'Dorsal específico que llevó en este equipo (puede diferir del dorsal del club).';

create index team_members_player_idx on public.team_members (player_id);
create index team_members_team_active_idx on public.team_members (team_id) where left_at is null;
create index team_members_team_all_idx on public.team_members (team_id);

-- Solo se permite UNA pertenencia activa (left_at IS NULL) por (player, team).
-- Cerrar la pertenencia (set left_at) o cambiar de equipo es la vía normal.
create unique index team_members_active_unique
  on public.team_members (player_id, team_id)
  where left_at is null;

alter table public.team_members enable row level security;
