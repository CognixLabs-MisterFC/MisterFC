-- F6.10 — Plantillas personalizadas de formación (coach_formations).
--
-- Spec: docs/specs/6.0-alineaciones.md (F6.10). El coach define sus propias
-- formaciones (layout de N posiciones sobre el campo) reutilizables en el
-- editor de alineación, además del catálogo estático en código (ADR-0013).
-- Migración aditiva.
--
-- Modelo:
--   coach_formations(owner_profile_id, club_id, name, format, positions JSONB)
--   positions = array de objetos {position_code, x_pct, y_pct} con N items
--   según format (F7=7, F8=8, F11=11; incluye portero). La forma del JSONB se
--   valida en un trigger (longitud + tipos + rangos), no en CHECK, porque hay
--   que iterar el array y comprobar cada item.
--
-- Capability: REUTILIZA can_create_lineups (igual que lineups, F6). No se crea.
--
-- RLS:
--   SELECT  — el dueño, o admin_club/coordinador del club (auditoría/lectura).
--   INSERT  — owner = auth.uid() + can_create_lineups en el club.
--   UPDATE  — solo el dueño.
--   DELETE  — el dueño, o admin_club del club.

create table public.coach_formations (
  id                uuid primary key default gen_random_uuid(),
  owner_profile_id  uuid not null references public.profiles(id) on delete cascade,
  club_id           uuid not null references public.clubs(id) on delete cascade,
  name              text not null check (char_length(name) between 1 and 60),
  format            text not null check (format in ('F7', 'F8', 'F11')),
  positions         jsonb not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Un coach no repite nombre dentro de la misma modalidad (puede tener
  -- "Plan ofensivo" en F7 y en F8 sin colisión; el UI filtra por modalidad).
  constraint coach_formations_owner_format_name_unique unique (owner_profile_id, format, name)
);

comment on table public.coach_formations is
  'F6.10 — plantillas de formación personalizadas del coach: layout de N posiciones (según format) reutilizable en el editor de alineación.';

create index coach_formations_owner_idx on public.coach_formations (owner_profile_id);
create index coach_formations_club_format_idx on public.coach_formations (club_id, format);

-- ─────────────────────────────────────────────────────────────────────────────
-- Validación de positions + owner forzado a auth.uid() + updated_at.
--
-- positions debe ser un array de exactamente N objetos (N = 7/8/11 según
-- format), cada uno con position_code (text 1..20), x_pct y y_pct (number en
-- [0,100]). Los errores usan errcode check_violation para que la app los mapee.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.coach_formations_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected int;
  v_item     jsonb;
  v_code     text;
  v_x        numeric;
  v_y        numeric;
begin
  v_expected := case new.format
    when 'F7'  then 7
    when 'F8'  then 8
    when 'F11' then 11
  end;

  if jsonb_typeof(new.positions) <> 'array' then
    raise exception 'positions_not_array' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(new.positions) <> v_expected then
    raise exception 'positions_count_mismatch' using errcode = 'check_violation';
  end if;

  for v_item in select * from jsonb_array_elements(new.positions)
  loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'position_not_object' using errcode = 'check_violation';
    end if;
    v_code := v_item->>'position_code';
    if v_code is null or char_length(v_code) < 1 or char_length(v_code) > 20 then
      raise exception 'position_code_invalid' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_item->'x_pct') <> 'number'
       or jsonb_typeof(v_item->'y_pct') <> 'number' then
      raise exception 'position_coords_not_number' using errcode = 'check_violation';
    end if;
    v_x := (v_item->>'x_pct')::numeric;
    v_y := (v_item->>'y_pct')::numeric;
    if v_x < 0 or v_x > 100 or v_y < 0 or v_y > 100 then
      raise exception 'position_coords_out_of_range' using errcode = 'check_violation';
    end if;
  end loop;

  -- Defensa: el dueño es siempre el usuario autenticado (cuando hay sesión).
  -- club_id y owner son inmutables tras crear.
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_profile_id := auth.uid();
    end if;
  else
    if new.owner_profile_id is distinct from old.owner_profile_id then
      raise exception 'owner_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

create trigger trg_coach_formations_validate
  before insert or update on public.coach_formations
  for each row execute function public.coach_formations_validate();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.coach_formations enable row level security;

-- SELECT — el dueño, o admin/coordinador del club (lectura/auditoría).
create policy coach_formations_select on public.coach_formations
  for select to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
  );

-- INSERT — solo para uno mismo, con la capability en ese club.
create policy coach_formations_insert on public.coach_formations
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_has_capability_in_club(club_id, 'can_create_lineups')
  );

-- UPDATE — solo el dueño.
create policy coach_formations_update on public.coach_formations
  for update to authenticated
  using      (owner_profile_id = auth.uid())
  with check (owner_profile_id = auth.uid());

-- DELETE — el dueño, o un admin del club.
create policy coach_formations_delete on public.coach_formations
  for delete to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
  );
