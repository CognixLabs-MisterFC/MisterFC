-- F6 Lote B' — Bug D/G: notificación de convocatoria ACTUALIZADA.
--
-- Cuando el cuerpo técnico modifica una convocatoria YA PUBLICADA y pulsa
-- "Publicar cambios", se notifica a jugadores y familias con un tipo distinto
-- al de publicación inicial ('callup_published') para que el copy refleje que
-- es un cambio, no una primera citación.
--
-- 'callup_published', 'new_announcement', 'new_message' ya existen
-- (20260602000002 / 20260605000000 / 20260606000000). Solo falta 'callup_updated'.
--
-- ADD VALUE IF NOT EXISTS es idempotente. PG15 permite ADD VALUE dentro de la
-- transacción de migración siempre que el valor no se USE en la misma TX (aquí
-- solo se declara; lo consume el runtime de la app).

alter type public.notification_type add value if not exists 'callup_updated';
