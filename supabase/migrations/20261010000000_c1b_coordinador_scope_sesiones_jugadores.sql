-- ═════════════════════════════════════════════════════════════════════════════
-- C-1b — ACOTAR EL COORDINADOR A SUS EQUIPOS: dominio SESIONES / JUGADORES /
-- TEAM_MEMBERS / INFORMES / NOTAS / OBJETIVOS.
--
-- Serie C: el coordinador accede/gestiona SOLO los equipos que le asigna el
-- director (team_staff.staff_role='coordinador', helper user_coordinates_team de
-- C-0). admin_club/director = club-wide (NO se tocan). entrenador_principal/
-- ayudante = sin cambios. superadmin = sin cambios. El BANCO del club (plantillas
-- is_template, jugadas, ejercicios, formaciones) es PARA TODOS: no se acota.
-- Evaluaciones ya acotadas en C-1a: NO se tocan aquí.
--
-- Nota clave: user_is_team_staff(team) / user_is_staff_of_team(team) = "existe
-- fila team_staff (cualquier staff_role) activa para auth.uid()" → el coordinador
-- de C-0 YA queda cubierto para sus equipos por esas ramas. Donde existen, acotar
-- = solo quitar 'coordinador' de la lista club-wide.
-- ═════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INFORMES / NOTAS / OBJETIVOS (cambio LIMPIO: quitar 'coordinador' de la
--    lista club-wide; la rama user_is_team_staff / team_staff ya cubre su-equipo)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 user_can_create_development_reports (base viva F1B 20260823).
-- Ramas: (A) admin/director/coord club-wide → coord fuera; (B) user_is_team_staff.
create or replace function public.user_can_create_development_reports(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.teams t
    join public.categories c on c.id = t.category_id
    where t.id = p_team_id
      and public.user_role_in_club(c.club_id) in ('admin_club', 'director')
  )
  or public.user_is_team_staff(p_team_id);
$$;

-- 1.2 user_can_access_player_notes (base viva F1B 20260823).
-- Ramas: (A) admin/director/coord club-wide → coord fuera; (B) staff (team_staff,
-- sin filtro de rol) de un equipo del jugador → cubre al coordinador de ese equipo.
create or replace function public.user_can_access_player_notes(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.players p
    where p.id = p_player_id
      and (
        public.user_role_in_club(p.club_id) in ('admin_club', 'director')
        or exists (
          select 1
          from public.team_members tm
          join public.team_staff ts
            on ts.team_id = tm.team_id and ts.left_at is null
          join public.memberships m on m.id = ts.membership_id
          where tm.player_id = p_player_id
            and tm.left_at is null
            and m.profile_id = auth.uid()
        )
      )
  );
$$;

-- 1.3 Reads de informes/objetivos: quitar 'coordinador' de la lista club-wide.
-- En los 4, la rama user_is_team_staff(team_id) conserva su-equipo al coordinador.
-- El resto de ramas (account/published/shared) se conservan intactas.

-- development_reports_select (base viva f14e_2 20261005). Mantiene 'director'.
drop policy if exists development_reports_select on public.development_reports;
create policy development_reports_select
  on public.development_reports
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_account_of_player(player_id))
  );

-- team_development_reports_select (base viva dev_reports_rework 20260728).
-- La lista club-wide NO incluye 'director' (pre-existente); solo quito 'coordinador'.
drop policy if exists team_development_reports_select on public.team_development_reports;
create policy team_development_reports_select
  on public.team_development_reports
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (array['admin_club'])
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_team_member_account(team_id))
    or public.user_can_see_team_report_via_published(id)
  );

-- player_objectives_select (base viva development_reports 20260727).
-- Lista club-wide sin 'director' (pre-existente); solo quito 'coordinador'.
drop policy if exists player_objectives_select on public.player_objectives;
create policy player_objectives_select
  on public.player_objectives
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (array['admin_club'])
    or public.user_is_team_staff(team_id)
    or (
      public.user_is_account_of_player(player_id)
      and public.development_report_shared_for_player(player_id, season_id)
    )
  );

-- team_objectives_select (base viva development_reports 20260727).
-- Lista club-wide sin 'director' (pre-existente); solo quito 'coordinador'.
drop policy if exists team_objectives_select on public.team_objectives;
create policy team_objectives_select
  on public.team_objectives
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (array['admin_club'])
    or public.user_is_team_staff(team_id)
    or (
      public.user_is_team_member_account(team_id)
      and public.development_report_shared_for_team(team_id, season_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. SESIONES (enfoque B: localizado en policies; NO se cambia la firma de
--    user_can_create_sessions). Banco (is_template) intacto para todos.
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1 sessions_select (base viva f14e_2 20261005).
-- Antes: role in (admin/coord/director/principal/ayudante)  OR  (player: not
--   template + visibility=team + member_account).
-- Después: se saca 'coordinador' de la lista blanket (admin/director/principal/
--   ayudante intactos) y se le da rama propia: plantillas-banco (is_template, sigue
--   siendo solo-staff porque va guardada por rol coordinador) O sus sesiones de
--   equipo (user_coordinates_team). Rama jugador intacta.
drop policy if exists sessions_select on public.sessions;
create policy sessions_select
  on public.sessions
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
    )
    or (
      public.user_role_in_club(club_id) = 'coordinador'
      and (is_template or public.user_coordinates_team(team_id))
    )
    or (
      not is_template
      and visibility = 'team'
      and public.user_is_team_member_account(team_id)
    )
  );

