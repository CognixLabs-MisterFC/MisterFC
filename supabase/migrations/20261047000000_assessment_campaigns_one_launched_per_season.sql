-- 19-A — Restricción: una campaña de evaluación LANZADA por temporada.
--
-- Índice único parcial: como mucho UNA fila con status='launched' por season_id.
-- Atómico y sin carrera (a diferencia de un trigger count-then-write) y ADITIVO:
-- índice nuevo, NO toca assessment_campaigns_validate() ni ninguna función viva.
--
-- Verificado en la BD viva antes de escribir:
--   · 0 campañas 'launched' → el índice se crea limpio (no choca con datos).
--   · season_id es NOT NULL (0 nulls) → restringe TODAS las filas launched; un NULL
--     se escaparía de un índice único parcial.
--
-- Semántica: draft y published NO cuentan (fuera del WHERE) → puede haber varios
-- borradores y varias publicadas sin límite. Al publicar (launched→published) la fila
-- sale del índice y libera el hueco → ya se puede lanzar la siguiente de esa temporada.
-- Por season_id (no por club): una campaña abierta por temporada; si quedó una sin
-- cerrar de la temporada anterior, no bloquea lanzar en la nueva.
--
-- Colisión al lanzar con otra abierta → 23505 (unique_violation) en el UPDATE de
-- launchCampaign; el PASO 2 (solo web) lo mapea a 'already_open' con mensaje i18n.

create unique index if not exists assessment_campaigns_one_launched_per_season
  on public.assessment_campaigns (season_id)
  where status = 'launched';
