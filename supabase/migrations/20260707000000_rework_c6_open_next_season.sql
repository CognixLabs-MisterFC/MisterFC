-- Rework C · C6 — abrir temporada nueva + recrear equipos (sin tocar los viejos).
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C6). ADR-0018.
--
--   1. seasons.status admite 'upcoming' (preparación). Sigue habiendo UNA 'active'
--      por club; ahora puede coexistir UNA 'upcoming' (índice parcial).
--   2. open_next_season(club_id): idempotente. Si no hay 'upcoming', crea una con
--      label = siguiente al de la activa; clona la ESTRUCTURA de equipos de la
--      activa hacia la upcoming (mismo category/name/format/color/division). NO
--      toca la activa ni sus equipos. Re-ejecutar reanuda la upcoming y solo
--      clona los equipos que falten (por nombre). La season existe antes que los
--      equipos → sin etiquetas huérfanas.

-- ── 1. Estado 'upcoming' ─────────────────────────────────────────────────────
alter table public.seasons drop constraint seasons_status_check;
alter table public.seasons
  add constraint seasons_status_check check (status in ('upcoming', 'active', 'finalized'));

comment on column public.seasons.status is
  'upcoming = en preparación (rollover); active = temporada en curso (una por club); finalized = cerrada. Una sola active y una sola upcoming por club (índices parciales).';

-- UNA sola upcoming por club (además de la única active).
create unique index seasons_one_upcoming_per_club on public.seasons (club_id) where status = 'upcoming';

-- ── 2. open_next_season ──────────────────────────────────────────────────────
create or replace function public.open_next_season(p_club_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_active   text;
  v_upcoming text;
  v_year     int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club puede abrir temporada (coincide con la RLS de seasons).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  select label into v_active from public.seasons
   where club_id = p_club_id and status = 'active' limit 1;
  if v_active is null then
    raise exception 'no_active_season' using errcode = 'P0001';
  end if;

  -- Reanuda la upcoming si ya existe; si no, créala con el label siguiente.
  select label into v_upcoming from public.seasons
   where club_id = p_club_id and status = 'upcoming' limit 1;

  if v_upcoming is null then
    v_year := left(v_active, 4)::int;  -- 'YYYY-YY' → siguiente: YYYY+1 - (YYYY+2 mod 100)
    v_upcoming := (v_year + 1)::text || '-' || lpad(((v_year + 2) % 100)::text, 2, '0');
    insert into public.seasons (club_id, label, status)
      values (p_club_id, v_upcoming, 'upcoming')
    on conflict (club_id, label) do update set status = 'upcoming', updated_at = now();
  end if;

  -- Clona la estructura de equipos de la activa → upcoming (idempotente por nombre).
  -- NO se tocan los equipos de la activa. La season upcoming ya existe (arriba).
  insert into public.teams (club_id, category_id, season, name, format, color, division)
    select s.club_id, s.category_id, v_upcoming, s.name, s.format, s.color, s.division
      from public.teams s
     where s.club_id = p_club_id
       and s.season = v_active
       and not exists (
         select 1 from public.teams d
          where d.club_id = p_club_id
            and d.season = v_upcoming
            and lower(d.name) = lower(s.name)
       );

  return v_upcoming;
end;
$$;

comment on function public.open_next_season(uuid) is
  'Rework C (C6) — abre/reanuda la temporada upcoming del club y clona la estructura de equipos de la activa (idempotente, no destructivo). Solo admin_club. Devuelve el label de la upcoming.';
