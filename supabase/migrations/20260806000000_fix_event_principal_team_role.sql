-- Fix bug de calendario: el principal de un EQUIPO no podía crear/editar/borrar
-- eventos de su equipo si su rol de CLUB (memberships.role) no era
-- 'entrenador_principal'. Gemelo del fix de asistencia (20260805000000).
--
-- Causa raíz: la rama "principal" de user_can_manage_event decidía el permiso con
-- user_role_in_club() (rol a nivel CLUB), ignorando el rol a nivel EQUIPO
-- (team_staff.staff_role). Un entrenador principal de equipo cuyo rol de club es
-- 'entrenador_ayudante' (caso coach7 / Infantil B) quedaba fuera de la rama (B) y
-- dependía de tener la capability can_manage_calendar para gestionar su propio
-- calendario.
--
-- Fix: la rama "principal" pasa a usar user_is_principal_of_team(p_team_id), que
-- comprueba team_staff con staff_role = 'entrenador_principal' y vínculo activo
-- (left_at null). Mismo helper que ya usa el resto de RLS de equipo. Se mantienen
-- (A) admin/coord del club y (C) capability can_manage_calendar + staff del team.
--
-- Solo redefine la función (CREATE OR REPLACE). No toca tablas, datos ni la firma
-- → no requiere regenerar tipos. Append-only.

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
    -- (A) admin o coordinador del club
    public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador')
    -- (B) entrenador PRINCIPAL del equipo del evento (rol a nivel EQUIPO,
    --     team_staff activo) — independiente del rol de club
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

comment on function public.user_can_manage_event(uuid, uuid) is
  'F3 (fix 2026-06-25) — TRUE si el user actual puede gestionar eventos del club/equipo. Vías: admin/coord del club, principal del EQUIPO (team_staff.staff_role, vía user_is_principal_of_team), o staff del equipo con capability can_manage_calendar. La rama principal mira el rol de EQUIPO, no memberships.role.';

-- Ejecutable por authenticated para poder gatear la UI por RPC (mismo patrón que
-- user_can_record_attendance / user_can_see_player_medical). Las policies ya lo
-- usaban vía EXECUTE de PUBLIC.
grant execute on function public.user_can_manage_event(uuid, uuid) to authenticated;
