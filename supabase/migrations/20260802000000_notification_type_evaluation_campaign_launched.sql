-- F13.10g-GB — valor de notificación para "campaña de evaluación lanzada".
--
-- Al LANZAR la campaña de un periodo (status draft→launched) se avisa a los
-- entrenadores con equipos (team_staff activo), reusando F5.7. Aquí solo se añade
-- el valor del enum; la INSERCIÓN la hace la server action de GB. `add value` va en
-- su propia migración (no puede usarse en la misma transacción que crea el tipo),
-- como play_published / development_report_published.

alter type public.notification_type add value if not exists 'evaluation_campaign_launched';
