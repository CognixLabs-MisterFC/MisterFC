-- Señas/pictogramas en jugadas de estrategia (TANDA 1) — modelo.
--
-- Las jugadas del banco (ADR-0019) son jugadas de ESTRATEGIA. Se añaden dos campos:
--   · strategy_type — tipo (corner | falta | saque_banda | saque_centro).
--   · signal_id     — una seña del catálogo fijo de 10 (gesto del jugador).
--
-- OBLIGATORIEDAD (Regla #11): son obligatorios para jugadas NUEVAS, pero ya existen
-- jugadas creadas sin estos datos. Para NO romperlas ni inventar un backfill:
--   · En BD las columnas son NULLABLE (las jugadas viejas quedan NULL; sin default
--     falso ni relleno arbitrario).
--   · La OBLIGATORIEDAD vive en el zod del formulario de edición (updatePlay): al
--     guardar contenido se exigen ambos → completado progresivo al editar.
-- Un CHECK ligero valida el dominio cuando hay valor (defensa en profundidad; el
-- catálogo autoritativo de señas vive en @misterfc/core).

alter table public.plays
  add column strategy_type text
    check (strategy_type is null or strategy_type in
      ('corner', 'falta', 'saque_banda', 'saque_centro')),
  add column signal_id text
    check (signal_id is null or signal_id in
      ('brazo_derecho_arriba', 'brazo_izquierdo_arriba', 'dos_brazos_arriba',
       'tocarse_cabeza', 'brazos_cruzados_pecho', 'mano_cadera', 'senalar_suelo',
       'brazo_horizontal', 'tocarse_pecho', 'puno_alto'));

comment on column public.plays.strategy_type is
  'Tipo de estrategia de la jugada (corner|falta|saque_banda|saque_centro). Nullable en BD (jugadas previas); obligatorio en el formulario.';
comment on column public.plays.signal_id is
  'Seña del catálogo fijo de 10 (gesto del jugador). Nullable en BD (jugadas previas); obligatorio en el formulario. Catálogo en @misterfc/core (PLAY_SIGNAL_CATALOG).';
