-- Subfase 12.7a — Ejercicios: campo de FASE (para qué bloque(s) de la sesión sirve).
--
-- Spec F12.7a. Aditivo sobre `exercises` (F11.1): un array de tipos de bloque que
-- reúsa el catálogo FIJO de 12.1 (`SESSION_BLOCK_TYPES`/`session_blocks.block_type`).
-- Vacío por defecto → los ejercicios existentes quedan "sin fase" = sirven para
-- CUALQUIER fase (lo decide la recomendación fase-aware del picker, en core).
--
-- CHECK ligero (mismo patrón que categories/objectives de 11.1): subconjunto del
-- catálogo vía `<@`. La validación autoritativa es el Zod de @misterfc/core
-- (enum SESSION_BLOCK_TYPES). Sin tocar RLS/trigger (no hay pgTAP nuevo).

alter table public.exercises
  add column phases text[] not null default '{}' check (
    phases <@ array[
      'calentamiento', 'complementaria', 'principal', 'vuelta_a_la_calma'
    ]::text[]
  );

comment on column public.exercises.phases is
  'F12.7a — fases (tipos de bloque de 12.1) para las que sirve el ejercicio. Vacío = cualquier fase. Alimenta la recomendación fase-aware del picker de sesión.';
