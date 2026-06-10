-- Rework C · C4 CONTRACT — blindaje a nivel BD: borrar una categoría JAMÁS
-- destruye histórico (equipos, eventos, y todo lo que cuelga de ellos).
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C4, §6). ADR-0018.
--
-- Auditoría de FKs que referencian public.categories (solo 2):
--   · teams.category_id   — NOT NULL  → ON DELETE RESTRICT
--     (borrar una categoría con equipos se IMPIDE a nivel BD; antes CASCADE
--      arrastraba equipos y, en cascada, su histórico: stats F9, evaluaciones F8,
--      asistencia, eventos, lineups, team_staff...).
--   · events.category_id  — NULLABLE → ON DELETE SET NULL
--     (el evento se CONSERVA, solo se desvincula de la categoría).
--
-- El guard de app (assertCategoryDeletable, C3) sigue siendo la 1ª línea con
-- mensaje amable; estas FKs son la red de seguridad definitiva a nivel BD.

-- ── teams.category_id: CASCADE → RESTRICT ────────────────────────────────────
alter table public.teams
  drop constraint teams_category_id_fkey;

alter table public.teams
  add constraint teams_category_id_fkey
    foreign key (category_id) references public.categories(id) on delete restrict;

-- ── events.category_id (nullable): CASCADE → SET NULL ────────────────────────
alter table public.events
  drop constraint events_category_id_fkey;

alter table public.events
  add constraint events_category_id_fkey
    foreign key (category_id) references public.categories(id) on delete set null;
