-- Subfase 2.6 — Cuerpo técnico por equipo (tabla `team_staff`)
--
-- Hasta ahora `memberships` describe el rol del user en el CLUB
-- (admin_club, coordinador, entrenador_principal, entrenador_ayudante, jugador),
-- pero no qué equipos concretos entrena. F2.6 introduce ese vínculo con una
-- tabla puente histórica (`joined_at` / `left_at`, mismo patrón que team_members).
--
-- Diseño:
--   - 1 fila = (membership, team, staff_role) durante un intervalo.
--   - staff_role describe la función dentro del equipo, NO el rol de club:
--       · entrenador_principal — uno por equipo activo (índice parcial UNIQUE).
--       · entrenador_ayudante  — N por equipo.
--       · preparador_fisico    — N por equipo.
--       · delegado             — N por equipo.
--   - Mapeo memberships.role ↔ team_staff.staff_role (lo aplica la app):
--       · principal     → membership.role = 'entrenador_principal'
--       · resto         → membership.role = 'entrenador_ayudante'
--     (preparador_fisico y delegado se modelan como ayudantes a nivel club;
--      la distinción funcional vive en team_staff.staff_role.)
--   - Un mismo user puede ser principal de un equipo y ayudante de otro: distinto
--     row por team. Comparten membership_id (un solo profile + club).
--
-- Helpers nuevos:
--   - `user_is_staff_of_team(team_id)` — TRUE si el user actual tiene una fila
--     activa en team_staff de ese equipo. Útil en RLS futuras (F3+) y en la
--     query de /mi-plantilla.
--   - `user_active_team_for_staff()` — primer team activo del user (heurística
--     para /mi-plantilla por defecto cuando solo hay un equipo asignado).

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabla team_staff
-- ─────────────────────────────────────────────────────────────────────────────

create table public.team_staff (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete cascade,
  membership_id   uuid not null references public.memberships(id) on delete cascade,
  staff_role      text not null check (staff_role in (
    'entrenador_principal',
    'entrenador_ayudante',
    'preparador_fisico',
    'delegado'
  )),
  joined_at       date not null default current_date,
  left_at         date check (left_at is null or left_at >= joined_at),
  created_at      timestamptz not null default now()
);

comment on table public.team_staff is
  'Vínculo histórico membership ↔ team con función concreta. Soporta multi-equipo (un user puede aparecer en N equipos con distintos staff_role).';
comment on column public.team_staff.staff_role is
  'Función dentro del equipo (no rol de club). principal único por team activo.';
comment on column public.team_staff.left_at is
  'NULL = vínculo activo; fecha = vínculo cerrado (cambio de equipo o baja).';

create index team_staff_team_active_idx on public.team_staff (team_id) where left_at is null;
create index team_staff_membership_idx on public.team_staff (membership_id);

create unique index team_staff_active_unique
  on public.team_staff (team_id, membership_id)
  where left_at is null;

create unique index team_staff_principal_unique
  on public.team_staff (team_id)
  where left_at is null and staff_role = 'entrenador_principal';

alter table public.team_staff enable row level security;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────────────────────

-- SELECT: cualquier miembro del club del team.
create policy team_staff_select_member
  on public.team_staff
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) is not null
    )
  );

-- INSERT/UPDATE/DELETE: solo admin/coord del club. El "manejar al staff" es
-- decisión del gestor del club, no del propio entrenador.
create policy team_staff_insert_admin
  on public.team_staff
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
    )
  );

create policy team_staff_update_admin
  on public.team_staff
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
    )
  )
  with check (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
    )
  );

create policy team_staff_delete_admin
  on public.team_staff
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'coordinador')
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Helpers SQL
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_is_staff_of_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_staff ts
    join public.memberships m on m.id = ts.membership_id
    where ts.team_id = p_team_id
      and ts.left_at is null
      and m.profile_id = auth.uid()
  );
$$;

comment on function public.user_is_staff_of_team(uuid) is
  'TRUE si el user actual tiene un vínculo team_staff activo con el team. Usado en queries de cuerpo técnico y /mi-plantilla.';


-- Devuelve el team_id activo "preferido" del user en el club indicado.
-- Heurística: el primer team_staff activo del user en ese club (ordenado por
-- joined_at desc). Usado en /mi-plantilla cuando el user tiene varios equipos
-- pero hace falta un default. Si tiene 0, devuelve NULL.
create or replace function public.user_active_team_for_staff(p_club_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ts.team_id
  from public.team_staff ts
  join public.memberships m on m.id = ts.membership_id
  join public.teams t on t.id = ts.team_id
  join public.categories c on c.id = t.category_id
  where ts.left_at is null
    and m.profile_id = auth.uid()
    and c.club_id = p_club_id
  order by ts.joined_at desc
  limit 1;
$$;

comment on function public.user_active_team_for_staff(uuid) is
  'Team activo "por defecto" del user en el club. Heurística: el más reciente. NULL si no hay ninguno.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Extensión de invitations para staff role del equipo
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.invitations
  add column team_staff_role text check (
    team_staff_role is null or team_staff_role in (
      'entrenador_principal',
      'entrenador_ayudante',
      'preparador_fisico',
      'delegado'
    )
  );

comment on column public.invitations.team_staff_role is
  'Función concreta dentro del team_id. Si se rellena, al aceptar la invitación se crea team_staff. Requiere team_id no nulo y role membership coherente (principal o ayudante).';

-- Coherencia rol-team_staff_role:
--   - Si team_staff_role presente → team_id NOT NULL (sin team destino no tiene sentido).
--   - Si team_staff_role='entrenador_principal' → membership role debe ser 'entrenador_principal'.
--   - Resto → membership role debe ser 'entrenador_ayudante'.
alter table public.invitations
  add constraint invitations_team_staff_role_consistency
  check (
    team_staff_role is null
    or (
      team_id is not null
      and (
        (team_staff_role = 'entrenador_principal' and role = 'entrenador_principal')
        or (
          team_staff_role in ('entrenador_ayudante', 'preparador_fisico', 'delegado')
          and role = 'entrenador_ayudante'
        )
      )
    )
  );

-- Trigger: si team_id presente, validar que pertenece al mismo club que invitations.club_id.
-- (Pre-existía para player_id; añadimos cobertura para team_id en el mismo helper.)
create or replace function public.invitations_assert_team_same_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  team_club uuid;
begin
  if new.team_id is null then
    return new;
  end if;

  select c.club_id into team_club
  from public.teams t
  join public.categories c on c.id = t.category_id
  where t.id = new.team_id;

  if team_club is null then
    raise exception 'team not found' using errcode = '23503';
  end if;

  if team_club <> new.club_id then
    raise exception 'team belongs to a different club'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger invitations_team_same_club_check
  before insert or update of team_id, club_id
  on public.invitations
  for each row execute function public.invitations_assert_team_same_club();
