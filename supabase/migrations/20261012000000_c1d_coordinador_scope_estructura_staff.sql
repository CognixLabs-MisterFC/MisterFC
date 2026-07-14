-- ═════════════════════════════════════════════════════════════════════════════
-- C-1d — ACOTAR EL COORDINADOR: ESTRUCTURA + STAFF (team_staff) + INVITACIONES.
-- Último PR de la serie C-1. Tras él NO queda ningún literal 'coordinador'
-- club-wide sin justificar (banco / lectura de contexto club_settings).
--
-- Regla (Jose): coordinador = solo sus equipos (user_coordinates_team, C-0).
-- admin/director club-wide (NO se tocan). superadmin/principal/ayudante sin
-- cambios. El coordinador NO toca la estructura del club (categorías/equipos/
-- permisos/roles) → se le QUITA (no se acota). Sí gestiona STAFF de SUS equipos
-- (roles principal/ayudante/preparador_fisico/delegado; NUNCA coordinador).
--
-- Decisiones Jose (lecturas de gobernanza): club_settings_select DEJA coord
-- (lectura de contexto, no se toca aquí); audit_log_select QUITA coord;
-- capabilities_select QUITA coord de la rama club-wide (conserva own + principal).
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- A) ESTRUCTURA — QUITAR coord (el coordinador no toca estructura). Lectura de
--    categorías/equipos intacta (categories_select_member / teams_select_member,
--    sin literal coord). club_settings_select NO se toca (decisión Jose).
-- ─────────────────────────────────────────────────────────────────────────────

-- A.1 categories_write_admin_coord [ALL] (base viva f1b1 20260823)
drop policy if exists categories_write_admin_coord on public.categories;
create policy categories_write_admin_coord
  on public.categories
  for all
  to authenticated
  using (public.user_role_in_club(club_id) = any (array['admin_club', 'director']))
  with check (public.user_role_in_club(club_id) = any (array['admin_club', 'director']));

-- A.2 teams_write_admin_coord [ALL] (base viva f1b1 20260823)
drop policy if exists teams_write_admin_coord on public.teams;
create policy teams_write_admin_coord
  on public.teams
  for all
  to authenticated
  using (
    exists (
      select 1 from public.categories c
      where c.id = teams.category_id
        and public.user_role_in_club(c.club_id) = any (array['admin_club', 'director'])
    )
  )
  with check (
    exists (
      select 1 from public.categories c
      where c.id = teams.category_id
        and public.user_role_in_club(c.club_id) = any (array['admin_club', 'director'])
    )
  );

-- A.3 capabilities_insert_managers [INSERT] (base viva 20260620000001).
-- Antes: admin_club/coordinador/entrenador_principal. Quitar coord (director no
-- estaba: no se añade).
drop policy if exists capabilities_insert_managers on public.capabilities;
create policy capabilities_insert_managers
  on public.capabilities
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = capabilities.membership_id
        and public.user_role_in_club(m.club_id) = any (array['admin_club', 'entrenador_principal'])
    )
  );

-- A.4 capabilities_update [UPDATE] (base viva 20260807). Antes: (admin_club,
-- coordinador) OR principal_of_assistant. Quitar coord.
drop policy if exists capabilities_update on public.capabilities;
create policy capabilities_update
  on public.capabilities
  for update
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = capabilities.membership_id
        and (
          public.user_role_in_club(m.club_id) = 'admin_club'
          or public.user_is_principal_of_assistant_team(m.id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.memberships m
      where m.id = capabilities.membership_id
        and (
          public.user_role_in_club(m.club_id) = 'admin_club'
          or public.user_is_principal_of_assistant_team(m.id)
        )
    )
  );

-- A.5 capabilities_select [SELECT] (base viva 20260807). Quitar coord de la rama
-- club-wide; conservar own (profile_id=auth.uid()) y principal_of_assistant.
drop policy if exists capabilities_select on public.capabilities;
create policy capabilities_select
  on public.capabilities
  for select
  to authenticated
  using (
    exists (
      select 1 from public.memberships m
      where m.id = capabilities.membership_id
        and (
          m.profile_id = auth.uid()
          or public.user_role_in_club(m.club_id) = any (array['admin_club', 'entrenador_principal'])
          or public.user_is_principal_of_assistant_team(m.id)
        )
    )
  );

