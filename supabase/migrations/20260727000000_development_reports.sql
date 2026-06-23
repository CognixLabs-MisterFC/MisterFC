-- F13.10a — Modelo "Informe de desarrollo" (development_reports) + objetivos.
--
-- Informe trimestral de desarrollo del jugador por temporada: 4 ejes ("4 corners")
-- puntuados 1–5 + comentarios, en 4 periodos comparables (inicial/diciembre/
-- marzo/junio), con UNIQUE(player_id,season_id,period) → 4 filas comparables para
-- la evolución (13.10f). Objetivos individuales (jugador) y de equipo, con estado.
-- Molde: plays (20260723000000): club_id/team_id derivados por trigger, helpers
-- SECURITY DEFINER, RLS scope-team + visibility. El contrato fuerte (zod) vive en
-- core (development-report). NO confundir con `evaluations` (F8, nota 1–10/partido).
--
-- Reusa helpers existentes: user_role_in_club, user_is_team_staff,
-- user_is_team_member_account, user_is_account_of_player (F8).

-- ── Tablas ──────────────────────────────────────────────────────────────────────
create table public.development_reports (
  id                       uuid primary key default gen_random_uuid(),
  club_id                  uuid not null references public.clubs(id)    on delete cascade,  -- derivado
  team_id                  uuid not null references public.teams(id)    on delete cascade,  -- scope
  player_id                uuid not null references public.players(id)  on delete cascade,
  season_id                uuid not null references public.seasons(id)  on delete cascade,
  period                   text not null check (period in ('inicial', 'diciembre', 'marzo', 'junio')),
  score_tecnica_tactica    smallint check (score_tecnica_tactica is null or score_tecnica_tactica between 1 and 5),
  score_fisica             smallint check (score_fisica          is null or score_fisica          between 1 and 5),
  score_psicologica        smallint check (score_psicologica     is null or score_psicologica     between 1 and 5),
  score_social             smallint check (score_social          is null or score_social          between 1 and 5),
  comment_tecnica_tactica  text check (comment_tecnica_tactica is null or char_length(comment_tecnica_tactica) between 1 and 2000),
  comment_fisica           text check (comment_fisica          is null or char_length(comment_fisica)          between 1 and 2000),
  comment_psicologica      text check (comment_psicologica     is null or char_length(comment_psicologica)     between 1 and 2000),
  comment_social           text check (comment_social          is null or char_length(comment_social)          between 1 and 2000),
  comment_overall          text check (comment_overall         is null or char_length(comment_overall)         between 1 and 2000),
  visibility               text not null default 'staff' check (visibility in ('staff', 'team')),  -- D8/D14
  created_by               uuid not null references public.profiles(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (player_id, season_id, period)   -- 4 filas comparables por jugador/temporada
);

create index development_reports_team_idx   on public.development_reports (team_id, season_id);
create index development_reports_player_idx  on public.development_reports (player_id, season_id);
create index development_reports_club_idx    on public.development_reports (club_id);

create table public.player_objectives (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id)    on delete cascade,  -- derivado
  team_id         uuid not null references public.teams(id)    on delete cascade,  -- scope
  player_id       uuid not null references public.players(id)  on delete cascade,
  season_id       uuid not null references public.seasons(id)  on delete cascade,
  title           text not null check (char_length(title) between 1 and 200),
  description     text check (description is null or char_length(description) between 1 and 2000),
  status          text not null default 'open' check (status in ('open', 'achieved', 'dropped')),
  created_period  text not null check (created_period in ('inicial', 'diciembre', 'marzo', 'junio')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index player_objectives_player_idx on public.player_objectives (player_id, season_id);
create index player_objectives_team_idx   on public.player_objectives (team_id, season_id);
create index player_objectives_club_idx   on public.player_objectives (club_id);

create table public.team_objectives (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs(id)   on delete cascade,  -- derivado
  team_id      uuid not null references public.teams(id)   on delete cascade,  -- scope
  season_id    uuid not null references public.seasons(id) on delete cascade,
  title        text not null check (char_length(title) between 1 and 200),
  description  text check (description is null or char_length(description) between 1 and 2000),
  status       text not null default 'open' check (status in ('open', 'achieved', 'dropped')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index team_objectives_team_idx on public.team_objectives (team_id, season_id);
create index team_objectives_club_idx on public.team_objectives (club_id);

-- ── Helpers de autoría/visibilidad (scope TEAM) ───────────────────────────────────
-- ¿Puede el user CREAR/editar informes/objetivos en este equipo? D13: admin/coord
-- del club, o CUALQUIER staff activo del equipo (principal o ayudante). Distinto de
-- user_can_create_plays (que exige principal o capability): aquí cualquier team_staff.
create or replace function public.user_can_create_development_reports(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    join public.categories c on c.id = t.category_id
    where t.id = p_team_id
      and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
  )
  or public.user_is_team_staff(p_team_id);
$$;
comment on function public.user_can_create_development_reports(uuid) is
  'F13.10a — autoridad de escritura de informes de desarrollo/objetivos: admin/coord del club o cualquier staff activo del equipo (D13).';
grant execute on function public.user_can_create_development_reports(uuid) to authenticated;

-- ¿Hay algún informe de ese jugador/temporada COMPARTIDO (visibility='team')?
-- Gate de lectura para la familia de los objetivos individuales (D14): la familia
-- ve los objetivos del jugador en cuanto algún informe del curso está compartido.
create or replace function public.development_report_shared_for_player(p_player_id uuid, p_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.development_reports dr
    where dr.player_id = p_player_id
      and dr.season_id = p_season_id
      and dr.visibility = 'team'
  );
$$;
grant execute on function public.development_report_shared_for_player(uuid, uuid) to authenticated;

-- ¿Hay algún informe de ese equipo/temporada COMPARTIDO? Gate para la familia de
-- los objetivos GRUPALES (D14): los ve cuando algún informe del curso se comparte.
create or replace function public.development_report_shared_for_team(p_team_id uuid, p_season_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.development_reports dr
    where dr.team_id = p_team_id
      and dr.season_id = p_season_id
      and dr.visibility = 'team'
  );
$$;
grant execute on function public.development_report_shared_for_team(uuid, uuid) to authenticated;

-- ── Trigger informes: created_by forzado, club derivado, inmutables, updated_at ──
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

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else  -- UPDATE: identidad e historial inmutables
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    if new.team_id is distinct from old.team_id then
      raise exception 'team_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_immutable' using errcode = 'check_violation';
    end if;
    if new.season_id is distinct from old.season_id then
      raise exception 'season_immutable' using errcode = 'check_violation';
    end if;
    if new.period is distinct from old.period then
      raise exception 'period_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_development_reports_validate
  before insert or update on public.development_reports
  for each row execute function public.development_reports_validate();

-- ── Trigger objetivos de jugador: club derivado, inmutables, updated_at ─────────
create or replace function public.player_objectives_validate()
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

  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id then
      raise exception 'team_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_immutable' using errcode = 'check_violation';
    end if;
    if new.season_id is distinct from old.season_id then
      raise exception 'season_immutable' using errcode = 'check_violation';
    end if;
    if new.created_period is distinct from old.created_period then
      raise exception 'created_period_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_player_objectives_validate
  before insert or update on public.player_objectives
  for each row execute function public.player_objectives_validate();

-- ── Trigger objetivos de equipo: club derivado, inmutables, updated_at ──────────
create or replace function public.team_objectives_validate()
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

  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id then
      raise exception 'team_immutable' using errcode = 'check_violation';
    end if;
    if new.season_id is distinct from old.season_id then
      raise exception 'season_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_team_objectives_validate
  before insert or update on public.team_objectives
  for each row execute function public.team_objectives_validate();

-- ── RLS: development_reports (scope TEAM + visibility) ──────────────────────────
alter table public.development_reports enable row level security;

-- SELECT: admin/coord o staff del equipo; además la familia del team ve los
-- informes visibility='team' (read-only).
create policy development_reports_select on public.development_reports
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_team_member_account(team_id))
  );

-- INSERT: autoridad de escritura en ese team (admin/coord o staff del equipo);
-- created_by forzado a auth.uid() por el trigger.
create policy development_reports_insert on public.development_reports
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.user_can_create_development_reports(team_id)
  );

create policy development_reports_update on public.development_reports
  for update to authenticated
  using (public.user_can_create_development_reports(team_id))
  with check (public.user_can_create_development_reports(team_id));

create policy development_reports_delete on public.development_reports
  for delete to authenticated
  using (public.user_can_create_development_reports(team_id));

-- ── RLS: player_objectives ───────────────────────────────────────────────────────
alter table public.player_objectives enable row level security;

-- SELECT: admin/coord o staff del equipo; la familia del jugador los ve cuando hay
-- algún informe del curso compartido (D14).
create policy player_objectives_select on public.player_objectives
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (
      public.user_is_account_of_player(player_id)
      and public.development_report_shared_for_player(player_id, season_id)
    )
  );

