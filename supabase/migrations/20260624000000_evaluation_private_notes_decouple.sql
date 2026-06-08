-- F8.4 (ajuste) — desacoplar evaluation_private_notes de evaluations.
--
-- Spec: docs/specs/8.0-valoraciones.md §5 (modelo) + §6 (RLS).
--
-- DECISIÓN: la nota privada del staff es INDEPENDIENTE de la valoración individual.
-- El entrenador puede dejar un apunte interno haya o no rating del jugador (p.ej.
-- solo hizo la colectiva, o quiere una nota sin ponerle número). Hasta 8.1 la tabla
-- tenía una FK a evaluations(event_id, player_id) que exigía la fila de valoración
-- previa → la quitamos.
--
-- A cambio, la integridad pasa a un TRIGGER propio (mismo patrón que evaluations /
-- team_evaluations): el evento es un PARTIDO (match/friendly/tournament), el jugador
-- pertenece al roster del equipo del evento, deriva club/team, fuerza created_by y
-- mantiene la inmutabilidad de la clave. La RLS no cambia (solo staff; jugador/familia
-- NUNCA leen la nota).
--
-- Tabla vacía (sin filas en remoto) → añadir columnas NOT NULL es seguro; el BEFORE
-- trigger las rellena antes de que se evalúe el NOT NULL.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Quitar la FK a evaluations (ya no exige valoración individual previa).
--    event_id/player_id pasan a tener FKs propias a events/players para no perder
--    la integridad referencial ni el ON DELETE CASCADE.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.evaluation_private_notes
  drop constraint evaluation_private_notes_event_id_player_id_fkey;

alter table public.evaluation_private_notes
  add constraint evaluation_private_notes_event_id_fkey
    foreign key (event_id) references public.events(id) on delete cascade,
  add constraint evaluation_private_notes_player_id_fkey
    foreign key (player_id) references public.players(id) on delete cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Columnas derivadas club_id/team_id (las rellena el trigger), como evaluations.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.evaluation_private_notes
  add column club_id uuid not null references public.clubs(id) on delete cascade,
  add column team_id uuid not null references public.teams(id) on delete cascade;

comment on table public.evaluation_private_notes is
  'F8 — nota PRIVADA del cuerpo técnico por (event_id, player_id). Tabla aparte a propósito: la RLS de Postgres no filtra columnas; aislarla evita que el jugador la lea por GET REST cuando la fila de evaluations se comparte. Nunca expuesta a jugador/familia. INDEPENDIENTE de evaluations (no exige valoración individual): integridad por trigger (evento partido + jugador en roster + deriva club/team). Distinta de player_notes (7.13, transversal al jugador).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Trigger de validación/derivación (sustituye al de 8.1, que solo forzaba
--    created_by + inmutabilidad y delegaba la integridad en la FK ya eliminada).
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.evaluation_private_notes_validate()
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
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;
  -- La nota privada es SOLO de partidos (no entrenos), igual que la colectiva.
  if v_event.type not in ('match', 'friendly', 'tournament') then
    raise exception 'event_not_a_match' using errcode = 'check_violation';
  end if;

  new.club_id := v_event.club_id;  -- derivado, autoritativo
  new.team_id := v_event.team_id;  -- derivado, autoritativo

  -- el jugador pertenece al club del evento y al roster del team a la fecha (reusa F7).
  perform public.match_assert_player_in_team(new.player_id, v_event);

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();  -- forzado
    end if;
  else
    if new.event_id is distinct from old.event_id
       or new.player_id is distinct from old.player_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'immutable_field' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- El trigger trg_evaluation_private_notes_validate (8.1) ya apunta a esta función;
-- create or replace basta, no hace falta recrearlo.
