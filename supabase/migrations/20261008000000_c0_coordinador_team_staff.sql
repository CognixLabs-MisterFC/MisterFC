-- ─────────────────────────────────────────────────────────────────────────────
-- Serie C · C-0 — Modelo: staff_role='coordinador' en team_staff.
--
-- El coordinador pasa a ser STAFF DE EQUIPO (una fila team_staff por equipo que
-- coordina), no un rol club-wide. C-0 es SOLO modelo + UI de asignación: NO cambia
-- ninguna RLS/scope de acotamiento (eso es C-1/C-2) → cero regresión.
--
-- Pre-check en prod (SELECT, antes de tocar el UNIQUE): 0 duplicados activos por
-- (team_id, membership_id) y 0 por (team_id, membership_id, staff_role). El índice
-- nuevo es MÁS PERMISIVO que el viejo (añade staff_role a la clave), así que su
-- creación no puede fallar por datos existentes.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. team_staff.staff_role — añade 'coordinador' al enum de función de equipo.
alter table public.team_staff drop constraint team_staff_staff_role_check;
alter table public.team_staff add constraint team_staff_staff_role_check
  check (staff_role in (
    'entrenador_principal',
    'entrenador_ayudante',
    'preparador_fisico',
    'delegado',
    'coordinador'
  ));

-- 2. invitations.team_staff_role — mismo enum (nullable) + la CHECK de coherencia
--    team_staff_role↔role (para poder invitar un coordinador por email).
alter table public.invitations drop constraint invitations_team_staff_role_check;
alter table public.invitations add constraint invitations_team_staff_role_check
  check (
    team_staff_role is null
    or team_staff_role in (
      'entrenador_principal',
      'entrenador_ayudante',
      'preparador_fisico',
      'delegado',
      'coordinador'
    )
  );

alter table public.invitations drop constraint invitations_team_staff_role_consistency;
alter table public.invitations add constraint invitations_team_staff_role_consistency
  check (
    team_staff_role is null
    or (
      team_id is not null
      and (
        (team_staff_role = 'entrenador_principal' and role = 'entrenador_principal')
        or (team_staff_role = any (array['entrenador_ayudante', 'preparador_fisico', 'delegado'])
            and role = 'entrenador_ayudante')
        or (team_staff_role = 'coordinador' and role = 'coordinador')
      )
    )
  );

-- 3. UNIQUE de asignación activa: añade staff_role a la clave para permitir VARIOS
--    roles activos de la misma persona en el MISMO equipo (p.ej. coordinador Y
--    entrenador_principal del Infantil A). Sigue impidiendo duplicar el MISMO rol
--    activo en el mismo equipo. `team_staff_principal_unique` queda intacto.
drop index if exists team_staff_active_unique;
create unique index team_staff_active_unique
  on public.team_staff (team_id, membership_id, staff_role)
  where left_at is null;

-- 4. Helper LATENTE user_coordinates_team(team_id) — calco de user_is_staff_of_team
--    filtrando staff_role='coordinador'. Se crea para C-1 (acotamiento RLS) pero NO
--    se cablea en ninguna policy todavía.
create or replace function public.user_coordinates_team(p_team_id uuid)
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
      and ts.staff_role = 'coordinador'
      and m.profile_id = auth.uid()
  );
$$;

comment on function public.user_coordinates_team(uuid) is
  'Serie C (C-0, LATENTE) — TRUE si el user actual es COORDINADOR activo del equipo '
  '(team_staff con staff_role=coordinador). Calco de user_is_staff_of_team pero '
  'acotado a coordinador. Se cableará en las RLS de C-1; en C-0 no lo usa nadie.';

revoke all on function public.user_coordinates_team(uuid) from public, anon, authenticated;
grant execute on function public.user_coordinates_team(uuid) to authenticated;