create policy player_objectives_insert on public.player_objectives
  for insert to authenticated
  with check (public.user_can_create_development_reports(team_id));

create policy player_objectives_update on public.player_objectives
  for update to authenticated
  using (public.user_can_create_development_reports(team_id))
  with check (public.user_can_create_development_reports(team_id));

create policy player_objectives_delete on public.player_objectives
  for delete to authenticated
  using (public.user_can_create_development_reports(team_id));

-- ── RLS: team_objectives ─────────────────────────────────────────────────────────
alter table public.team_objectives enable row level security;

-- SELECT: admin/coord o staff del equipo; la familia del team los ve cuando hay
-- algún informe del curso compartido con el equipo (D14).
create policy team_objectives_select on public.team_objectives
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (
      public.user_is_team_member_account(team_id)
      and public.development_report_shared_for_team(team_id, season_id)
    )
  );

create policy team_objectives_insert on public.team_objectives
  for insert to authenticated
  with check (public.user_can_create_development_reports(team_id));

create policy team_objectives_update on public.team_objectives
  for update to authenticated
  using (public.user_can_create_development_reports(team_id))
  with check (public.user_can_create_development_reports(team_id));

create policy team_objectives_delete on public.team_objectives
  for delete to authenticated
  using (public.user_can_create_development_reports(team_id));
