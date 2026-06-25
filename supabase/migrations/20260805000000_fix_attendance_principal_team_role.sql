-- Fix bug de asistencia: el principal de un EQUIPO no podía registrar
-- asistencia si su rol de CLUB (memberships.role) no era 'entrenador_principal'.
--
-- Causa raíz: la rama "principal" de user_can_record_attendance decidía el
-- permiso con user_role_in_club() (rol a nivel CLUB), ignorando el rol a nivel
-- EQUIPO (team_staff.staff_role). Un entrenador principal de equipo cuyo rol de
-- club es 'entrenador_ayudante' (caso real coach7 / Infantil B) quedaba fuera de
-- las tres ramas (no admin/coord, no principal-de-club, y can_mark_attendance en
-- false por defecto) → la RLS rechazaba el INSERT/UPDATE (42501).
--
-- Fix: la rama "principal" pasa a usar user_is_principal_of_team(e.team_id), que
-- comprueba team_staff con staff_role = 'entrenador_principal' y vínculo activo
-- (left_at null) para el equipo del EVENTO. Es el mismo helper que ya usa el
-- resto de RLS de equipo (introducido en 20260620000000). Se mantienen las vías
-- (A) admin/coord del club y (C) capability can_mark_attendance + staff del team.
--
-- Solo redefine la función (CREATE OR REPLACE). No toca tablas, datos ni la firma
-- → no requiere regenerar tipos. Append-only.

create or replace function public.user_can_record_attendance(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin o coordinador del club del evento
    public.user_role_in_club(e.club_id) in ('admin_club', 'coordinador')
    -- (B) entrenador PRINCIPAL del equipo del evento (rol a nivel EQUIPO,
    --     team_staff activo) — independiente del rol de club
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

comment on function public.user_can_record_attendance(uuid) is
  'F4.1 (fix 2026-06-25) — TRUE si el user actual puede registrar asistencia del evento. Vías: admin/coord del club, principal del EQUIPO (team_staff.staff_role, vía user_is_principal_of_team), o staff del equipo con capability can_mark_attendance. La rama principal mira el rol de EQUIPO, no memberships.role.';

-- Ejecutable por authenticated para poder gatear la UI por RPC (mismo patrón que
-- user_can_see_player_medical). Las policies ya lo usaban vía EXECUTE de PUBLIC.
grant execute on function public.user_can_record_attendance(uuid) to authenticated;
