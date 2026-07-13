-- ─────────────────────────────────────────────────────────────────────────────
-- FIX-DIRECTO (Opción A) — El DIRECTO club-wide para TODOS los roles.
--
-- PROBLEMA (verificado en prod): el directo solo era club-wide para admin/coord.
-- Director, entrenador, jugador, padre y seguidor lo veían capado a su equipo,
-- porque `events_select` es team-scoped para esos roles (las tablas del detalle
-- —match_state/match_events/lineups/lineup_positions— ya son club-wide, pero
-- están latentes porque el directo arranca de `events`).
--
-- MODELO CORRECTO (Jose):
--   · DIRECTO = TODOS los partidos de TODOS los equipos del club, para TODOS los
--     roles (los tres tipos: match, friendly, tournament).
--   · AGENDA / calendario = sigue por EQUIPO (se acota por app-filter, no por RLS;
--     ver apps/web .../calendario). Los ENTRENAMIENTOS (type='training', etc.)
--     siguen team-scoped por las ramas existentes: aquí SOLO se abren los partidos.
--
-- Este parche AÑADE ramas club-wide para los PARTIDOS; no quita ninguna existente.
-- Cada policy se recrea a partir de su definición VIGENTE (no de una copia vieja).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. events_select — rama club-wide SOLO para partidos (match/friendly/tournament).
--    Copia fiel de la vigente (20261002 / F14C-3) + 2 ramas nuevas:
--      · cualquier miembro del club (user_role_in_club is not null) ve todos los
--        partidos del club.
--      · el SEGUIDOR (is_spectator_of_club) ve todos los partidos del club.
--    Los entrenamientos y demás tipos NO se abren (siguen team-scoped arriba).
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
    -- F14C-3 — SEGUIDOR: SOLO el equipo de su jugador (agenda team-scoped)
    or (team_id is not null and public.is_spectator_of_team(team_id))
    -- FIX-DIRECTO — PARTIDOS club-wide: cualquier miembro del club ve TODOS los
    -- partidos de TODOS los equipos (directo). Solo tipos partido.
    or (
      type in ('match', 'friendly', 'tournament')
      and public.user_role_in_club(club_id) is not null
    )
    -- FIX-DIRECTO — y el SEGUIDOR ve todos los partidos del club (directo
    -- club-wide). Su AGENDA sigue team-scoped por app-filter (no por esta RLS).
    or (
      type in ('match', 'friendly', 'tournament')
      and public.is_spectator_of_club(club_id)
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. lineups_select — abrir al SEGUIDOR el lineup OFICIAL (para ver alineación/
--    formación en el directo-detalle), con el MISMO alcance club-wide que
--    match_events (is_spectator_of_event_club deriva el club del evento).
--    Copia fiel de la vigente (20260830 / F7B-2) + rama seguidor SOLO oficial.
--    NO se abren los borradores (is_official=false): la táctica WIP del entrenador
--    sigue oculta al seguidor.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists lineups_select on public.lineups;
create policy lineups_select on public.lineups
  for select to authenticated
  using (
    public.user_can_manage_lineup(event_id)
    or (is_official and visibility = 'team' and public.user_can_see_shared_lineup(event_id))
    or public.user_belongs_to_event_club(event_id)
    -- FIX-DIRECTO — SEGUIDOR: solo el lineup OFICIAL del partido, club-wide.
    or (is_official and public.is_spectator_of_event_club(event_id))
  );

drop policy if exists lineup_positions_select on public.lineup_positions;
create policy lineup_positions_select on public.lineup_positions
  for select to authenticated
  using (
    exists (
      select 1
      from public.lineups l
      where l.id = lineup_positions.lineup_id
        and (
          public.user_can_manage_lineup(l.event_id)
          or (l.is_official and l.visibility = 'team' and public.user_can_see_shared_lineup(l.event_id))
          or public.user_belongs_to_event_club(l.event_id)
          -- FIX-DIRECTO — SEGUIDOR: posiciones del lineup OFICIAL, club-wide.
          or (l.is_official and public.is_spectator_of_event_club(l.event_id))
        )
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. user_team_ids_in_club — equipos del usuario en un club (staff + cuenta
--    jugador/padre). Lo usa el app-filter de la AGENDA para acotarla a los
--    equipos del usuario ahora que los partidos son club-wide en events. Para
--    admin/coord la app NO llama a este helper (su agenda sigue club-wide).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_team_ids_in_club(p_club_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct tm.team_id
  from public.team_members tm
  join public.player_accounts pa on pa.player_id = tm.player_id
  join public.teams t on t.id = tm.team_id
  where t.club_id = p_club_id
    and tm.left_at is null
    and pa.profile_id = auth.uid()
  union
  select distinct ts.team_id
  from public.team_staff ts
  join public.memberships m on m.id = ts.membership_id
  join public.teams t on t.id = ts.team_id
  where t.club_id = p_club_id
    and ts.left_at is null
    and m.profile_id = auth.uid();
$function$;

revoke all on function public.user_team_ids_in_club(uuid) from public;
grant execute on function public.user_team_ids_in_club(uuid) to authenticated;
