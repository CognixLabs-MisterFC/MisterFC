-- Señas POR EQUIPO (corrección del modelo de TANDA 1).
--
-- La seña (gesto del catálogo fijo de 10) NO es de la jugada del banco: la MISMA
-- jugada la usan varios equipos y CADA EQUIPO elige su propia seña. Por eso
-- `signal_id` se MUEVE de `plays` → `team_plays` (la selección de cada equipo en su
-- playbook). En cambio `strategy_type` SE QUEDA en `plays` (es de la jugada, igual
-- para todos los equipos): esta migración NO lo toca.
--
-- SIN DATOS QUE MIGRAR: las jugadas son recientes y `plays.signal_id` se añadió en
-- 20260813000000 como NULLABLE y sin backfill (verificado en remoto: 0 filas con
-- valor). Se descarta la columna, no se traslada ningún valor.
--
-- OBLIGATORIEDAD (Regla #11): en BD la columna es NULLABLE (las filas de team_plays
-- ya existentes —backfill de 20260809000000— quedan NULL; sin relleno arbitrario).
-- La seña se exige en el zod de la acción de añadir/gestionar la jugada en el
-- playbook del EQUIPO (completado progresivo). Un CHECK ligero valida el dominio
-- cuando hay valor (defensa en profundidad; catálogo autoritativo en @misterfc/core).

-- 1. Quitar signal_id de plays (estaba mal: la seña no es de la jugada del club).
alter table public.plays drop column signal_id;

-- 2. Añadir signal_id a team_plays (la seña que ESTE equipo usa para esta jugada).
alter table public.team_plays
  add column signal_id text
    check (signal_id is null or signal_id in
      ('brazo_derecho_arriba', 'brazo_izquierdo_arriba', 'dos_brazos_arriba',
       'tocarse_cabeza', 'brazos_cruzados_pecho', 'mano_cadera', 'senalar_suelo',
       'brazo_horizontal', 'tocarse_pecho', 'puno_alto'));

comment on column public.team_plays.signal_id is
  'Seña del catálogo fijo de 10 (gesto del jugador) que ESTE equipo usa para esta jugada. Nullable en BD (filas previas del backfill); obligatoria en la acción de añadir/gestionar del playbook del equipo (zod). Catálogo en @misterfc/core (PLAY_SIGNAL_CATALOG).';
