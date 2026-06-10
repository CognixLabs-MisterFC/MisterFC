-- Rework C · C7 — reasignación de jugadores en bloque (asistente de mapeo).
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C7).
--
-- Fase de preparación: la temporada ACTIVA (p.ej. 25-26) sigue operativa; la
-- UPCOMING (26-27) se está montando. C7 COLOCA a los jugadores en los equipos de
-- la upcoming SIN cerrar ni tocar sus membresías de la activa. Cerrar membresías
-- (left_at) es C8 (finalizar). Invariante: en C7 nunca se borra ni se cierra nada.
--
-- place_players_in_upcoming(club, dest_team, player_ids[]):
--   * Solo admin_club del club. El equipo destino debe pertenecer al club y a su
--     temporada UPCOMING (no se puede colocar fuera del rollover en preparación).
--   * Para cada jugador marcado del club, ABRE una membresía activa (left_at null)
--     en el equipo destino — la misma operación con la que el roster time-aware lo
--     contabiliza (team_members con left_at IS NULL).
--   * SOLO INSERT: no hay ningún UPDATE de left_at. La membresía de la temporada
--     activa queda intacta; el jugador queda activo en su equipo 25-26 y, además,
--     colocado en su equipo 26-27.
--   * IDEMPOTENTE: el jugador ya activo en el equipo destino se salta (not exists);
--     el índice parcial team_members_active_unique es además el respaldo duro.
--   Devuelve el nº de jugadores realmente colocados (filas nuevas).

create or replace function public.place_players_in_upcoming(
  p_club_id      uuid,
  p_dest_team_id uuid,
  p_player_ids   uuid[]
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid         uuid := auth.uid();
  v_dest_season text;
  v_placed      int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con quién abre la temporada en C6).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El equipo destino debe pertenecer al club y a su temporada UPCOMING.
  select t.season into v_dest_season
    from public.teams t
   where t.id = p_dest_team_id and t.club_id = p_club_id;
  if v_dest_season is null then
    raise exception 'dest_team_invalid' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.seasons s
     where s.club_id = p_club_id and s.label = v_dest_season and s.status = 'upcoming'
  ) then
    raise exception 'dest_not_upcoming' using errcode = 'P0001';
  end if;

  -- COLOCA: solo INSERT. Una membresía activa en el equipo destino por cada
  -- jugador del club marcado que aún NO esté activo en ese equipo. Cross-categoría
  -- permitido (no se valida la categoría del origen). NUNCA cierra/modifica nada.
  with ins as (
    insert into public.team_members (player_id, team_id, joined_at)
    select pid, p_dest_team_id, current_date
      from unnest(p_player_ids) as pid
     where exists (
             select 1 from public.players p
              where p.id = pid and p.club_id = p_club_id
           )
       and not exists (
             select 1 from public.team_members tm
              where tm.player_id = pid
                and tm.team_id = p_dest_team_id
                and tm.left_at is null
           )
    returning 1
  )
  select count(*) into v_placed from ins;

  return v_placed;
end;
$$;

comment on function public.place_players_in_upcoming(uuid, uuid, uuid[]) is
  'Rework C (C7) — coloca jugadores (checklist) en un equipo de la temporada upcoming abriendo su membresía activa, sin cerrar ni tocar las membresías de la temporada activa. Solo admin_club, solo equipos upcoming, idempotente (solo INSERT). Devuelve el nº de jugadores colocados.';