-- 2.2 sessions_insert (base viva F1B 20260823).
-- Antes: owner=auth.uid() AND user_can_create_sessions(club_id).
-- Después: además, si el creador es COORDINADOR (rol de club), la sesión de equipo
--   solo si is_template O user_coordinates_team(team_id). Cualquier otro rol
--   (admin/director/principal/ayudante/capability) queda IGUAL que hoy (la rama
--   `is distinct from 'coordinador'` los deja pasar; NULL-role capability incluido).
drop policy if exists sessions_insert on public.sessions;
create policy sessions_insert
  on public.sessions
  for insert
  to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_can_create_sessions(club_id)
    and (
      public.user_role_in_club(club_id) is distinct from 'coordinador'
      or is_template
      or public.user_coordinates_team(team_id)
    )
  );

-- 2.3 sessions_update / sessions_delete: NO se tocan. Ya son team-scoped para el
--   coordinador vía el 2º conjunto `... OR user_is_staff_of_team(team_id)` (owner /
--   admin-director / staff-de-equipo). Un coordinador solo edita/borra sesiones que
--   posee o de equipos donde es team_staff (= sus equipos). Verificado en psql.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. JUGADORES (players_write_staff [ALL] → split: INSERT abierto, UPDATE/DELETE
--    acotados al coordinador a jugadores de sus equipos).
-- ─────────────────────────────────────────────────────────────────────────────
-- Base viva F1B 20260823 (USING=CHECK, lista admin/director/coord/principal OR
-- can_manage_squad). LECTURA de players sigue por players_select_member (cualquier
-- miembro del club) — NO se toca.
drop policy if exists players_write_staff on public.players;

-- 3.1 INSERT: crear/invitar jugador — el coordinador CONSERVA (club-wide como hoy;
--   el flujo de invitar obliga a elegir equipo destino). Lista idéntica a la vieja.
create policy players_insert_staff
  on public.players
  for insert
  to authenticated
  with check (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'coordinador', 'entrenador_principal']
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
  );

-- 3.2 UPDATE: admin/director/principal y capability = club-wide (sin cambios); el
--   coordinador solo jugadores de equipos que coordina.
create policy players_update_staff
  on public.players
  for update
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal']
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = players.id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  )
  with check (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal']
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = players.id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  );

-- 3.3 DELETE: mismo criterio que UPDATE (USING).
create policy players_delete_staff
  on public.players
  for delete
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (
      array['admin_club', 'director', 'entrenador_principal']
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = players.id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. TEAM_MEMBERS (el gate real de pertenencia): el coordinador solo puebla/gestiona
--    sus equipos. La fila tiene team_id → user_coordinates_team(team_id).
-- ─────────────────────────────────────────────────────────────────────────────
-- Base viva F1B 20260823 (USING=CHECK). Antes: (player.club role in admin/director/
-- coord/principal) OR (player.club can_manage_squad). Después: se saca 'coordinador'
-- de la lista y se añade rama user_coordinates_team(team_members.team_id).
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
          array['admin_club', 'director', 'entrenador_principal']
        )
    )
    or exists (
      select 1 from public.players p
      where p.id = team_members.player_id
        and public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
    )
    or public.user_coordinates_team(team_members.team_id)
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = team_members.player_id
        and public.user_role_in_club(p.club_id) = any (
          array['admin_club', 'director', 'entrenador_principal']
        )
    )
    or exists (
      select 1 from public.players p
      where p.id = team_members.player_id
        and public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
    )
    or public.user_coordinates_team(team_members.team_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. PLAYER_ACCOUNTS (tutores): el coordinador acotado vía team_members del jugador.
-- ─────────────────────────────────────────────────────────────────────────────

-- 5.1 select_self_or_staff (base viva F1B 20260823). self intacto; lista de staff
--   pierde 'coordinador' y gana rama team_members→user_coordinates_team.
drop policy if exists player_accounts_select_self_or_staff on public.player_accounts;
create policy player_accounts_select_self_or_staff
  on public.player_accounts
  for select
  to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.players p
      where p.id = player_accounts.player_id
        and public.user_role_in_club(p.club_id) = any (
          array['admin_club', 'director', 'entrenador_principal', 'entrenador_ayudante']
        )
    )
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = player_accounts.player_id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  );

-- 5.2 write_admin (base viva F1B 20260823). admin/director intactos; coord acotado.
drop policy if exists player_accounts_write_admin on public.player_accounts;
create policy player_accounts_write_admin
  on public.player_accounts
  for all
  to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_accounts.player_id
        and public.user_role_in_club(p.club_id) = any (array['admin_club', 'director'])
    )
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = player_accounts.player_id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_accounts.player_id
        and public.user_role_in_club(p.club_id) = any (array['admin_club', 'director'])
    )
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = player_accounts.player_id
        and tm.left_at is null
        and public.user_coordinates_team(tm.team_id)
    )
  );
