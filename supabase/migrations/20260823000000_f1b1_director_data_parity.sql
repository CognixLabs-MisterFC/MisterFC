-- F1B-1 — Paridad de DATOS del rol "director" con "admin_club".
--
-- PRINCIPIO: director = admin_club en TODO el acceso a DATOS (escritura/gestión).
-- Barrido COMPREHENSIVO: se recrea cada gate de datos cambiando SOLO el predicado
-- de rol para INCLUIR 'director'. NUNCA se ensancha el scope de club (todo sigue
-- filtrando por user_role_in_club(<club_id>)); solo se añade el valor de rol. El
-- aislamiento entre clubs (user_role_in_club) NO se toca.
--
-- EXCLUIDO, INTACTO — Grupo B (gestión de roles/miembros/invitaciones → F1B-2):
--   memberships_insert_bootstrap_or_admin, memberships_update_admin,
--   memberships_delete_admin, invitations_insert_admin, invitations_delete_admin,
--   invitations_update_invited_or_admin, capabilities_update,
--   capabilities_insert_managers, admin_update_staff_role.
-- EXCLUIDO, FUERA DE F1B — visibilidad SELECT transversal de chats y partidos:
--   director ve TODOS los chats = F5B (audit-read de conversaciones intacto);
--   ve TODOS los partidos = F7B (SELECT de match_state/match_events intacto).
--
-- Nota: la mayoría de policies de escritura delegan en funciones helper; al
-- recrear la función, esas policies heredan 'director' sin recrearse. Solo se
-- recrean las policies que llevan el predicado de rol INLINE.

-- ═════════════════════════════════════════════════════════════════════════════
-- 0. HELPER CENTRALIZADO
-- ═════════════════════════════════════════════════════════════════════════════

