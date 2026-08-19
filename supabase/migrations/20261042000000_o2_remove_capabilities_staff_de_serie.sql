-- O2 — ELIMINACIÓN DEL SISTEMA DE CAPABILITIES DEL CUERPO TÉCNICO.
--
-- Decisión de producto (Jose): "si se pone enfermo el entrenador principal,
-- ¿quién gestiona?". Un ayudante que necesita que le activen permisos a última
-- hora es un estorbo. Por tanto:
--
--   TODO el cuerpo técnico (principal Y ayudante, incluidos preparador_fisico y
--   delegado, que a nivel de club tienen membership.role='entrenador_ayudante')
--   puede DE SERIE, sin configuración: pasar lista · valorar · crear alineaciones
--   · registrar eventos del directo · crear sesiones · crear jugadas · crear
--   ejercicios · gestionar convocatorias · gestionar calendario · escribir a
--   familias · gestionar plantilla.
--
--   El sistema de 12 capabilities (tabla + trigger + helpers + gates) DESAPARECE.
--
-- PATRÓN DE REESCRITURA DE GATES (el mismo que ya usan user_can_record_match y
-- user_can_create_development_reports): la rama
--     "OR (user_has_capability_in_club(...,'can_X') AND user_is_staff_of_team(t))"
-- (y, donde existía, la rama de PRINCIPAL detectada por team_staff.staff_role) se
-- sustituye por "cualquier staff activo del equipo" (user_is_staff_of_team) para
-- los gates por-evento/equipo, o "cualquier team_staff activo del club" para los
-- gates club-scoped. admin/director/coordinador conservan su acceso exacto.
--
-- QUIÉN GANA ACCESO: SOLO el ayudante-class (entrenador_ayudante, y por herencia
-- de membership.role los preparador_fisico y delegado, que son cuerpo técnico).
-- Ningún rol ajeno al cuerpo técnico gana nada: user_is_staff_of_team y las ramas
-- de rol solo cubren team_staff / roles de club ya existentes.
--
-- NOTAS MÉDICAS: NO SE TOCAN (decisión de Jose). El path vivo de lectura médica
-- es get_player_medical → user_can_access_player_medical (F14-4/F14-6), que NUNCA
-- consultó `can_see_medical` (usa user_is_staff_of_team). Este cambio no altera
-- ninguna función de consentimiento, auditoría ni borrado. La capability
-- can_see_medical era vestigial; sus únicos consumidores (user_can_see_player_medical,
-- user_can_manage_player) son funciones MUERTAS —sus llamadores eran las policies
-- de foto player_photos_*_staff, ya dropeadas en F14-3b— y se retiran aquí como
-- limpieza (no forman parte del gate médico vigente; sin cambio de comportamiento).
--
-- can_evaluate y can_register_match_events eran capabilities MUERTAS: ningún gate
-- las leía (valorar = user_can_create_development_reports = cualquier team_staff;
-- directo = user_can_record_match = cualquier team_staff). Se van sin tocar gate.
--
-- NORMA DE MIGRACIONES: cada función se recrea desde su DEFINICIÓN VIVA
-- (pg_get_functiondef); el único cambio respecto a la def viva es retirar la rama
-- de capability (y, en los gates por-evento con rama principal inline, colapsarla
-- en user_is_staff_of_team). Se indica la migración de la def viva en cada bloque.
--
-- DATOS: drop completo de la tabla capabilities (CASCADE → se lleva sus 3 policies
-- e índice y todas las filas), del trigger y de los 2 helpers. Sin huérfanos.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. GATES CLUB-SCOPED (def viva: 20261026 fix_null_gate_propagation).
--    Diff: se elimina la línea `or user_has_capability_in_club(club,'can_X')` y se
--    elimina el filtro `ts.staff_role = 'entrenador_principal'` del EXISTS de
--    team_staff → pasa a "cualquier team_staff activo del club". Resto idéntico.
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.user_can_create_coach_formations(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    -- cualquier staff activo de algún equipo del club (principal o ayudante).
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

create or replace function public.user_can_create_exercises(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

create or replace function public.user_can_create_plays(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

create or replace function public.user_can_create_sessions(p_club_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    ),
  false);
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. GATES POR-EVENTO (def viva: 20261026). Diff: la rama de PRINCIPAL (inline
--    EXISTS staff_role='entrenador_principal', o user_is_principal_of_team) y la
--    rama de capability se colapsan en `user_is_staff_of_team(e.team_id)`. Quedan
--    IDÉNTICOS a user_can_record_match (patrón "cualquier staff del equipo").
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.user_can_record_attendance(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

create or replace function public.user_can_manage_callup(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

create or replace function public.user_can_manage_lineup(p_event_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce((
    select
      public.user_role_in_club(e.club_id) in ('admin_club', 'director')
      or (e.team_id is not null and public.user_coordinates_team(e.team_id))
      or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
      from public.events e
     where e.id = p_event_id
  ), false);
$function$;

-- user_can_manage_event(p_club_id, p_team_id) (def viva: 20261026). Diff: rama (B)
-- principal + rama (C) capability → user_is_staff_of_team(p_team_id). Resto igual.
create or replace function public.user_can_manage_event(p_club_id uuid, p_team_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select coalesce(
    -- (A) admin o director del club (club-wide)
    public.user_role_in_club(p_club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO de ESE equipo (C-1a)
    or (p_team_id is not null and public.user_coordinates_team(p_team_id))
    -- (B) cualquier staff activo del equipo del evento (principal o ayudante)
    or (p_team_id is not null and public.user_is_staff_of_team(p_team_id)),
  false);
$function$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. POLICIES DE MENSAJERÍA (def viva: 20261011 c1c). Diff: se retira la rama
--    can_message_families; la rama de principal (EXISTS staff_role='entrenador_
--    principal') se amplía a cualquier team_staff activo (misma técnica que arriba).
-- ═════════════════════════════════════════════════════════════════════════════

drop policy if exists conversations_insert_coach on public.conversations;
create policy conversations_insert_coach
  on public.conversations
  for insert
  to authenticated
  with check (
    coach_profile_id = auth.uid()
    and (
      public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
      or exists (
        select 1
        from public.team_members tm
        where tm.player_id = conversations.player_id
          and tm.left_at is null
          and public.user_coordinates_team(tm.team_id)
      )
      -- cualquier staff activo de algún equipo del club (principal o ayudante).
      or exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        join public.teams t on t.id = ts.team_id
        join public.categories c on c.id = t.category_id
        where ts.left_at is null
          and m.profile_id = auth.uid()
          and c.club_id = conversations.club_id
      )
    )
  );

drop policy if exists announcements_insert_managers on public.announcements;
create policy announcements_insert_managers
  on public.announcements
  for insert
  to authenticated
  with check (
    author_profile_id = auth.uid()
    and (
      -- CLUB (team_id null): solo dirección (sin cambios).
      (announcements.team_id is null and public.user_role_in_club(club_id) = any (array['admin_club', 'director']))
      -- EQUIPO: dirección/principal, coordinador del equipo, o cualquier staff del equipo.
      or (
        announcements.team_id is not null
        and (
          public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
          or public.user_coordinates_team(announcements.team_id)
          or public.user_is_staff_of_team(announcements.team_id)
        )
      )
    )
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 4. POLICIES DE PLANTILLA (def viva: 20261010 c1b). Diff: se retira la rama
--    can_manage_squad y se añade 'entrenador_ayudante' a la lista de roles de club
--    (equivalente club-wide exacto de la capability, que era per-membership). El
--    coordinador conserva su rama team-scoped. Resto idéntico.
-- ═════════════════════════════════════════════════════════════════════════════

drop policy if exists players_insert_staff on public.players;
create policy players_insert_staff
  on public.players
  for insert
  to authenticated
  with check (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'coordinador', 'entrenador_principal', 'entrenador_ayudante']
    )
  );

drop policy if exists players_update_staff on public.players;
create policy players_update_staff
  on public.players
  for update
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
    )
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = players.id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  )
  with check (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
    )
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = players.id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  );

drop policy if exists players_delete_staff on public.players;
create policy players_delete_staff
  on public.players
  for delete
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
    )
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = players.id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  );

-- team_members_write_staff (def viva: 20261010 c1b) — pertenencia jugador↔equipo.
-- FOR ALL (USING = WITH CHECK). Diff: se retira la rama EXISTS con can_manage_squad
-- y se añade 'entrenador_ayudante' a la lista de roles de club del jugador. El
-- coordinador conserva su rama user_coordinates_team.
drop policy if exists team_members_write_staff on public.team_members;
create policy team_members_write_staff
  on public.team_members
  for all
  to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = team_members.player_id
        and public.user_role_in_club(p.club_id) = any (
          array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
        )
    )
    or public.user_coordinates_team(team_members.team_id)
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = team_members.player_id
        and public.user_role_in_club(p.club_id) = any (
          array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
        )
    )
    or public.user_coordinates_team(team_members.team_id)
  );

-- ═════════════════════════════════════════════════════════════════════════════
-- 5. FUNCIONES MUERTAS consumidoras de capability (limpieza). Sus únicos
--    llamadores eran las policies player_photos_*_staff (dropeadas en F14-3b) y
--    quedaban solo en los tipos generados. NO son el gate médico vivo.
-- ═════════════════════════════════════════════════════════════════════════════

drop function if exists public.user_can_manage_player(uuid);
drop function if exists public.user_can_see_player_medical(uuid);

-- ═════════════════════════════════════════════════════════════════════════════
-- 6. DESMANTELAR EL SISTEMA DE CAPABILITIES.
--    Trigger → función seed → tabla (CASCADE: policies capabilities_select/
--    update/insert_managers + índice + filas) → 2 helpers (sin consumidores).
-- ═════════════════════════════════════════════════════════════════════════════

drop trigger if exists memberships_ensure_assistant_capabilities on public.memberships;
drop function if exists public.ensure_assistant_capabilities();

drop table if exists public.capabilities cascade;

drop function if exists public.user_has_capability_in_club(uuid, text);
drop function if exists public.user_has_capability(uuid, text);
