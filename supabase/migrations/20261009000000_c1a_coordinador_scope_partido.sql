-- ═════════════════════════════════════════════════════════════════════════════
-- C-1a — ACOTAR EL COORDINADOR A SUS EQUIPOS: dominio EVENTOS / PARTIDOS /
-- ASISTENCIA / CONVOCATORIAS / ALINEACIONES (+ EVALUACIONES, que comparten el
-- helper user_can_record_match).
--
-- Serie C: el coordinador accede/gestiona SOLO los equipos que le asigna el
-- director (team_staff.staff_role='coordinador', modelo C-0). Hoy es club-wide
-- porque entra por la rama `user_role_in_club(club_id) in
-- ('admin_club','director','coordinador')` (heredado de F1B, 20260823).
--
-- ESTE PR: en cada helper/policy de este dominio, la rama que hoy incluye
-- 'coordinador' vía user_role_in_club pasa a:
--   · admin_club / director  → club-wide (IGUAL QUE HOY, sin cambios).
--   · coordinador            → rama nueva que exige user_coordinates_team(<team_id
--                              de la fila>) (helper SECURITY DEFINER creado en C-0).
--
-- Cada objeto se RECREA COMPLETO desde su definición VIVA (F1B 20260823 para los
-- 5 helpers; pg_policies para events_select) para no perder NINGUNA otra rama
-- (principal de equipo, staff con capability, member_account, spectator,
-- match-type club-wide, etc.). admin/director/superadmin: sin cambios.
--
-- FUERA de C-1a (por decisión de Jose):
--   · coach_formations_select — banco de formaciones por AUTOR, sin team_id; no
--     acotable per-team. NO se toca (el banco es para todos).
--   · sesiones/jugadores/informes/notas (C-1b), chats/anuncios (C-1c),
--     estructura/team_staff (C-1d).
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 1.1 user_can_manage_event (calendario) ──────────────────────────────────
-- Base viva: F1B 20260823. Ramas: (A) admin/director/coord club-wide →
-- acotada; (B) principal del equipo; (C) staff con can_manage_calendar.
create or replace function public.user_can_manage_event(
  p_club_id uuid,
  p_team_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin o director del club (club-wide, igual que hoy)
    public.user_role_in_club(p_club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO de ESE equipo (C-1a)
    or (
      p_team_id is not null
      and public.user_coordinates_team(p_team_id)
    )
    -- (B) entrenador PRINCIPAL del equipo del evento (rol a nivel EQUIPO)
    or (
      p_team_id is not null
      and public.user_is_principal_of_team(p_team_id)
    )
    -- (C) cualquier staff del equipo con la capability can_manage_calendar
    or (
      p_team_id is not null
      and public.user_has_capability_in_club(p_club_id, 'can_manage_calendar')
      and public.user_is_staff_of_team(p_team_id)
    );
$$;

-- ── 1.2 user_can_record_attendance (asistencia) ─────────────────────────────
-- Base viva: F1B 20260823. Ramas: (A) admin/director/coord → acotada;
-- (B) principal; (C) staff con can_mark_attendance.
create or replace function public.user_can_record_attendance(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin o director del club del evento (club-wide, igual que hoy)
    public.user_role_in_club(e.club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO del equipo del evento (C-1a)
    or (
      e.team_id is not null
      and public.user_coordinates_team(e.team_id)
    )
    -- (B) entrenador PRINCIPAL del equipo del evento (rol a nivel EQUIPO)
    or (
      e.team_id is not null
      and public.user_is_principal_of_team(e.team_id)
    )
    -- (C) cualquier staff del equipo con la capability can_mark_attendance
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_mark_attendance')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

-- ── 1.3 user_can_manage_callup (convocatorias + promociones) ─────────────────
-- Base viva: F1B 20260823. Ramas: (A) admin/director/coord → acotada;
-- (B) principal (team_staff); (C) staff con can_manage_callups.
create or replace function public.user_can_manage_callup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin o director del club: siempre (club-wide, igual que hoy)
    public.user_role_in_club(e.club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO del equipo del evento (C-1a)
    or (
      e.team_id is not null
      and public.user_coordinates_team(e.team_id)
    )
    -- (B) principal del TEAM (autoridad: team_staff.staff_role)
    or (
      e.team_id is not null
      and exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = e.team_id
          and ts.staff_role = 'entrenador_principal'
          and ts.left_at is null
          and m.profile_id = auth.uid()
          and m.club_id = e.club_id
      )
    )
    -- (C) staff activo del team con capability can_manage_callups (ayudantes)
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_manage_callups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

-- ── 1.4 user_can_manage_lineup (alineaciones) ───────────────────────────────
-- Base viva: F1B 20260823. Ramas: (A) admin/director/coord → acotada;
-- (B) principal (team_staff); (C) staff con can_create_lineups.
create or replace function public.user_can_manage_lineup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin o director del club: siempre (club-wide, igual que hoy)
    public.user_role_in_club(e.club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO del equipo del evento (C-1a)
    or (
      e.team_id is not null
      and public.user_coordinates_team(e.team_id)
    )
    -- (B) principal del TEAM (autoridad: team_staff.staff_role)
    or (
      e.team_id is not null
      and exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = e.team_id
          and ts.staff_role = 'entrenador_principal'
          and ts.left_at is null
          and m.profile_id = auth.uid()
          and m.club_id = e.club_id
      )
    )
    -- (C) staff activo del team con capability can_create_lineups (ayudantes)
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_create_lineups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

-- ── 1.5 user_can_record_match (directo/stats/eventos + EVALUACIONES) ─────────
-- Base viva: F1B 20260823. Ramas: (A) admin/director/coord → acotada;
-- (B) cualquier staff del team (user_is_staff_of_team, sin capability).
-- Decisión 1=A (Jose): este helper también gobierna evaluations/team_evaluations/
-- evaluation_private_notes → quedan acotadas al equipo aquí (C-1b ya no las toca).
create or replace function public.user_can_record_match(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin o director del club (club-wide, igual que hoy)
    public.user_role_in_club(e.club_id) in ('admin_club', 'director')
    -- (A') coordinador SOLO del equipo del evento (C-1a)
    or (e.team_id is not null and public.user_coordinates_team(e.team_id))
    -- (B) cualquier staff del team (incluye principal/ayudante) — sin cambios
    or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
    from public.events e
   where e.id = p_event_id;
$$;

-- ── 2. POLICY events_select (lectura de eventos) ─────────────────────────────
-- Base viva: pg_policies (PERMISSIVE, authenticated, SELECT). Rama (1)
-- admin/coord/director club-wide → acotada; se conservan las 6 restantes
-- (club-level, staff_of_team, member_account, spectator_team, match-type
-- club-wide para cualquier miembro, spectator_club). Nota: la rama match-type
-- club-wide sigue dejando al coordinador ver TODOS los partidos del club (como
-- cualquier miembro); la acotación afecta a los eventos NO-partido de equipos
-- que no coordina.
drop policy if exists events_select on public.events;
create policy events_select
  on public.events
  for select
  to authenticated
  using (
    -- admin o director del club (club-wide, igual que hoy)
    public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    -- coordinador SOLO de ESE equipo (C-1a)
    or (team_id is not null and public.user_coordinates_team(team_id))
    -- evento club-level (sin equipo): cualquier miembro del club
    or (team_id is null and public.user_role_in_club(club_id) is not null)
    -- staff del equipo del evento
    or (team_id is not null and public.user_is_staff_of_team(team_id))
    -- jugador/familia (cuenta) del equipo del evento
    or (team_id is not null and public.user_is_team_member_account(team_id))
    -- espectador del equipo del evento
    or (team_id is not null and public.is_spectator_of_team(team_id))
    -- eventos de tipo partido: cualquier miembro del club
    or (
      type = any (array['match', 'friendly', 'tournament'])
      and public.user_role_in_club(club_id) is not null
    )
    -- eventos de tipo partido: espectador del club
    or (
      type = any (array['match', 'friendly', 'tournament'])
      and public.is_spectator_of_club(club_id)
    )
  );
