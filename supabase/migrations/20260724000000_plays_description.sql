-- F13.1b — Alinear `plays` con la spec 13.0 §5: añadir `description` (text, NULL).
-- Aditivo: la migración de creación (20260723000000_plays.sql) ya está aplicada al
-- remoto, así que se añade en una migración nueva en vez de editar la previa.
--
-- `description` es MUTABLE: el trigger plays_validate solo fija/protege
-- owner/club/team, no `description` → no necesita cambios.

alter table public.plays add column description text;
