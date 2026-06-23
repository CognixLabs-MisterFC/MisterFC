-- F13.10 (rework) — Modelo real del Informe de desarrollo.
--
-- Sustituye el esquema de 4 corners de 13.10a por:
--   · VALORACIÓN DE EQUIPO (team_development_reports): una por team×season×period,
--     con `scores` jsonb (catálogo TEAM de core) + comentario.
--   · INFORME INDIVIDUAL (development_reports): por player×season×period, con
--     `scores` jsonb (catálogo INDIVIDUAL) + comment_overall, y REFERENCIA a la
--     valoración de equipo (team_report_id, enlazada por trigger).
-- Puntuaciones 1–10 por ítem; validación fuerte = zod de core. Las tablas de
-- 13.10a están vacías → DROP/CREATE limpio (confirmado, sin datos a migrar).
-- Molde de autoría/RLS: plays / 13.10a (club/team derivados, scope-team + visibility).
--
-- Reusa helpers existentes: user_role_in_club, user_is_team_staff,
-- user_is_team_member_account, user_can_create_development_reports,
-- development_report_shared_for_player/_team (13.10a; siguen válidos: la tabla
-- recreada mantiene player_id/team_id/season_id/visibility).

-- ── DROP del esquema viejo de informes individuales (vacío) ─────────────────────
drop table if exists public.development_reports cascade;

-- ── Valoración de EQUIPO ─────────────────────────────────────────────────────────
create table public.team_development_reports (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id)   on delete cascade,  -- derivado
  team_id     uuid not null references public.teams(id)   on delete cascade,  -- scope
  season_id   uuid not null references public.seasons(id) on delete cascade,
  period      text not null check (period in ('inicial', 'diciembre', 'marzo', 'junio')),
  scores      jsonb not null default '{}'::jsonb,                 -- item_id→1..10 (catálogo TEAM)
  comment     text check (comment is null or char_length(comment) between 1 and 2000),
  visibility  text not null default 'staff' check (visibility in ('staff', 'team')),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, season_id, period)
);

create index team_development_reports_team_idx on public.team_development_reports (team_id, season_id);
create index team_development_reports_club_idx on public.team_development_reports (club_id);

-- ── Informe INDIVIDUAL ───────────────────────────────────────────────────────────
create table public.development_reports (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id)   on delete cascade,  -- derivado
  team_id         uuid not null references public.teams(id)   on delete cascade,  -- scope
  player_id       uuid not null references public.players(id) on delete cascade,
  season_id       uuid not null references public.seasons(id) on delete cascade,
  period          text not null check (period in ('inicial', 'diciembre', 'marzo', 'junio')),
  scores          jsonb not null default '{}'::jsonb,           -- item_id→1..10 (catálogo INDIVIDUAL)
  comment_overall text check (comment_overall is null or char_length(comment_overall) between 1 and 2000),
  -- Referencia a la valoración de equipo de ese team×season×period (la rellena el
  -- trigger; NULL si aún no existe; on delete set null para no perder el informe).
  team_report_id  uuid references public.team_development_reports(id) on delete set null,
  visibility      text not null default 'staff' check (visibility in ('staff', 'team')),
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (player_id, season_id, period)
);

create index development_reports_team_idx        on public.development_reports (team_id, season_id);
create index development_reports_player_idx       on public.development_reports (player_id, season_id);
create index development_reports_club_idx         on public.development_reports (club_id);
create index development_reports_team_report_idx  on public.development_reports (team_report_id);

-- ── Trigger valoración de equipo: created_by forzado, club derivado, inmutables ──
create or replace function public.team_development_reports_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select c.club_id into v_club
    from public.teams t
    join public.categories c on c.id = t.category_id
   where t.id = new.team_id;
  if v_club is null then
    raise exception 'team_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;

  if jsonb_typeof(new.scores) is distinct from 'object' then
    raise exception 'scores_not_object' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    if new.created_by is distinct from old.created_by then raise exception 'created_by_immutable' using errcode = 'check_violation'; end if;
    if new.club_id   is distinct from old.club_id   then raise exception 'club_immutable'   using errcode = 'check_violation'; end if;
    if new.team_id   is distinct from old.team_id   then raise exception 'team_immutable'   using errcode = 'check_violation'; end if;
    if new.season_id is distinct from old.season_id then raise exception 'season_immutable' using errcode = 'check_violation'; end if;
    if new.period    is distinct from old.period    then raise exception 'period_immutable' using errcode = 'check_violation'; end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_team_development_reports_validate
  before insert or update on public.team_development_reports
  for each row execute function public.team_development_reports_validate();

