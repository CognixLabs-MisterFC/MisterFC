-- Rework C · C5 — modelo de temporada explícito (cimiento del rollover #4).
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§4 D-b, §5 C5). ADR-0018.
--
-- Hasta ahora la "temporada actual" se infería del reloj (currentSeason()). C5 la
-- convierte en un ESTADO explícito por club: una fila `seasons` por temporada, con
-- status active|finalized y UNA sola activa por club. La temporada activa es la
-- fuente de verdad de "¿en qué temporada operamos?" (defaults de alta de equipo,
-- selectores, import). currentSeason() pasa a ser solo SUGERIDOR de label.
--
-- `label` usa el formato canónico YYYY-YY (igual que teams.season) para poder
-- gobernar el default de season al crear equipos. (El "25/26" del enunciado es
-- abreviatura; se almacena "2025-26".)

create table public.seasons (
  id          uuid primary key default gen_random_uuid(),
  club_id     uuid not null references public.clubs(id) on delete cascade,
  label       text not null check (label ~ '^[0-9]{4}-[0-9]{2}$'),
  status      text not null default 'active' check (status in ('active', 'finalized')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.seasons is
  'Rework C (C5) — temporadas del club. status active|finalized; UNA activa por club (la "temporada actual" real). label en formato YYYY-YY (= teams.season).';
comment on column public.seasons.status is
  'active = temporada en curso del club (default de alta de equipo, selectores). finalized = cerrada. Una sola active por club (índice parcial).';

create unique index seasons_club_label_uniq on public.seasons (club_id, label);
-- UNA sola activa por club.
create unique index seasons_one_active_per_club on public.seasons (club_id) where status = 'active';
create index seasons_club_idx on public.seasons (club_id);

alter table public.seasons enable row level security;

-- ── RLS: miembros del club leen; solo admin_club modifica ────────────────────
create policy seasons_select_members on public.seasons
  for select to authenticated
  using (public.user_role_in_club(club_id) is not null);

create policy seasons_insert_admin on public.seasons
  for insert to authenticated
  with check (public.user_role_in_club(club_id) = 'admin_club');

create policy seasons_update_admin on public.seasons
  for update to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club')
  with check (public.user_role_in_club(club_id) = 'admin_club');

create policy seasons_delete_admin on public.seasons
  for delete to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club');

-- ── Backfill idempotente ─────────────────────────────────────────────────────
-- Por club: una season por cada distinct teams.season (finalized), y la MÁS
-- RECIENTE pasa a active. Club sin equipos → una season activa con el label
-- del reloj (formato YYYY-YY, misma heurística que currentSeason: corte 1-ago).
do $$
declare
  v_club   record;
  v_latest text;
  v_year   int;
  v_month  int;
  v_start  int;
  v_curlbl text;
begin
  v_year  := extract(year  from now())::int;
  v_month := extract(month from now())::int;
  v_start := case when v_month >= 8 then v_year else v_year - 1 end;
  v_curlbl := v_start::text || '-' || lpad(((v_start + 1) % 100)::text, 2, '0');

  for v_club in select id from public.clubs loop
    -- 1) todas las temporadas presentes en equipos → finalized (idempotente)
    insert into public.seasons (club_id, label, status)
      select v_club.id, d.season, 'finalized'
        from (select distinct season from public.teams where club_id = v_club.id) d
      on conflict (club_id, label) do nothing;

    -- 2) la más reciente (o el label del reloj si no hay equipos) → active
    select max(season) into v_latest from public.teams where club_id = v_club.id;

    if v_latest is null then
      insert into public.seasons (club_id, label, status)
        values (v_club.id, v_curlbl, 'active')
      on conflict (club_id, label) do update set status = 'active', updated_at = now();
    else
      update public.seasons
         set status = 'active', updated_at = now()
       where club_id = v_club.id and label = v_latest;
    end if;
  end loop;
end $$;
