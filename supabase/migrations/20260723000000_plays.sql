-- F13.1b — Modelo `plays` (playbook del equipo): jugadas animadas persistentes.
-- Spec: docs/specs/13.0-pizarra-jugadas-animadas.md §5 (D1 team-scoped, D2 directo).
-- Molde: exercises (F11) / sessions (F12). El contrato del jsonb vive en core
-- (13.1a, `playSchema`/`parsePlay`); aquí solo la forma LIGERA + autoridad/RLS.
--
-- Notas de implementación:
--   - Columnas `name` + `play` (jsonb) según el encargo de 13.1b (el SQL de la
--     spec §5 las llamaba `title`/`data` y añadía `description`; se sigue el
--     encargo: `name`, `play`, sin `description`).
--   - Capability: se REUTILIZA `can_create_plays`, que YA existe en el enum de
--     `capabilities` (20260527114619) y la siembra `ensure_assistant_capabilities`
--     para los ayudantes. No se crea ninguna capability nueva.
--   - Sin `is_template` ni ciclo de aprobación (D2 directo, como sesiones).

-- ── Tabla ─────────────────────────────────────────────────────────────────────
create table public.plays (
  id                uuid primary key default gen_random_uuid(),
  owner_profile_id  uuid not null references public.profiles(id) on delete cascade,
  club_id           uuid not null references public.clubs(id)    on delete cascade,  -- denormalizado (RLS)
  team_id           uuid not null references public.teams(id)    on delete cascade,  -- D1: team-scoped
  name              text check (name is null or char_length(name) between 1 and 120),
  play              jsonb not null,                 -- Play (D3); validación fuerte = parsePlay en la app
  visibility        text not null default 'staff'   -- D2
                      check (visibility in ('staff', 'team')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index plays_team_idx  on public.plays (team_id, updated_at desc);
create index plays_club_idx  on public.plays (club_id);
create index plays_owner_idx on public.plays (owner_profile_id);

-- ── Helpers de autoría/visibilidad (espejan los de sesiones, scope TEAM) ───────
-- ¿Es el user actual STAFF activo (cualquier rol de team_staff) de este equipo?
-- Da visibilidad de las jugadas `visibility='staff'` al cuerpo técnico del equipo.
create or replace function public.user_is_team_staff(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_team_id is not null and exists (
    select 1
    from public.team_staff ts
    join public.memberships m on m.id = ts.membership_id
    where ts.team_id = p_team_id
      and ts.left_at is null
      and m.profile_id = auth.uid()
  );
$$;
comment on function public.user_is_team_staff(uuid) is
  'F13.1b — TRUE si el user actual es staff activo (team_staff) del equipo indicado.';
grant execute on function public.user_is_team_staff(uuid) to authenticated;

-- ¿Puede el user actual CREAR jugadas en este equipo? Espeja user_can_create_sessions:
-- admin/coord del club, o entrenador_principal del propio team (team_staff), o la
-- capability `can_create_plays` concedida en el club (cubre a los ayudantes).
create or replace function public.user_can_create_plays(p_team_id uuid)
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
      and (
        public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
        or public.user_has_capability_in_club(c.club_id, 'can_create_plays')
        or exists (
          select 1
          from public.team_staff ts
          join public.memberships m on m.id = ts.membership_id
          where ts.team_id = p_team_id
            and ts.staff_role = 'entrenador_principal'
            and ts.left_at is null
            and m.profile_id = auth.uid()
            and m.club_id = c.club_id
        )
      )
  );
$$;
comment on function public.user_can_create_plays(uuid) is
  'F13.1b — autoridad de creación de jugadas en un equipo: admin/coord, principal del team o capability can_create_plays.';
grant execute on function public.user_can_create_plays(uuid) to authenticated;

-- ── Trigger (molde sessions): owner forzado, club derivado, inmutables, forma ──
create or replace function public.plays_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  -- club_id SIEMPRE derivado del team (coherencia D1): el cliente no lo fija.
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
      new.owner_profile_id := auth.uid();
    end if;
  else  -- UPDATE: owner / club / team inmutables
    if new.owner_profile_id is distinct from old.owner_profile_id then
      raise exception 'owner_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    if new.team_id is distinct from old.team_id then
      raise exception 'team_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  -- Forma LIGERA del jsonb (la autoritativa es parsePlay en la app): objeto con
  -- `frames` array no vacío y <= MAX_FRAMES (60, ver core 13.1a). Espeja la
  -- validación ligera del diagram en exercises/sessions.
  if jsonb_typeof(new.play) is distinct from 'object' then
    raise exception 'play_not_object' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(new.play -> 'frames') is distinct from 'array' then
    raise exception 'play_frames_not_array' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(new.play -> 'frames') < 1
     or jsonb_array_length(new.play -> 'frames') > 60 then
    raise exception 'play_frames_out_of_range' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_plays_validate
  before insert or update on public.plays
  for each row execute function public.plays_validate();

-- ── RLS (scope TEAM + visibility — D1/D2) ─────────────────────────────────────
alter table public.plays enable row level security;

-- SELECT: autor, o admin/coord del club, o staff del equipo (visibility staff);
-- además jugadores/familias del team ven las jugadas visibility='team' (read-only).
create policy plays_select on public.plays
  for select to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_team_member_account(team_id))
  );

-- INSERT: owner forzado a auth.uid() y autoridad de creación en ese team.
create policy plays_insert on public.plays
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_can_create_plays(team_id)
  );

-- UPDATE: autor o admin/coord (D2: sin ciclo de estados).
create policy plays_update on public.plays
  for update to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
  )
  with check (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
  );

-- DELETE: autor o admin/coord.
create policy plays_delete on public.plays
  for delete to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
  );
