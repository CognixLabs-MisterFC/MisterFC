-- B1 (v2 de propuestas) — tipo de notificación 'play_updated'.
--
-- Cuando el coordinador APRUEBA una propuesta de cambios eligiendo SUSTITUIR la
-- original (volcado sobre el mismo registro published), se avisa al STAFF de los
-- equipos que tienen esa jugada en su playbook: "la jugada «X» se ha actualizado".
--
-- `alter type ... add value` no usa el valor en la misma transacción (solo lo
-- añade), así que es seguro en una migración aparte (mismo patrón que
-- notification_type_play_approved / _rejected).
alter type public.notification_type add value if not exists 'play_updated';
