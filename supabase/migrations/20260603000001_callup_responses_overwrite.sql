-- F4 Lote B — Fix: una sola respuesta por (event_id, player_id), última escritura gana.
--
-- Bug detectado en smoke (Bug 2): cuenta familia (player_account relation=parent)
-- intenta responder por su hijo. El trigger callup_responses_validate hacía dos
-- cosas que entraban en conflicto sobre el mismo UPDATE:
--
--   1) Fuerza `new.responded_by := auth.uid()` (el responder actual).
--   2) Comprueba inmutabilidad: `new.responded_by IS DISTINCT FROM old.responded_by`.
--
-- Cuando el jugador respondió primero y la familia actualiza después, el paso
-- (1) reescribe `responded_by` con el profile_id de la familia, y el paso (2)
-- compara contra el `responded_by` original del jugador → falla con
-- `responded_by_immutable`. El cliente lo mostraba como genérico "No se pudo
-- guardar".
--
-- Decisión UX (ver docs/specs/4.0-asistencia-convocatorias.md §4.5):
-- UNA SOLA respuesta por (event_id, player_id). La última escritura gana.
-- `responded_by` registra al último responder y sirve de auditoría. Razón:
-- en fútbol base el familiar suele decidir, el niño puede no tener cuenta,
-- y evita conflictos de "dos respuestas vivas" para el mismo player.
-- El UNIQUE constraint (event_id, player_id) ya existía en la migración
-- original, así que el modelo queda intacto; solo cambia el trigger.
--
-- Cambio: quitar el check de inmutabilidad de `responded_by` en UPDATE.
-- Mantener event_id y player_id como inmutables (esos sí siguen siendo claves
-- de la fila).

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

  -- Roster histórico a la fecha del partido.
  select exists (
    select 1
      from public.team_members tm
     where tm.team_id = v_event.team_id
       and tm.player_id = v_player.id
       and tm.joined_at <= v_event.starts_at::date
       and (tm.left_at is null or tm.left_at >= v_event.starts_at::date)
  ) into v_belongs;
  if not v_belongs then
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
    -- `responded_by` NO lo es: la última escritura gana, queda como auditoría
    -- del último responder. Ver docs/specs/4.0-asistencia-convocatorias.md §4.5.
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

comment on function public.callup_responses_validate() is
  'F4.3 — Valida la respuesta de convocatoria. event_id/player_id inmutables; responded_by se reescribe con el último responder (auditoría). UNIQUE(event,player) garantiza una sola fila.';
