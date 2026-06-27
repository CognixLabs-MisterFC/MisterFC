-- FIX (coherencia con 20260811000000) — alinear `sessions_delete` con la MISMA
-- regla que `user_can_edit_session` / `sessions_update`: el STAFF del equipo de la
-- sesión (principal/ayudante activo) puede BORRAR la sesión de su equipo, además del
-- owner y el admin del club.
--
-- Antes: sessions_delete = owner ∪ admin_club → un principal del equipo podía editar
-- la sesión y sus hijas (fix Opción A) pero NO borrarla. Incoherente. Para PLANTILLAS
-- (team_id NULL) `user_is_staff_of_team` es false → siguen owner ∪ admin.

drop policy if exists sessions_delete on public.sessions;

create policy sessions_delete on public.sessions
  for delete to authenticated
  using (
    public.user_can_create_sessions(club_id)
    and (
      owner_profile_id = auth.uid()
      or public.user_role_in_club(club_id) = 'admin_club'
      or public.user_is_staff_of_team(team_id)
    )
  );