-- A.6 memberships_insert_bootstrap_or_admin [INSERT] (base viva 20260826). Solo la
-- rama ELSE pierde coord; bootstrap y self-accept-invite intactas; high→owner intacta.
drop policy if exists memberships_insert_bootstrap_or_admin on public.memberships;
create policy memberships_insert_bootstrap_or_admin
  on public.memberships
  for insert
  to authenticated
  with check (
    (
      profile_id = auth.uid()
      and role = 'admin_club'
      and not exists (select 1 from public.memberships m where m.profile_id = auth.uid())
    )
    or (
      profile_id = auth.uid()
      and exists (
        select 1 from public.invitations i
        where i.email ilike public.current_user_email()
          and i.club_id = memberships.club_id
          and i.role = memberships.role
          and i.accepted_at is null
          and i.expires_at > now()
      )
    )
    or case
         when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
         else (public.user_role_in_club(club_id) = any (array['admin_club', 'director']))
       end
  );

-- A.7 memberships_update_admin [UPDATE] (base viva 20260824). Rama ELSE pierde coord.
drop policy if exists memberships_update_admin on public.memberships;
create policy memberships_update_admin
  on public.memberships
  for update
  to authenticated
  using (
    not public.profile_is_club_owner(club_id, profile_id)
    and case
          when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
          else (public.user_role_in_club(club_id) = any (array['admin_club', 'director']))
        end
  )
  with check (
    not public.profile_is_club_owner(club_id, profile_id)
    and case
          when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
          else (public.user_role_in_club(club_id) = any (array['admin_club', 'director']))
        end
  );

-- A.8 audit_log_select_managers [SELECT] (base viva messaging 20260605). Quitar coord.
drop policy if exists audit_log_select_managers on public.audit_log;
create policy audit_log_select_managers
  on public.audit_log
  for select
  to authenticated
  using (public.user_role_in_club(club_id) = 'admin_club');

-- ─────────────────────────────────────────────────────────────────────────────
-- B) INVITACIONES — acotar coord a staff de SUS equipos, roles principal/ayudante/
--    preparador_fisico/delegado (NUNCA coordinador), nunca director/admin (high→owner).
-- ─────────────────────────────────────────────────────────────────────────────

-- B.1 invitations_insert_admin [INSERT] (base viva f14c_2 20261001).
drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin
  on public.invitations
  for insert
  to authenticated
  with check (
    role <> 'spectator'
    and case
          when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
          else (
            public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
            or (
              public.user_role_in_club(club_id) = 'coordinador'
              and team_id is not null
              and public.user_coordinates_team(team_id)
              and team_staff_role = any (array['entrenador_principal', 'entrenador_ayudante', 'preparador_fisico', 'delegado'])
            )
          )
        end
  );

-- B.2 invitations_delete_managers [DELETE] (base viva 20260604). Quitar coord de la
-- lista, añadir rama team_id/user_coordinates_team. created_by/principal_of_team intactos.
drop policy if exists invitations_delete_managers on public.invitations;
create policy invitations_delete_managers
  on public.invitations
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
    or (team_id is not null and public.user_coordinates_team(team_id))
    or (
      team_id is not null
      and exists (
        select 1 from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = invitations.team_id
          and ts.left_at is null
          and ts.staff_role = 'entrenador_principal'
          and m.profile_id = auth.uid()
      )
    )
  );

-- B.3 invitations_select_admin_or_invited [SELECT] (base viva 20260620). Quitar coord
-- + rama team_id/user_coordinates_team. email/created_by/principal_of_team intactos.
drop policy if exists invitations_select_admin_or_invited on public.invitations;
create policy invitations_select_admin_or_invited
  on public.invitations
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = 'admin_club'
    or (team_id is not null and public.user_coordinates_team(team_id))
    or email ilike public.current_user_email()
    or created_by = auth.uid()
    or (team_id is not null and public.user_is_principal_of_team(team_id))
  );

