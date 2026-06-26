-- JR-1 / ADR-0019 — valor de notificación: jugada RECHAZADA del banco.
--
-- Al rechazar (proposed→rejected) una jugada del banco del club, se avisa al
-- PROPONENTE (owner) con el motivo. Aquí solo se añade el valor del enum; la
-- INSERCIÓN la hace la server action `rejectPlay` en la capa de app (mirror de
-- `rejectExercise`). `add value` va en su propia migración (no puede usarse en la
-- misma transacción que crea/usa el valor).

alter type public.notification_type add value if not exists 'play_rejected';
