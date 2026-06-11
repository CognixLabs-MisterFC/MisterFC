-- Rework C · C9 — desasignar jugador colocado por error en la reasignación.
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C9).
--
-- C7 coloca jugadores en equipos de la temporada upcoming; faltaba poder deshacer
-- una colocación hecha por error. unplace_player_from_upcoming quita la membresía
-- ABIERTA del jugador en un equipo UPCOMING.
--
--   * DELETE de la fila (no set left_at): es una colocación FUTURA sin histórico —
--     la upcoming no está activa, el equipo no tiene eventos/stats, así que borrar
--     la fila deja al jugador como si nunca se hubiera colocado, limpio.
--   * GUARD CRÍTICO: solo si el equipo pertenece a una temporada 'upcoming'. JAMÁS
--     sobre equipos de una temporada active o finalized (sería borrar histórico
--     real). El status se lee de la tabla seasons (fuente de verdad).
--   * Idempotente: si el jugador ya no está colocado, 0 filas (no-op).
--   * Solo admin_club. Devuelve el nº de filas borradas (0 o 1).

create or replace function public.unplace_player_from_upcoming(
  p_club_id   uuid,
  p_team_id   uuid,
  p_player_id uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_season  text;
  v_deleted int;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con C6/C7/C8).
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- El equipo debe pertenecer al club.
  select t.season into v_season
    from public.teams t
   where t.id = p_team_id and t.club_id = p_club_id;
  if v_season is null then
    raise exception 'team_invalid' using errcode = 'P0001';
  end if;

  -- GUARD CRÍTICO: solo equipos de una temporada UPCOMING. Si la season del equipo
  -- es active o finalized (o no existe como upcoming) → se rechaza: borrar ahí
  -- sería destruir histórico real.
  if not exists (
    select 1 from public.seasons s
     where s.club_id = p_club_id and s.label = v_season and s.status = 'upcoming'
  ) then
    raise exception 'not_upcoming' using errcode = 'P0001';
  end if;

  -- Borra la colocación ABIERTA. Idempotente: si no estaba colocado, 0 filas.
  -- Nunca toca la membresía de la temporada activa (otro team_id, otra season).
  with del as (
    delete from public.team_members tm
     where tm.player_id = p_player_id
       and tm.team_id   = p_team_id
       and tm.left_at is null
    returning 1
  )
  select count(*) into v_deleted from del;

  return v_deleted;
end;
$$;

comment on function public.unplace_player_from_upcoming(uuid, uuid, uuid) is
  'Rework C (C9) — desasigna a un jugador de un equipo de la temporada upcoming borrando su membresía abierta (colocación futura sin histórico). Solo admin_club, SOLO equipos upcoming (jamás active/finalized), idempotente. Devuelve el nº de filas borradas.';
