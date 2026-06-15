-- Subfase 11.1 (prep modelo) — valor de notificación para el rechazo de ejercicios.
--
-- Spec 11.0 §4.6: al rechazar un ejercicio se avisa al autor reusando F5. Aquí
-- solo se añade el valor del enum (cambio de modelo); la INSERCIÓN de la
-- notificación la hace la acción de rechazo en la capa de app (subfase 11.7),
-- como el resto de notificaciones del repo. `add value` va en su propia
-- migración (no puede usarse en la misma transacción que lo crea).

alter type public.notification_type add value if not exists 'exercise_rejected';
