-- F13.10g-0 — Campaña de evaluaciones: fechas límite por temporada×periodo.
--
-- El admin del club fija una fecha límite (due_date) para completar/publicar los
-- informes de desarrollo de cada periodo (inicial/diciembre/marzo/junio) de una
-- temporada. Es config club-wide (D7): UNA fila por club×temporada×periodo, válida
-- para TODOS los equipos de esa temporada. UNIQUE(season_id, period) → upsert.
--
-- Decisiones cerradas: D1 tabla nueva, D7 club-wide. Soft (D3): esta migración solo
-- guarda la fecha; no bloquea nada (las alertas/seguimiento/cierre son G-1..G-3).
--
-- Molde: development_reports (20260727000000) — club_id/created_by derivados por
-- trigger, RLS por rol del club, trigger set_updated_at. Reusa user_role_in_club.

-- ── Tabla ────────────────────────────────────────────────────────────────────────
create table public.assessment_deadlines (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id)   on delete cascade,  -- derivado del season
  season_id   uuid not null references public.seasons(id) on delete cascade,
  period      text not null check (period in ('inicial', 'diciembre', 'marzo', 'junio')),
  due_date    date not null,
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (season_id, period)   -- una fecha por temporada×periodo (club-wide, D7)
);

create index assessment_deadlines_season_idx on public.assessment_deadlines (season_id);
create index assessment_deadlines_club_idx   on public.assessment_deadlines (club_id);

comment on table public.assessment_deadlines is
  'F13.10g — fecha límite (due_date) por club×temporada×periodo para completar/publicar los informes de desarrollo. Club-wide (D7): aplica a todos los equipos de la temporada. La fija el admin del club. Soft (D3): no bloquea, solo informa (alertas/seguimiento en G-1/G-2).';

-- ── Trigger: club_id derivado del season, created_by forzado, inmutables ──────────
create or replace function public.assessment_deadlines_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select s.club_id into v_club
    from public.seasons s
   where s.id = new.season_id;
  if v_club is null then
    raise exception 'season_not_found' using errcode = 'foreign_key_violation';
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

create trigger trg_assessment_deadlines_validate
  before insert or update on public.assessment_deadlines
  for each row execute function public.assessment_deadlines_validate();

-- ── RLS ──────────────────────────────────────────────────────────────────────────
alter table public.assessment_deadlines enable row level security;

-- SELECT: cualquier miembro del club (la fecha no es sensible; el staff la usa en la
-- pantalla de equipo y G-1/G-2). user_role_in_club devuelve NULL si no es miembro.
create policy assessment_deadlines_select on public.assessment_deadlines
  for select to authenticated
  using (public.user_role_in_club(club_id) is not null);

-- ESCRITURA: SOLO admin_club del club (coherente con quién edita club_settings, D10).
-- El club_id lo deriva el trigger del season; el WITH CHECK lo valida vía el season.
create policy assessment_deadlines_insert on public.assessment_deadlines
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.user_role_in_club(
      (select s.club_id from public.seasons s where s.id = season_id)
    ) = 'admin_club'
  );

create policy assessment_deadlines_update on public.assessment_deadlines
  for update to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club')
  with check (public.user_role_in_club(club_id) = 'admin_club');

create policy assessment_deadlines_delete on public.assessment_deadlines
  for delete to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club');
