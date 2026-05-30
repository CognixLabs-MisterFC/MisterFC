-- F5 Lote A hotfix follow-up — SELECT policy del autor.
--
-- En PG, INSERT ... RETURNING (o cualquier .select() en supabase-js) requiere
-- que la fila también pase la SELECT policy. La nueva SELECT policy de F5
-- Lote A se quedó sin la rama "author_profile_id = auth.uid()", entonces un
-- ayudante club que era principal-by-team_staff y publicaba en un team al
-- que NO pertenece como player ni staff_of_team (caso muy raro pero
-- posible) no podía ver el row recién creado → INSERT fallaba con
-- "row-level security policy".
--
-- Más relevante: cualquier autor (incluso admin/coord) puede ahora leer
-- lo que ha creado, lo cual es trivialmente correcto.

drop policy if exists announcements_select_club_member on public.announcements;

create policy announcements_select_club_member on public.announcements
  for select to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or (team_id is null and public.user_role_in_club(club_id) is not null)
    or (
      team_id is not null
      and (
        public.user_is_staff_of_team(team_id)
        or exists (
          select 1
            from public.team_members tm
            join public.player_accounts pa on pa.player_id = tm.player_id
           where tm.team_id = announcements.team_id
             and tm.left_at is null
             and pa.profile_id = auth.uid()
        )
      )
    )
  );

comment on policy announcements_select_club_member on public.announcements is
  'F5 Lote A — autor siempre ve sus anuncios. Admin/coord del club ve todos. Club-wide visible a todo el club. Team-bound visible a staff del team + jugadores/familia con team_members activo.';
