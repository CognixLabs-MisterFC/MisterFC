-- F13.10a — valor de notificación para "informe de desarrollo compartido".
--
-- Al pasar un informe de desarrollo a visibility='team' se avisará a la familia
-- (13.10d), reusando F5.7. Aquí solo se añade el valor del enum; la INSERCIÓN la
-- hará la server action en 13.10d. `add value` va en su propia migración (no
-- puede usarse en la misma transacción que lo crea), como play_published/event_updated.

alter type public.notification_type add value if not exists 'development_report_published';
