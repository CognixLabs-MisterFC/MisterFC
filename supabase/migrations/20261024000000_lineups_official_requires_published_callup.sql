-- ─────────────────────────────────────────────────────────────────────────────
-- Marcar una alineación OFICIAL exige que la convocatoria esté PUBLICADA.
--
-- Bug (detectado por Jose probando F14H): hoy se puede marcar una alineación
-- como oficial sin que la convocatoria del partido esté publicada. Ni la acción
-- (setLineupOfficial), ni la RLS (lineups_update), ni el trigger lo impedían.
--
-- Regla (cerrada por Jose): para marcar oficial, match_callup_meta.published_at
-- del evento debe ser NOT NULL. Basta con que esté publicada — da igual que los
-- jugadores hayan respondido o no. Hacer/editar la alineación en BORRADOR sigue
-- libre; solo se gatea la transición a oficial.
--
-- Barrera REAL en el trigger (no solo en la acción): un gate solo en la acción
-- de servidor lo salta cualquier UPDATE crudo sobre lineups.is_official (ya nos
-- pasó en F14F-4). La policy lineups_update NO se toca (un subselect a otra
-- tabla en la RLS es más frágil que el trigger, que ya valida is_official-
-- adyacentes).
--
-- ⚠️ NADA de CHECK constraint: invalidaría filas oficiales existentes cuya
-- convocatoria no está publicada (hay 4 en prod, todas sin fila
-- match_callup_meta) y rompería el ALTER TABLE. El gate vive en el trigger y
-- SOLO dispara en la transición a oficial (INSERT con is_official=true, o
-- UPDATE que pasa de false→true) → las filas ya oficiales NO se re-validan
-- mientras nadie las vuelva a marcar. Desmarcar (true→false) sigue libre.
--
-- Se RECREA lineups_validate desde su definición VIVA (la de 20260611000000
-- match_live_capture, que relajó el tipo a match/friendly — NO la original
-- 20260607000000). Se conservan TODAS sus validaciones (type in
-- (match,friendly), team presente, created_by forzado, event_id/created_by
-- inmutables, updated_at). El único añadido es la rama de convocatoria.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.lineups_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_published_at timestamptz;
begin
  select * into v_event from public.events where id = new.event_id;
  if not found then
    raise exception 'event_not_found' using errcode = 'foreign_key_violation';
  end if;
  if v_event.type not in ('match', 'friendly') then
    raise exception 'event_not_match_or_friendly' using errcode = 'check_violation';
  end if;
  if v_event.team_id is null then
    raise exception 'event_without_team' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else
    if new.event_id is distinct from old.event_id then
      raise exception 'event_id_immutable' using errcode = 'check_violation';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  -- Gate de convocatoria: SOLO en la transición a oficial (INSERT con
  -- is_official=true, o UPDATE false→true). Nunca re-valida una alineación que
  -- ya era oficial, ni el desmarcado (true→false). La convocatoria debe estar
  -- publicada (published_at is not null); si no hay fila, no está publicada.
  if new.is_official and (tg_op = 'INSERT' or not old.is_official) then
    select m.published_at into v_published_at
      from public.match_callup_meta m
     where m.event_id = new.event_id;
    if v_published_at is null then
      raise exception 'callup_not_published' using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

-- El trigger trg_lineups_validate ya existe (before insert or update) y apunta a
-- esta función; con CREATE OR REPLACE FUNCTION queda actualizado sin recrearlo.