create or replace function public.user_is_admin_or_director(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role_in_club(p_club_id) in ('admin_club', 'director');
$$;

comment on function public.user_is_admin_or_director(uuid) is
  'True si el user actual es admin_club O director del club indicado (paridad de '
  'datos F1B-1). Filtra por club_id (aislamiento, como user_role_in_club). NO '
  'cubre la gestión de directores/miembros (Grupo B, F1B-2).';

grant execute on function public.user_is_admin_or_director(uuid) to authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. FUNCIONES HELPER DE DATOS (add 'director'). Copia fiel de la versión VIGENTE.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1.1 user_can_manage_event (vigente: 20260806) — calendario.
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
    -- (A) admin, director o coordinador del club
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
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

-- 1.2 user_can_record_attendance (vigente: 20260805) — asistencia.
create or replace function public.user_can_record_attendance(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- (A) admin, director o coordinador del club del evento
    public.user_role_in_club(e.club_id) in ('admin_club', 'director', 'coordinador')
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

-- 1.3 user_can_manage_callup (vigente: 20260603) — convocatorias (+ promociones).
create or replace function public.user_can_manage_callup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- admin/director/coord del club: siempre.
    public.user_role_in_club(e.club_id) in ('admin_club', 'director', 'coordinador')
    -- principal del TEAM (autoridad: team_staff.staff_role, no memberships.role).
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
    -- staff activo del team con capability can_manage_callups (ayudantes).
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_manage_callups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

-- 1.4 user_can_manage_lineup (vigente: 20260607) — alineaciones.
create or replace function public.user_can_manage_lineup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- admin/director/coord del club: siempre.
    public.user_role_in_club(e.club_id) in ('admin_club', 'director', 'coordinador')
    -- principal del TEAM (autoridad: team_staff.staff_role, no memberships.role).
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
    -- staff activo del team con capability can_create_lineups (ayudantes).
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_create_lineups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

-- 1.5 user_can_record_match (vigente: 20260611) — directo/stats/eventos/evals.
create or replace function public.user_can_record_match(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(e.club_id) in ('admin_club', 'director', 'coordinador')
    or (e.team_id is not null and public.user_is_staff_of_team(e.team_id))
    from public.events e
   where e.id = p_event_id;
$$;

-- 1.6 user_can_create_development_reports (vigente: 20260727) — informes.
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
      and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
  )
  or public.user_is_team_staff(p_team_id);
$$;

-- 1.7 user_can_access_player_notes (vigente: 20260621) — notas de jugador.
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
        public.user_role_in_club(p.club_id) in ('admin_club', 'director', 'coordinador')
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

-- 1.8 user_can_approve_plays (vigente: 20260809) — aprobar jugadas del banco.
create or replace function public.user_can_approve_plays(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador');
$$;

-- 1.9 user_can_publish_methodology (vigente: 20260715) — publicar metodología/
--     ejercicios (lo usa el trigger exercises_validate para published/rejected/archived).
create or replace function public.user_can_publish_methodology(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.user_is_admin_or_director(p_club_id);
$$;

-- 1.10 user_can_create_exercises (vigente: 20260715) — crear ejercicios.
create or replace function public.user_can_create_exercises(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_exercises')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    );
$$;

-- 1.11 user_can_create_coach_formations (vigente: 20260610001) — formaciones.
create or replace function public.user_can_create_coach_formations(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- admin/director/coord del club.
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    -- staff del club con la capability (ayudantes con can_create_lineups).
    or public.user_has_capability_in_club(p_club_id, 'can_create_lineups')
    -- principal de ALGÚN team del club (autoridad vía team_staff.staff_role).
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    );
$$;

-- 1.12 user_can_create_sessions (vigente: 20260716) — crear sesiones.
create or replace function public.user_can_create_sessions(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_sessions')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    );
$$;

-- 1.13 user_can_edit_session (vigente: 20260811) — editar sesión y sus hijas.
create or replace function public.user_can_edit_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and public.user_can_create_sessions(s.club_id)
      and (
        s.owner_profile_id = auth.uid()
        or public.user_is_admin_or_director(s.club_id)
        -- Opción A: principal/ayudante del equipo de la sesión (null-safe → las
        -- plantillas, team_id NULL, no entran por aquí: siguen owner ∪ admin).
        or public.user_is_staff_of_team(s.team_id)
      )
  );
$$;

-- 1.14 user_can_see_session (vigente: 20260716) — ver sesión (paridad de lectura
--      para gestionarla; NO es chat/partido).
create or replace function public.user_can_see_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and (
        public.user_role_in_club(s.club_id) in
          ('admin_club', 'director', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
        or (
          not s.is_template
          and s.visibility = 'team'
          and public.user_is_team_member_account(s.team_id)
        )
      )
  );
$$;

-- 1.15 user_can_create_plays (vigente: 20260809) — crear jugadas del banco.
create or replace function public.user_can_create_plays(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.user_role_in_club(p_club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_has_capability_in_club(p_club_id, 'can_create_plays')
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    );
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. POLICIES CON PREDICADO INLINE (drop + recreate; add 'director').
-- ═════════════════════════════════════════════════════════════════════════════

-- ── 2.1 CORE: clubs / categories / teams / players / player_accounts / team_members
drop policy if exists clubs_update_admin on public.clubs;
create policy clubs_update_admin on public.clubs
  for update to authenticated
  using (public.user_is_admin_or_director(id))
  with check (public.user_is_admin_or_director(id));

drop policy if exists categories_write_admin_coord on public.categories;
create policy categories_write_admin_coord on public.categories
  for all to authenticated
  using (public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador'))
  with check (public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador'));

drop policy if exists teams_write_admin_coord on public.teams;
create policy teams_write_admin_coord on public.teams
  for all to authenticated
  using (
    exists (
      select 1
      from public.categories c
      where c.id = category_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
    )
  )
  with check (
    exists (
      select 1
      from public.categories c
      where c.id = category_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
    )
  );

drop policy if exists players_write_staff on public.players;
create policy players_write_staff on public.players
  for all to authenticated
  using (
    public.user_role_in_club(club_id) in (
      'admin_club', 'director', 'coordinador', 'entrenador_principal'
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
  )
  with check (
    public.user_role_in_club(club_id) in (
      'admin_club', 'director', 'coordinador', 'entrenador_principal'
    )
    or public.user_has_capability_in_club(club_id, 'can_manage_squad')
  );

-- player_accounts: SELECT (paridad de lectura para gestionar) + WRITE.
drop policy if exists player_accounts_select_self_or_staff on public.player_accounts;
create policy player_accounts_select_self_or_staff on public.player_accounts
  for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in (
          'admin_club', 'director', 'coordinador', 'entrenador_principal', 'entrenador_ayudante'
        )
    )
  );

drop policy if exists player_accounts_write_admin on public.player_accounts;
create policy player_accounts_write_admin on public.player_accounts
  for all to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in ('admin_club', 'director', 'coordinador')
    )
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in ('admin_club', 'director', 'coordinador')
    )
  );

drop policy if exists team_members_write_staff on public.team_members;
create policy team_members_write_staff on public.team_members
  for all to authenticated
  using (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in (
          'admin_club', 'director', 'coordinador', 'entrenador_principal'
        )
    )
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
    )
  )
  with check (
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) in (
          'admin_club', 'director', 'coordinador', 'entrenador_principal'
        )
    )
    or exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_has_capability_in_club(p.club_id, 'can_manage_squad')
    )
  );

