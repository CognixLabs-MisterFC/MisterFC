-- JR-2 fix / ADR-0019 — la familia/jugador puede VER una jugada PUBLICADA que se ha
-- compartido con su equipo (team_plays.shared_with_family=true).
--
-- BUG: plays_select (JR-0) solo dejaba ver las publicadas a roles de STAFF. El rol
-- 'jugador' NO podía leer la jugada ni directa ni por join, así que el visor de
-- familia /mi-equipo/jugadas/[id] devolvía 404 (loadTeamPlay → null) y la card del
-- playbook salía vacía. La familia SÍ veía la fila team_plays pero no la jugada
-- subyacente.
--
-- FIX: añadir a la rama 'published' la visibilidad por equipo vía team_plays +
-- user_is_team_member_account (modelo equivalente al antiguo plays.visibility='team').
-- El resto de la política (draft/proposed/rejected) no cambia. Migración nueva (la
-- de JR-0 es inmutable): se recrea la policy.

drop policy if exists plays_select on public.plays;

create policy plays_select on public.plays
  for select to authenticated
  using (
    case
      when status = 'draft' then
        owner_profile_id = auth.uid()
      when status in ('proposed', 'rejected') then
        owner_profile_id = auth.uid()
        or public.user_can_approve_plays(club_id)
      else  -- published (incl. archivadas)
        public.user_role_in_club(club_id) in
          ('admin_club', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
        or exists (
          select 1
          from public.team_plays tp
          where tp.play_id = plays.id
            and tp.shared_with_family = true
            and public.user_is_team_member_account(tp.team_id)
        )
    end
  );
