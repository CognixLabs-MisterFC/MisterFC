-- F13.10h-1 — Modelo de objetivos: comentario de REVISIÓN + periodo de creación en equipo.
--
-- Semántica de los DOS comentarios de un objetivo:
--   · description    = comentario de PROYECCIÓN ("qué se va a trabajar / qué se espera").
--   · review_comment = comentario de REVISIÓN  ("qué se ha conseguido / evolución").
--
-- El estado mostrado (nuevo / en proceso / conseguido / descartado) NO es una
-- columna: se DERIVA en core (objectiveDisplayState) a partir de status +
-- created_period vs el periodo del informe. Por eso el enum de status NO cambia.
--
-- created_period se añade a team_objectives (player_objectives ya lo tiene) para
-- poder derivar "nuevo" también en los objetivos de equipo. Filas existentes se
-- backfillean a 'inicial' (objetivo fijado al arranque de temporada).
--
-- Append-only. No toca RLS ni el enum de status.

-- ── Comentario de revisión (ambas tablas) ─────────────────────────────────────
alter table public.player_objectives
  add column review_comment text
    check (review_comment is null or char_length(review_comment) between 1 and 2000);
comment on column public.player_objectives.review_comment is
  'F13.10h-1 — comentario de REVISIÓN/evolución (qué se ha conseguido). description = proyección.';

alter table public.team_objectives
  add column review_comment text
    check (review_comment is null or char_length(review_comment) between 1 and 2000);
comment on column public.team_objectives.review_comment is
  'F13.10h-1 — comentario de REVISIÓN/evolución (qué se ha conseguido). description = proyección.';

-- ── created_period en team_objectives (backfill 'inicial' para filas existentes) ─
alter table public.team_objectives
  add column created_period text not null default 'inicial'
    check (created_period in ('inicial', 'diciembre', 'marzo', 'junio'));
comment on column public.team_objectives.created_period is
  'F13.10h-1 — periodo en que se fijó el objetivo (inmutable); deriva el estado "nuevo".';

-- created_period inmutable en UPDATE (mismo guard que player_objectives). El resto
-- del trigger (club derivado, team/season inmutables, updated_at) se conserva.
create or replace function public.team_objectives_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select c.club_id into v_club
    from public.teams t
    join public.categories c on c.id = t.category_id
   where t.id = new.team_id;
  if v_club is null then
    raise exception 'team_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;

  if tg_op = 'UPDATE' then
    if new.team_id is distinct from old.team_id then
      raise exception 'team_immutable' using errcode = 'check_violation';
    end if;
    if new.season_id is distinct from old.season_id then
      raise exception 'season_immutable' using errcode = 'check_violation';
    end if;
    if new.created_period is distinct from old.created_period then
      raise exception 'created_period_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;
