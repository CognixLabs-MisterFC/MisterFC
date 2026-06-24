-- F13.10g-GA — Evoluciona assessment_deadlines → assessment_campaigns.
--
-- La fila por club×temporada×periodo pasa de "solo fecha límite" (G-0/#211) a
-- "CAMPAÑA con estado": draft (configurada) → launched (lanzada, entrenadores
-- redactando) → published (publicada en masa a las familias). due_date sigue
-- siendo la fecha límite. UNIQUE(season_id, period) se mantiene (club-wide, D7).
--
-- Append-only: NO se edita la migración de #211 (ya aplicada al remoto); aquí se
-- hace ALTER/rename + columnas + guard de transición. Reusa el patrón inmutable
-- del trigger de #211.

-- ── Rename tabla + objetos asociados (índices, trigger, función, policies) ─────────
alter table public.assessment_deadlines rename to assessment_campaigns;

alter index assessment_deadlines_season_idx rename to assessment_campaigns_season_idx;
alter index assessment_deadlines_club_idx   rename to assessment_campaigns_club_idx;

alter trigger trg_assessment_deadlines_validate on public.assessment_campaigns
  rename to trg_assessment_campaigns_validate;
alter function public.assessment_deadlines_validate() rename to assessment_campaigns_validate;

alter policy assessment_deadlines_select on public.assessment_campaigns rename to assessment_campaigns_select;
alter policy assessment_deadlines_insert on public.assessment_campaigns rename to assessment_campaigns_insert;
alter policy assessment_deadlines_update on public.assessment_campaigns rename to assessment_campaigns_update;
alter policy assessment_deadlines_delete on public.assessment_campaigns rename to assessment_campaigns_delete;

-- ── Columnas de estado de la campaña ──────────────────────────────────────────────
alter table public.assessment_campaigns
  add column status text not null default 'draft'
    check (status in ('draft', 'launched', 'published')),
  add column launched_at  timestamptz,
  add column published_at  timestamptz;

comment on table public.assessment_campaigns is
  'F13.10g — campaña de evaluación por club×temporada×periodo (club-wide, D7). status: draft (configurada) → launched (entrenadores redactando) → published (publicada en masa a familias). due_date = fecha límite. La fija/lanza/publica el admin del club.';

-- ── Trigger: deriva club_id del season, fuerza created_by, inmutables + guard de
-- transición de status (no se puede retroceder desde published, D2). ───────────────
create or replace function public.assessment_campaigns_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_club uuid;
begin
  select s.club_id into v_club
    from public.seasons s
   where s.id = new.season_id;
  if v_club is null then
    raise exception 'season_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.club_id := v_club;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
  else  -- UPDATE: identidad/historial inmutables + transición de status
    if new.created_by is distinct from old.created_by then
      raise exception 'created_by_immutable' using errcode = 'check_violation';
    end if;
    if new.club_id is distinct from old.club_id then
      raise exception 'club_immutable' using errcode = 'check_violation';
    end if;
    if new.season_id is distinct from old.season_id then
      raise exception 'season_immutable' using errcode = 'check_violation';
    end if;
    if new.period is distinct from old.period then
      raise exception 'period_immutable' using errcode = 'check_violation';
    end if;
    -- No se puede salir del estado 'published' (terminal, D2).
    if old.status = 'published' and new.status is distinct from old.status then
      raise exception 'campaign_published_immutable' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;
