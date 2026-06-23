-- F13.9c — valor de notificación para "cambios en un entrenamiento".
--
-- Cierra el único gap de F13.9: hoy cambiar fecha/hora o lugar de un evento de
-- entrenamiento no avisa a nadie. Con este tipo, la server action `updateEvent`
-- emite (reusando F5.7) a jugadores/familias del equipo cuando cambia el horario
-- o el lugar, y aparece en el feed/panel de novedades (13.9a/b) y como push.
--
-- Un solo valor `event_updated` (no se distingue `session_updated`): el gap es el
-- horario/lugar del EVENTO, no el contenido de la sesión (plan/ejercicios), que
-- es otra cosa y no se pide. Aquí solo se añade el valor del enum (cambio de
-- modelo); la INSERCIÓN la hace la app, como el resto. `add value` va en su
-- propia migración (no puede usarse en la misma transacción que lo crea).

alter type public.notification_type add value if not exists 'event_updated';
