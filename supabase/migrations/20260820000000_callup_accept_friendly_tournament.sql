-- F13B — La convocatoria acepta amistosos (y torneos).
--
-- Contexto: events.type ya soporta 'friendly' y 'tournament', y el app-layer los
-- trata como partidos gestionables (isManageableMatchType / MANAGEABLE_MATCH_TYPES).
-- Pero los 3 triggers de validación de la convocatoria seguían exigiendo
-- type = 'match', así que publicar/decidir/responder una convocatoria de un
-- amistoso fallaba con `event_not_match`. Esta migración relaja SOLO la condición
-- de tipo a IN ('match','friendly','tournament); el resto de la lógica de cada
-- trigger es idéntica a su definición vigente (no cambia el tope de convocados
-- ni ninguna otra regla). Se incluye 'tournament' ya (se usará después; aquí no
-- añade comportamiento nuevo porque el resto del stack no se toca).
--
-- Migración NUEVA (nunca editar las ya aplicadas): redefine por `create or replace
-- function`; los triggers existentes siguen apuntando a estas funciones por nombre.
--
--   - match_callup_meta_validate : copia fiel de 20260602000000 + tipo relajado.
--   - callup_responses_validate  : copia fiel de 20260819000000 + tipo relajado.
--   - callup_decisions_validate  : copia fiel de 20260819000000 + tipo relajado.
--
-- Se conserva el nombre de excepción `event_not_match` para no romper el mapeo de
-- errores del app-layer (mapUpsertResponsePgErr / mapDecisionPgErr / mapPublishPgErr).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. match_callup_meta_validate — meta/publicación de la convocatoria.
--    Copia fiel de 20260602000000 + tipo relajado a match/friendly/tournament.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.match_callup_meta_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type not in ('match', 'friendly', 'tournament') then
    raise exception 'event_not_match' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    -- event_id inmutable
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    -- published_at no puede revertir a NULL.
    if old.published_at is not null and new.published_at is null then
      raise exception 'cannot_unpublish' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  -- Si se está publicando ahora, forzar published_by = auth.uid().
  if new.published_at is not null
     and (tg_op = 'INSERT' or old.published_at is null) then
    if auth.uid() is null then
      raise exception 'published_by_required' using errcode = 'check_violation';
    end if;
    new.published_by := auth.uid();
  end if;

  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. callup_responses_validate — respuesta del jugador/familia.
--    Copia fiel de 20260819000000 + tipo relajado a match/friendly/tournament.
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
  if v_event.type not in ('match', 'friendly', 'tournament') then
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
-- 3. callup_decisions_validate — decisión técnica del staff.
--    Copia fiel de 20260819000000 + tipo relajado a match/friendly/tournament.
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
  if v_event.type not in ('match', 'friendly', 'tournament') then
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
