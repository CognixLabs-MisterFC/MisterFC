-- F14C-3 — ACCESO DEPORTIVO del SEGUIDOR (RLS).
--
-- El seguidor (player_spectators, F14C-1) obtiene LECTURA de lo deportivo-PÚBLICO
-- y NADA personal. Se cablean los helpers de F14C-1 (latentes) + 3 helpers nuevos
-- de granularidad, en la RLS de lo deportivo. NO se abre nada personal.
--
-- ALCANCE (Jose):
--   VE: agenda SOLO del equipo de su jugador; directos de TODOS los equipos del
--       club (como un jugador); equipos, jugadores (nombre/dorsal/posición),
--       estadísticas por equipo/jugador, clasificación.
--   NO VE: fecha de nacimiento, contacto/PII, médica, consentimientos, chats.
--
-- PRINCIPIO: el seguidor NO tiene membership. Su acceso viene SOLO de los helpers
-- is_spectator_*. Donde una tabla mezcla deportivo y personal en columnas (players:
-- nombre/dorsal/posición PERO también fecha_nac/altura/peso/origen/contacto), NO se
-- abre la fila entera → vista `players_sporting` con SOLO columnas deportivas.
--
-- NOTA clasificación: no existe tabla/vista de standings; se computa en la app a
-- partir de match_state (marcadores), que el seguidor ya ve por 'directos'. Nada
-- que gatear aquí.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helpers de granularidad (SECURITY DEFINER; is_spectator_of_player/is_spectator
--    ya existen de F14C-1). Espejo de user_is_team_member_account / user_belongs_to_event_club.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 ¿el user actual es seguidor de ALGÚN jugador de ESTE equipo? (agenda)
create or replace function public.is_spectator_of_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_team_id is not null and exists (
    select 1
    from public.player_spectators ps
    join public.team_members tm on tm.player_id = ps.player_id
    where tm.team_id = p_team_id
      and tm.left_at is null
      and ps.spectator_profile_id = auth.uid()
  );
$$;

comment on function public.is_spectator_of_team(uuid) is
  'F14C-3 — TRUE si el user actual es seguidor de algún jugador con ficha ACTIVA en '
  'ese equipo (player_spectators ⋈ team_members). Espejo de user_is_team_member_account. '
  'Usado en la RLS de la AGENDA (eventos del equipo del jugador seguido).';

revoke all on function public.is_spectator_of_team(uuid) from public;
grant execute on function public.is_spectator_of_team(uuid) to authenticated;

-- 1.2 ¿el user actual es seguidor de ALGÚN jugador de ESTE club? (club-wide)
create or replace function public.is_spectator_of_club(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p_club_id is not null and exists (
    select 1
    from public.player_spectators ps
    join public.players p on p.id = ps.player_id
    where p.club_id = p_club_id
      and ps.spectator_profile_id = auth.uid()
  );
$$;

comment on function public.is_spectator_of_club(uuid) is
  'F14C-3 — TRUE si el user actual es seguidor de algún jugador de ese club. Da el '
  'acceso CLUB-WIDE del seguidor (directos, equipos, team_members, categorías, '
  'temporadas, stats, vista players_sporting). NO abre nada personal.';

revoke all on function public.is_spectator_of_club(uuid) from public;
grant execute on function public.is_spectator_of_club(uuid) to authenticated;

-- 1.3 ¿seguidor del club del evento? (para tablas de directo sin club_id: derivar)
create or replace function public.is_spectator_of_event_club(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.events e
    where e.id = p_event_id
      and public.is_spectator_of_club(e.club_id)
  );
$$;

comment on function public.is_spectator_of_event_club(uuid) is
  'F14C-3 — TRUE si el user es seguidor del club del evento. Deriva el club vía '
  'events.club_id (para match_periods/match_starters, que no tienen club_id). '
  'Espejo de user_belongs_to_event_club.';

revoke all on function public.is_spectator_of_event_club(uuid) from public;
grant execute on function public.is_spectator_of_event_club(uuid) to authenticated;

-- 1.4 ¿seguidor del club del JUGADOR? Deriva el club del player_id SIN pasar por la
--     RLS de players (que está cerrada al seguidor). Necesario en la RLS de
--     team_members, cuya derivación de club iría por players (invisible al seguidor).
create or replace function public.is_spectator_of_players_club(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_spectator_of_club(
    (select p.club_id from public.players p where p.id = p_player_id)
  );
$$;

comment on function public.is_spectator_of_players_club(uuid) is
  'F14C-3 — TRUE si el user es seguidor del club al que pertenece el jugador. '
  'SECURITY DEFINER: resuelve players.club_id puenteando la RLS de players (cerrada '
  'al seguidor). Usado en la RLS de team_members.';

revoke all on function public.is_spectator_of_players_club(uuid) from public;
grant execute on function public.is_spectator_of_players_club(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. AGENDA — events_select: el seguidor ve SOLO los eventos del equipo de su
--    jugador. Copia fiel del vigente (20260808) + rama de seguidor team-scoped.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists events_select on public.events;
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
    -- F14C-3 — SEGUIDOR: SOLO el equipo de su jugador (no club-level, no otros equipos)
    or (team_id is not null and public.is_spectator_of_team(team_id))
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DIRECTOS — match_state/events (con club_id) + match_periods/starters (derivan
--    club del evento). Copia fiel del vigente (20260830) + rama de seguidor club-wide.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists match_state_select on public.match_state;
create policy match_state_select on public.match_state
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_role_in_club(club_id) is not null
    or public.is_spectator_of_club(club_id)
  );

drop policy if exists match_events_select on public.match_events;
create policy match_events_select on public.match_events
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_role_in_club(club_id) is not null
    or public.is_spectator_of_club(club_id)
  );

drop policy if exists match_periods_select on public.match_periods;
create policy match_periods_select on public.match_periods
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_belongs_to_event_club(event_id)
    or public.is_spectator_of_event_club(event_id)
  );

