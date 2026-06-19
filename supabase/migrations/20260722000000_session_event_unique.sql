-- Subfase 12.8a — Link sesión ↔ entrenamiento (D1: 1:1).
--
-- Spec F12.8a. La sesión puede vincularse a su evento de entrenamiento del
-- calendario vía `sessions.event_id` (FK creada en 12.1, hasta ahora sin poblar).
-- D1 cerrado: la relación es **1:1** — un entrenamiento tiene como mucho UNA sesión
-- planificada. Se garantiza con un UNIQUE parcial (las plantillas y las sesiones
-- sueltas tienen event_id NULL → excluidas del índice, varios NULL permitidos).
--
-- Sin cambios de RLS/trigger (el INSERT/UPDATE de sessions ya está gateado por 12.1;
-- el clonado de plantillas no copia event_id, así que no choca con el UNIQUE).

create unique index sessions_event_uniq
  on public.sessions (event_id)
  where event_id is not null;

comment on index public.sessions_event_uniq is
  'F12.8a — 1:1 sesión↔entrenamiento: un evento del calendario tiene como mucho una sesión vinculada. Parcial (event_id NOT NULL) → no afecta a plantillas/sesiones sueltas.';
