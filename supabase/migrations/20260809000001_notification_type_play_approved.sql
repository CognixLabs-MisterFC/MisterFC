-- JR-1 / ADR-0019 — valor de notificación: jugada APROBADA (publicada) del banco.
--
-- Al aprobar (proposed→published) o publicar directo una jugada del banco del
-- club, se avisa al PROPONENTE (owner). Aquí solo se añade el valor del enum; la
-- INSERCIÓN la hace la server action `approvePlay` en la capa de app, como el
-- resto de notificaciones del repo. `add value` va en su propia migración (no
-- puede usarse en la misma transacción que crea/usa el valor).

alter type public.notification_type add value if not exists 'play_approved';
