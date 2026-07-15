-- F14F-1b — Cierre de F14F-1: aviso al DESCANCELAR un entrenamiento.
--
-- Cuando un entrenamiento cancelado (p. ej. por alerta de lluvia) se REACTIVA
-- (uncancel_event), hay que avisar de nuevo a jugadores y familias del equipo:
-- el entrenamiento VUELVE (misma hora, mismo plan; nunca se borró ni se
-- reprograma). Reutiliza el mismo mecanismo de fan-out que el aviso de
-- cancelación (#357): team_members → player_accounts → emitNotificationFanOut.
--
-- Aquí solo se añade el TIPO de notificación al enum; el fan-out lo emite la
-- server action uncancelTraining. Aditivo y no-regresivo.

alter type public.notification_type add value if not exists 'training_reinstated';