drop policy if exists match_starters_select on public.match_starters;
create policy match_starters_select on public.match_starters
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_belongs_to_event_club(event_id)
    or public.is_spectator_of_event_club(event_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. ESTRUCTURA DEPORTIVA club-wide (sin columnas personales): teams, team_members,
--    categories, seasons. Copia fiel del vigente + `or is_spectator_of_club`.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists teams_select_member on public.teams;
create policy teams_select_member on public.teams
  for select to authenticated
  using (
    exists (
      select 1 from public.categories c
      where c.id = category_id
        and (public.user_role_in_club(c.club_id) is not null
             or public.is_spectator_of_club(c.club_id))
    )
  );

drop policy if exists team_members_select_member on public.team_members;
create policy team_members_select_member on public.team_members
  for select to authenticated
  using (
    -- rama de MIEMBRO idéntica al original (el miembro sí ve players)
    exists (
      select 1 from public.players p
      where p.id = player_id
        and public.user_role_in_club(p.club_id) is not null
    )
    -- F14C-3 — SEGUIDOR: deriva el club por helper DEFINER (players está cerrada
    -- al seguidor, así que un exists sobre players daría 0).
    or public.is_spectator_of_players_club(player_id)
  );

drop policy if exists categories_select_member on public.categories;
create policy categories_select_member on public.categories
  for select to authenticated
  using (
    public.user_role_in_club(club_id) is not null
    or public.is_spectator_of_club(club_id)
  );

drop policy if exists seasons_select_members on public.seasons;
create policy seasons_select_members on public.seasons
  for select to authenticated
  using (
    public.user_role_in_club(club_id) is not null
    or public.is_spectator_of_club(club_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. ESTADÍSTICAS — match_player_stats (tiene club_id; sin columnas personales).
--    Nueva policy de seguidor (se suma a staff + jugador; las policies se OR-ean).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists match_player_stats_select_spectator on public.match_player_stats;
create policy match_player_stats_select_spectator on public.match_player_stats
  for select to authenticated
  using (public.is_spectator_of_club(club_id));

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. JUGADORES — vista SOLO-DEPORTIVA. players mezcla deportivo y PERSONAL
--    (date_of_birth, height_cm, weight_kg, origin, medical_notes, invite_email) →
--    NO se abre la fila entera al seguidor. La vista proyecta SOLO columnas
--    deportivas y filtra por acceso (miembro del club O seguidor del club). Vista
--    con derechos del owner (definer) → puentea la RLS de players; su WHERE es la
--    puerta. players_select_member queda INTACTA (el seguidor no lee players).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace view public.players_sporting as
  select
    p.id,
    p.club_id,
    p.first_name,
    p.last_name,
    p.dorsal,
    p.position_main,
    p.positions_secondary,
    p.foot
  from public.players p
  where p.erased_at is null
    and (
      public.user_role_in_club(p.club_id) is not null
      or public.is_spectator_of_club(p.club_id)
    );

comment on view public.players_sporting is
  'F14C-3 — Proyección SOLO-DEPORTIVA de players (id, club_id, nombre, dorsal, '
  'posición, pie). SIN date_of_birth, altura, peso, origen, notas médicas ni '
  'invite_email. Filtra por acceso (miembro del club O seguidor del club vía '
  'is_spectator_of_club) y excluye suprimidos. Es el ÚNICO camino del seguidor a '
  'datos de jugador; players sigue cerrada a no-miembros.';

revoke all on public.players_sporting from public, anon;
grant select on public.players_sporting to authenticated;