-- ── 2.2 CONFIG DEL CLUB: club_settings (SELECT para leer lo que gestiona + WRITE)
drop policy if exists club_settings_select on public.club_settings;
create policy club_settings_select on public.club_settings
  for select to authenticated
  using (public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador'));

drop policy if exists club_settings_write on public.club_settings;
create policy club_settings_write on public.club_settings
  for all to authenticated
  using (public.user_is_admin_or_director(club_id))
  with check (public.user_is_admin_or_director(club_id));

-- ── 2.3 SEASONS (admin-only → admin+director)
drop policy if exists seasons_insert_admin on public.seasons;
create policy seasons_insert_admin on public.seasons
  for insert to authenticated
  with check (public.user_is_admin_or_director(club_id));

drop policy if exists seasons_update_admin on public.seasons;
create policy seasons_update_admin on public.seasons
  for update to authenticated
  using (public.user_is_admin_or_director(club_id))
  with check (public.user_is_admin_or_director(club_id));

drop policy if exists seasons_delete_admin on public.seasons;
create policy seasons_delete_admin on public.seasons
  for delete to authenticated
  using (public.user_is_admin_or_director(club_id));

-- ── 2.4 ASSESSMENT CAMPAIGNS (admin-only → admin+director).
--      Nota: assessment_deadlines fue RENOMBRADA a assessment_campaigns en
--      20260801 (tabla + policies _insert/_update/_delete). Se opera sobre los
--      nombres/tabla VIGENTES; cuerpo fiel al del remoto.
drop policy if exists assessment_campaigns_insert on public.assessment_campaigns;
create policy assessment_campaigns_insert on public.assessment_campaigns
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.user_is_admin_or_director(
      (select s.club_id from public.seasons s where s.id = season_id)
    )
  );

drop policy if exists assessment_campaigns_update on public.assessment_campaigns;
create policy assessment_campaigns_update on public.assessment_campaigns
  for update to authenticated
  using (public.user_is_admin_or_director(club_id))
  with check (public.user_is_admin_or_director(club_id));

drop policy if exists assessment_campaigns_delete on public.assessment_campaigns;
create policy assessment_campaigns_delete on public.assessment_campaigns
  for delete to authenticated
  using (public.user_is_admin_or_director(club_id));

-- ── 2.5 SESIONES: sessions_update / sessions_delete (predicado inline = admin)
drop policy if exists sessions_update on public.sessions;
create policy sessions_update on public.sessions
  for update to authenticated
  using (
    public.user_can_create_sessions(club_id)
    and (
      owner_profile_id = auth.uid()
      or public.user_is_admin_or_director(club_id)
      or public.user_is_staff_of_team(team_id)
    )
  )
  with check (
    public.user_can_create_sessions(club_id)
    and (
      owner_profile_id = auth.uid()
      or public.user_is_admin_or_director(club_id)
      or public.user_is_staff_of_team(team_id)
    )
  );

drop policy if exists sessions_delete on public.sessions;
create policy sessions_delete on public.sessions
  for delete to authenticated
  using (
    public.user_can_create_sessions(club_id)
    and (
      owner_profile_id = auth.uid()
      or public.user_is_admin_or_director(club_id)
      or public.user_is_staff_of_team(team_id)
    )
  );

-- ── 2.6 MENSAJERÍA-CREAR: announcements (insert/update/delete) + conversations insert
--      (vigentes: 20260605001). SELECT/oversight de chats NO se toca (F5B).
drop policy if exists announcements_insert_managers on public.announcements;
create policy announcements_insert_managers on public.announcements
  for insert to authenticated
  with check (
    author_profile_id = auth.uid()
    and (
      (team_id is null
        and public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador'))
      or (
        team_id is not null
        and (
          public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador', 'entrenador_principal')
          or public.user_has_capability_in_club(club_id, 'can_message_families')
          or exists (
            select 1
              from public.team_staff ts
              join public.memberships m on m.id = ts.membership_id
             where ts.team_id = announcements.team_id
               and ts.staff_role = 'entrenador_principal'
               and ts.left_at is null
               and m.profile_id = auth.uid()
          )
        )
      )
    )
  );

drop policy if exists announcements_update_author_or_manager on public.announcements;
create policy announcements_update_author_or_manager on public.announcements
  for update to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador', 'entrenador_principal')
  )
  with check (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador', 'entrenador_principal')
  );

