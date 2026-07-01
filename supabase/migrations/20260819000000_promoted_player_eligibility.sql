-- D2.1 — Integrar al jugador SUBIDO (player_promotions) como elegible en la
-- convocatoria, asistencia, alineación y captura/evaluación del EVENTO al que se
-- le subió, SIN moverlo de su equipo base (regla #1: no tocar team_members).
--
-- Enfoque (aprobado en el análisis PASO 0): roster ∪ promociones, ADITIVO y
-- SCOPED al event_id. Un helper nuevo `player_promoted_to_event(player, event)`
-- y una sola línea `... or player_promoted_to_event(...)` en el punto donde cada
-- trigger exige pertenencia al roster. NO se editan migraciones aplicadas: se
-- redefinen las funciones con create-or-replace (los triggers ya existentes
-- siguen apuntando a ellas; no se recrean).
--
-- Seguro porque:
--   · Solo AMPLÍA elegibilidad; a un miembro del roster no le cambia nada.
--   · Scoped al event_id exacto (una subida al evento X no da acceso al Y).
--   · El jugador subido es del MISMO club → el guard player_cross_club sigue
--     protegiendo (se evalúa antes que este OR).
--   · Sin MVCC: insertar callup/asistencia/lineup/etc. NO muta player_promotions.
--
-- Sitios cubiertos (5 = 4 inline + 1 helper compartido):
--   1. callup_responses_validate            (convocatoria: respuesta jugador/familia)
--   2. callup_decisions_validate            (convocatoria: decisión del staff)
--   3. training_attendance_validate_insert  (asistencia a entreno)
--   4. lineup_positions_validate            (alineación)
--   5. match_assert_player_in_team          (helper F7 → starters, events, absences,
--                                            player_stats, evaluations)

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: ¿el jugador está SUBIDO a este evento concreto?
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.player_promoted_to_event(
  p_player_id uuid,
  p_event_id  uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.player_promotions pp
     where pp.player_id = p_player_id
       and pp.event_id  = p_event_id
  );
$$;

comment on function public.player_promoted_to_event(uuid, uuid) is
  'D2.1 — TRUE si el jugador tiene una subida (player_promotions) a ESE evento. Amplía la elegibilidad de roster en convocatoria/asistencia/alineación/captura sin mover team_members.';

grant execute on function public.player_promoted_to_event(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. callup_responses_validate — respuesta a convocatoria (jugador/familia).
--    Redefinición fiel de 20260603000001 + OR promoción.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.callup_responses_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_meta  match_callup_meta%rowtype;
  v_player players%rowtype;
  v_belongs boolean;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type <> 'match' then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  -- Solo se puede responder a convocatorias PUBLICADAS.
  select * into v_meta from public.match_callup_meta where event_id = new.event_id;
  if not found or v_meta.published_at is null then
    raise exception 'callup_not_published' using errcode = 'check_violation';
  end if;

  -- Validar player + club coincidente.
  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del partido, O jugador SUBIDO a este evento (D2.1).
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs and not public.player_promoted_to_event(v_player.id, v_event.id) then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  -- Forzar responded_by = auth.uid() (siempre el último responder).
  if auth.uid() is not null then
    new.responded_by := auth.uid();
  end if;

  if tg_op = 'INSERT' then
    new.updated_at := new.responded_at;
  else
    -- event_id y player_id siguen siendo inmutables (clave de la fila).
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. callup_decisions_validate — decisión técnica del staff.
--    Redefinición fiel de 20260602000000 + OR promoción.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.callup_decisions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_player players%rowtype;
  v_belongs boolean;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type <> 'match' then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del partido, O jugador SUBIDO a este evento (D2.1).
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs and not public.player_promoted_to_event(v_player.id, v_event.id) then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  if auth.uid() is not null then
    new.decided_by := auth.uid();
  end if;

  if tg_op = 'INSERT' then
    new.updated_at := new.decided_at;
  else
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. training_attendance_validate_insert — asistencia a entreno.
--    Redefinición fiel de 20260601000000 + OR promoción.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.training_attendance_validate_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_player players%rowtype;
  v_belongs boolean;
begin
  -- Resolver evento.
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;

  -- Solo entrenamientos.
  if v_event.type <> 'training' then
    raise exception 'event_not_training' using errcode = 'check_violation';
  end if;

  -- No marcar futuro.
  if v_event.starts_at > now() then
    raise exception 'event_in_future' using errcode = 'check_violation';
  end if;

  -- Sin team_id no hay roster que validar.
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  -- Resolver player y validar club.
  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del evento, O jugador SUBIDO a este evento (D2.1).
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;

  if not v_belongs and not public.player_promoted_to_event(v_player.id, v_event.id) then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  -- Forzar recorded_by = auth.uid() (evita suplantación).
  if auth.uid() is not null then
    new.recorded_by := auth.uid();
  end if;

  -- updated_at == recorded_at en el alta.
  new.updated_at := new.recorded_at;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. lineup_positions_validate — alineación.
--    Redefinición fiel de 20260607000000 + OR promoción.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.lineup_positions_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event   events%rowtype;
  v_player  players%rowtype;
  v_belongs boolean;
begin
  select e.* into v_event
    from public.events e
    join public.lineups l on l.event_id = e.id
   where l.id = new.lineup_id;
  if not found then
    raise exception 'lineup_or_event_not_found' using errcode = 'foreign_key_violation';
  end if;

  select * into v_player from public.players where id = new.player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> v_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del partido, O jugador SUBIDO a este evento (D2.1).
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs and not public.player_promoted_to_event(v_player.id, v_event.id) then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.lineup_id is distinct from old.lineup_id then
      raise exception 'lineup_id_immutable' using errcode = 'check_violation';
    end if;
    if new.player_id is distinct from old.player_id then
      raise exception 'player_id_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. match_assert_player_in_team — helper F7 (starters, events, absences,
--    player_stats, evaluations). Redefinición fiel de 20260611000000 + OR
--    promoción. Al ser el helper compartido, cubre los 5 triggers de un plumazo.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.match_assert_player_in_team(p_player_id uuid, p_event events)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player  players%rowtype;
  v_belongs boolean;
begin
  select * into v_player from public.players where id = p_player_id;
  if not found then
    raise exception 'player_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_player.club_id <> p_event.club_id then
    raise exception 'player_cross_club' using errcode = 'check_violation';
  end if;

  -- Roster histórico a la fecha del evento, O jugador SUBIDO a este evento (D2.1).
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = p_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= p_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= p_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs and not public.player_promoted_to_event(p_player_id, p_event.id) then
    raise exception 'player_not_in_team_at_event' using errcode = 'check_violation';
  end if;
end;
$$;
