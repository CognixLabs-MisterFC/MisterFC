-- F2.9 hotfix — players.last_name pasa a NULLABLE.
--
-- Razón: las plantillas reales que llegan de clubs amateurs (vía CSV/Excel
-- exportado de hojas con plantillas heredadas, listas de WhatsApp, etc.)
-- contienen filas sin apellidos en parte de los jugadores. Forzar el
-- apellido obliga al usuario a inventar o abandonar el import en mitad,
-- lo cual rompe la promesa de "subir tu plantilla tal cual y revisar".
--
-- Cambio:
--   - DROP del CHECK de longitud original (`char_length between 1 and 120`)
--     porque ya no aplica cuando NULL.
--   - ALTER COLUMN ... DROP NOT NULL.
--   - Nuevo CHECK que tolera NULL pero limita longitud cuando hay valor.
--
-- Modelo aditivo: nada se borra, solo se relaja la restricción. Filas
-- existentes con apellido siguen válidas. No requiere backfill.

alter table public.players
  drop constraint if exists players_last_name_check;

alter table public.players
  alter column last_name drop not null;

alter table public.players
  add constraint players_last_name_length_check
  check (last_name is null or char_length(last_name) between 1 and 120);

comment on column public.players.last_name is
  'F2.9 (2026-05-30) — opcional. NULL permitido para plantillas amateur incompletas. La UI debe renderizar sin apellido sin doble espacio ni "null".';
