-- F14.10 — Cierra events SELECT a aislamiento real por equipo.
--
-- Antes: events_select_member dejaba ver TODOS los eventos del club a cualquier
-- miembro (user_role_in_club is not null). El aislamiento por equipo era solo UX
-- (un jugador del equipo A podía listar por API los eventos del equipo B).
--
-- Ahora (decisiones cerradas):
--  * admin/coord del club → todo el club.
--  * eventos a nivel club (team_id IS NULL) → cualquier miembro del club
--    (avisos generales, vacaciones, reuniones).
--  * eventos de equipo → staff del equipo (user_is_staff_of_team).
--  * eventos de equipo → familia/jugador cuyo jugador es miembro ACTIVO del
--    equipo (user_is_team_member_account). Esto preserva los conteos de la ficha
--    de desarrollo (ratios H-4: total partidos/entrenos del equipo del hijo) sin
--    necesidad de un RPC de conteo: la familia sigue pudiendo SELECT/contar los
--    eventos del equipo de su hijo.
--
-- Borde conocido (registrado en known-issues.md): se usa "miembro ACTIVO"
-- (team_members.left_at IS NULL). Un jugador que causó baja deja de ver los
-- eventos de ese equipo, y su familia deja de poder contar denominadores de una
-- temporada pasada. Si en el futuro la familia debe ver ratios de temporadas
-- cerradas, relajar a "miembro en esa temporada".
--
-- Append-only: drop + create de la policy de SELECT. Reusa helpers existentes
-- (user_is_staff_of_team, user_is_team_member_account). No toca INSERT/UPDATE/
-- DELETE (user_can_manage_event) ni datos.

drop policy if exists events_select_member on public.events;

create policy events_select on public.events
  for select to authenticated
  using (
    -- admin/coord del club → todo el club
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    -- eventos a nivel club (sin equipo) → cualquier miembro del club
    or (team_id is null and public.user_role_in_club(club_id) is not null)
    -- eventos de equipo → staff activo del equipo
    or (team_id is not null and public.user_is_staff_of_team(team_id))
    -- eventos de equipo → familia/jugador con jugador miembro activo del equipo
    or (team_id is not null and public.user_is_team_member_account(team_id))
  );