drop policy if exists announcements_delete_author_or_manager on public.announcements;
create policy announcements_delete_author_or_manager on public.announcements
  for delete to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador', 'entrenador_principal')
  );

drop policy if exists conversations_insert_coach on public.conversations;
create policy conversations_insert_coach on public.conversations
  for insert to authenticated
  with check (
    coach_profile_id = auth.uid()
    and (
      public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador', 'entrenador_principal')
      or public.user_has_capability_in_club(club_id, 'can_message_families')
      or exists (
        select 1
          from public.team_staff ts
          join public.memberships m on m.id = ts.membership_id
          join public.teams t on t.id = ts.team_id
          join public.categories c on c.id = t.category_id
         where ts.staff_role = 'entrenador_principal'
           and ts.left_at is null
           and m.profile_id = auth.uid()
           and c.club_id = conversations.club_id
      )
    )
  );

-- ── 2.7 TEAM_STAFF (asignar cuerpo técnico a equipos): insert/update/delete
drop policy if exists team_staff_insert_admin on public.team_staff;
create policy team_staff_insert_admin
  on public.team_staff
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
    )
  );

drop policy if exists team_staff_update_admin on public.team_staff;
create policy team_staff_update_admin
  on public.team_staff
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
    )
  )
  with check (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
    )
  );

drop policy if exists team_staff_delete_admin on public.team_staff;
create policy team_staff_delete_admin
  on public.team_staff
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.teams t
      join public.categories c on c.id = t.category_id
      where t.id = team_id
        and public.user_role_in_club(c.club_id) in ('admin_club', 'director', 'coordinador')
    )
  );

-- ── 2.8 COACH_FORMATIONS: select (paridad) + delete (inline = admin)
drop policy if exists coach_formations_select on public.coach_formations;
create policy coach_formations_select on public.coach_formations
  for select to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
  );

drop policy if exists coach_formations_delete on public.coach_formations;
create policy coach_formations_delete on public.coach_formations
  for delete to authenticated
  using (
    owner_profile_id = auth.uid()
    or public.user_is_admin_or_director(club_id)
  );

-- ── 2.9 EXERCISES: select (paridad) + update + delete (inline = admin)
drop policy if exists exercises_select on public.exercises;
create policy exercises_select on public.exercises
  for select to authenticated
  using (
    case
      when status = 'draft' then
        owner_profile_id = auth.uid()
      when status in ('proposed', 'rejected') then
        owner_profile_id = auth.uid()
        or public.user_is_admin_or_director(club_id)
      else  -- published (incl. archivados)
        public.user_role_in_club(club_id) in
          ('admin_club', 'director', 'coordinador', 'entrenador_principal', 'entrenador_ayudante')
    end
  );

drop policy if exists exercises_update on public.exercises;
create policy exercises_update on public.exercises
  for update to authenticated
  using (
    (owner_profile_id = auth.uid() and status in ('draft', 'proposed', 'rejected'))
    or public.user_is_admin_or_director(club_id)
  )
  with check (
    owner_profile_id = auth.uid()
    or public.user_is_admin_or_director(club_id)
  );

drop policy if exists exercises_delete on public.exercises;
create policy exercises_delete on public.exercises
  for delete to authenticated
  using (
    (owner_profile_id = auth.uid() and status in ('draft', 'proposed', 'rejected'))
    or (public.user_is_admin_or_director(club_id) and status <> 'published')
  );

-- ── 2.10 PROMOCIONES: player_promotions_select (paridad de lectura; insert/delete
--      ya heredan director vía user_can_manage_callup).
drop policy if exists player_promotions_select on public.player_promotions;
create policy player_promotions_select on public.player_promotions
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
    or public.user_is_staff_of_team(team_id)
    or public.user_owns_player_account(player_id)
    or exists (
      select 1
        from public.team_members tm
       where tm.player_id = player_promotions.player_id
         and tm.left_at is null
         and public.user_is_staff_of_team(tm.team_id)
    )
  );