-- B.4 invitations_update_invited_or_admin [UPDATE] (base viva 20260527). Quitar coord
-- + rama team_id/user_coordinates_team. email intacto.
drop policy if exists invitations_update_invited_or_admin on public.invitations;
create policy invitations_update_invited_or_admin
  on public.invitations
  for update
  to authenticated
  using (
    public.user_role_in_club(club_id) = 'admin_club'
    or (team_id is not null and public.user_coordinates_team(team_id))
    or email ilike public.current_user_email()
  )
  with check (
    public.user_role_in_club(club_id) = 'admin_club'
    or (team_id is not null and public.user_coordinates_team(team_id))
    or email ilike public.current_user_email()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- C) TEAM_STAFF — cierre del hueco central. Antes (las 3): user_role_in_club(...)
--    in ('admin_club','director','coordinador') SIN acotar por equipo ni rol.
--    Después: admin/director club-wide (igual); coordinador solo equipos que
--    coordina y roles ≠ coordinador. Cierra addStaffAssignment (C-0) a nivel datos.
-- ─────────────────────────────────────────────────────────────────────────────

-- C.1 team_staff_insert_admin [INSERT] (base viva f1b1 20260823)
drop policy if exists team_staff_insert_admin on public.team_staff;
create policy team_staff_insert_admin
  on public.team_staff
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_staff.team_id
        and public.user_role_in_club(c.club_id) = any (array['admin_club', 'director'])
    )
    or (
      public.user_coordinates_team(team_staff.team_id)
      and team_staff.staff_role = any (array['entrenador_principal', 'entrenador_ayudante', 'preparador_fisico', 'delegado'])
    )
  );

-- C.2 team_staff_update_admin [UPDATE] (base viva f1b1 20260823)
drop policy if exists team_staff_update_admin on public.team_staff;
create policy team_staff_update_admin
  on public.team_staff
  for update
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_staff.team_id
        and public.user_role_in_club(c.club_id) = any (array['admin_club', 'director'])
    )
    or (
      public.user_coordinates_team(team_staff.team_id)
      and team_staff.staff_role = any (array['entrenador_principal', 'entrenador_ayudante', 'preparador_fisico', 'delegado'])
    )
  )
  with check (
    exists (
      select 1 from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_staff.team_id
        and public.user_role_in_club(c.club_id) = any (array['admin_club', 'director'])
    )
    or (
      public.user_coordinates_team(team_staff.team_id)
      and team_staff.staff_role = any (array['entrenador_principal', 'entrenador_ayudante', 'preparador_fisico', 'delegado'])
    )
  );

-- C.3 team_staff_delete_admin [DELETE] (base viva f1b1 20260823)
drop policy if exists team_staff_delete_admin on public.team_staff;
create policy team_staff_delete_admin
  on public.team_staff
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_staff.team_id
        and public.user_role_in_club(c.club_id) = any (array['admin_club', 'director'])
    )
    or (
      public.user_coordinates_team(team_staff.team_id)
      and team_staff.staff_role = any (array['entrenador_principal', 'entrenador_ayudante', 'preparador_fisico', 'delegado'])
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- D) STRAYS — cerrar cero-coordinador-club-wide. user_is_staff_of_team ya cubre
--    los equipos del coordinador.
-- ─────────────────────────────────────────────────────────────────────────────

-- D.1 player_promotions_select [SELECT] (base viva f1b1 20260823). Quitar coord.
drop policy if exists player_promotions_select on public.player_promotions;
create policy player_promotions_select
  on public.player_promotions
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    or public.user_is_staff_of_team(team_id)
    or public.user_owns_player_account(player_id)
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = player_promotions.player_id
        and tm.left_at is null
        and public.user_is_staff_of_team(tm.team_id)
    )
  );

-- D.2 team_plays_select [SELECT] (base viva plays_club_bank 20260809). Quitar coord.
drop policy if exists team_plays_select on public.team_plays;
create policy team_plays_select
  on public.team_plays
  for select
  to authenticated
  using (
    public.user_is_staff_of_team(team_id)
    or public.user_role_in_club(club_id) = 'admin_club'
    or (shared_with_family and public.user_is_team_member_account(team_id))
  );
