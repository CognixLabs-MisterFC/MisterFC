-- F7B-2 — Lectura del directo abierta a TODO el club.
--
-- Decisión de producto (Jose): CUALQUIER miembro del club ve TODOS los partidos
-- de SU club (marcador, fase/reloj, eventos y alineación en el campo), sin filtrar
-- por el equipo del hijo. Aislamiento estricto ENTRE clubs. Solo LECTURA.
--
-- Solo se amplían las policies SELECT de las tablas que la pantalla de partidos
-- (F7B-3/4) va a leer:
--   match_state · match_periods · match_starters · match_events · lineups ·
--   lineup_positions.
-- La ESCRITURA (INSERT/UPDATE/DELETE) NO se toca: registrar eventos y mover el
-- reloj sigue siendo exclusivo del staff que graba (user_can_record_match /
-- user_can_manage_lineup). Sin realtime; el minuto lo deriva matchPhase (F7B-0).
--
-- Aislamiento: la pertenencia se comprueba SIEMPRE contra el club DEL PARTIDO
-- (club_id de la propia fila cuando existe; derivado del evento cuando no), vía
-- user_role_in_club(club) is not null → NULL para un miembro de otro club.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Helper: ¿el user pertenece al club del evento? (para tablas sin club_id
--    denormalizado: match_periods, match_starters, lineups, lineup_positions).
--    SECURITY DEFINER: resuelve events sin recursión de RLS. El aislamiento lo
--    da user_role_in_club, que filtra por (club_id, auth.uid()).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_belongs_to_event_club(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.events e
     where e.id = p_event_id
       and public.user_role_in_club(e.club_id) is not null
  );
$$;

comment on function public.user_belongs_to_event_club(uuid) is
  'F7B-2 — TRUE si el user actual es miembro del club del evento (events.club_id). '
  'Para abrir la LECTURA del directo/alineación a todo el club. Aislamiento vía '
  'user_role_in_club(club) filtrado por auth.uid().';

grant execute on function public.user_belongs_to_event_club(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. match_state / match_events — tienen club_id denormalizado → se usa directo.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists match_state_select on public.match_state;
create policy match_state_select on public.match_state
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_role_in_club(club_id) is not null
  );

drop policy if exists match_events_select on public.match_events;
create policy match_events_select on public.match_events
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_role_in_club(club_id) is not null
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. match_periods / match_starters — sin club_id → se deriva del evento.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists match_periods_select on public.match_periods;
create policy match_periods_select on public.match_periods
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_belongs_to_event_club(event_id)
  );

drop policy if exists match_starters_select on public.match_starters;
create policy match_starters_select on public.match_starters
  for select to authenticated
  using (
    public.user_can_record_match(event_id)
    or public.user_belongs_to_event_club(event_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Alineación en el campo — lineups / lineup_positions.
--    Se conserva TODO lo anterior (staff + familia del propio equipo por
--    visibility='team') y se AÑADE la lectura club-wide.
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists lineups_select on public.lineups;
create policy lineups_select on public.lineups
  for select to authenticated
  using (
    public.user_can_manage_lineup(event_id)
    or (
      is_official
      and visibility = 'team'
      and public.user_can_see_shared_lineup(event_id)
    )
    or public.user_belongs_to_event_club(event_id)
  );

drop policy if exists lineup_positions_select on public.lineup_positions;
create policy lineup_positions_select on public.lineup_positions
  for select to authenticated
  using (
    exists (
      select 1 from public.lineups l
       where l.id = lineup_positions.lineup_id
         and (
           public.user_can_manage_lineup(l.event_id)
           or (
             l.is_official
             and l.visibility = 'team'
             and public.user_can_see_shared_lineup(l.event_id)
           )
           or public.user_belongs_to_event_club(l.event_id)
         )
    )
  );

-- (INSERT/UPDATE/DELETE de todas estas tablas quedan SIN CAMBIOS: escritura solo
--  del staff que graba / gestiona la alineación.)