-- AFTER INSERT: enlaza los informes individuales ya existentes de ese
-- team×season×period a esta valoración de equipo (caso "el de equipo se crea después").
create or replace function public.team_development_reports_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.development_reports
     set team_report_id = new.id
   where team_id = new.team_id
     and season_id = new.season_id
     and period = new.period
     and team_report_id is distinct from new.id;
  return null;
end;
$$;

create trigger trg_team_development_reports_link
  after insert on public.team_development_reports
  for each row execute function public.team_development_reports_link();

-- ── Trigger informe individual: created_by/club derivados, inmutables, ENLACE ────
create or replace function public.development_reports_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select c.club_id into v_club
    from public.teams t
    join public.categories c on c.id = t.category_id
   where t.id = new.team_id;
  if v_club is null then
    raise exception 'team_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;

  if jsonb_typeof(new.scores) is distinct from 'object' then
    raise exception 'scores_not_object' using errcode = 'check_violation';
  end if;

  -- Enlace a la valoración de equipo de ese team×season×period (NULL si no existe).
  new.team_report_id := (
    select tdr.id from public.team_development_reports tdr
     where tdr.team_id = new.team_id
       and tdr.season_id = new.season_id
       and tdr.period = new.period
  );

  if tg_op = 'INSERT' then
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
  else
    if new.created_by is distinct from old.created_by then raise exception 'created_by_immutable' using errcode = 'check_violation'; end if;
    if new.club_id   is distinct from old.club_id   then raise exception 'club_immutable'   using errcode = 'check_violation'; end if;
    if new.team_id   is distinct from old.team_id   then raise exception 'team_immutable'   using errcode = 'check_violation'; end if;
    if new.player_id is distinct from old.player_id then raise exception 'player_immutable' using errcode = 'check_violation'; end if;
    if new.season_id is distinct from old.season_id then raise exception 'season_immutable' using errcode = 'check_violation'; end if;
    if new.period    is distinct from old.period    then raise exception 'period_immutable' using errcode = 'check_violation'; end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger trg_development_reports_validate
  before insert or update on public.development_reports
  for each row execute function public.development_reports_validate();

-- ── RLS: team_development_reports (scope TEAM + visibility) ─────────────────────
alter table public.team_development_reports enable row level security;

create policy team_development_reports_select on public.team_development_reports
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_team_member_account(team_id))
  );

create policy team_development_reports_insert on public.team_development_reports
  for insert to authenticated
  with check (created_by = auth.uid() and public.user_can_create_development_reports(team_id));

create policy team_development_reports_update on public.team_development_reports
  for update to authenticated
  using (public.user_can_create_development_reports(team_id))
  with check (public.user_can_create_development_reports(team_id));

create policy team_development_reports_delete on public.team_development_reports
  for delete to authenticated
  using (public.user_can_create_development_reports(team_id));

-- ── RLS: development_reports (igual patrón) ─────────────────────────────────────
alter table public.development_reports enable row level security;

create policy development_reports_select on public.development_reports
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_team_member_account(team_id))
  );

create policy development_reports_insert on public.development_reports
  for insert to authenticated
  with check (created_by = auth.uid() and public.user_can_create_development_reports(team_id));

create policy development_reports_update on public.development_reports
  for update to authenticated
  using (public.user_can_create_development_reports(team_id))
  with check (public.user_can_create_development_reports(team_id));

create policy development_reports_delete on public.development_reports
  for delete to authenticated
  using (public.user_can_create_development_reports(team_id));
