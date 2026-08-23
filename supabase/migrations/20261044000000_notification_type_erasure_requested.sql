-- D6 PR-A — nuevo tipo de notificación para las novedades del director.
-- Se emite cuando un tutor SOLICITA la supresión RGPD de un jugador (no cuando se
-- decide): el aviso sirve para que admin_club/director actúen. Destinatarios:
-- admin_club Y directores del club. Solo campana (in_app), sin push. El emit, el
-- texto y el enrutado llegan en el turno 2, sobre tipos ya regenerados.
--
-- ALTER TYPE ADD VALUE es IRREVERSIBLE. El nombre es definitivo: 'erasure_requested'.
-- Idempotente (IF NOT EXISTS). La aplica Jose; después: `pnpm db:types`.
alter type public.notification_type
  add value if not exists 'erasure_requested';
