-- F13.6 — valor de notificación para publicar una jugada al equipo.
--
-- Spec 13.0 (Parte B): al guardar una jugada con visibility='team' se avisa a
-- jugadores/familias del equipo, reusando F5. Aquí solo se añade el valor del
-- enum (cambio de modelo); la INSERCIÓN de la notificación la hace la server
-- action `updatePlay` en la capa de app, como el resto de notificaciones del
-- repo. `add value` va en su propia migración (no puede usarse en la misma
-- transacción que crea/usa el valor).

alter type public.notification_type add value if not exists 'play_published';
