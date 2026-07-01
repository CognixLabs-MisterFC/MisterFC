-- D2 — nuevo tipo de notificación para las subidas a equipos superiores.
-- Se emite a la familia/jugador cuando el staff del equipo superior sube al
-- jugador a un evento (entrenar/jugar). Aviso propio (modelo B): NO reutiliza la
-- resolución de destinatarios nativa de convocatorias.
alter type public.notification_type add value if not exists 'player_promoted';
