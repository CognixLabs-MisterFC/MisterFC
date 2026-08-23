-- D6 PR-B — nuevo tipo de notificación para las novedades del director.
-- Se emite cuando ACEPTA un ENTRENADOR su invitación (no tutores ni jugadores: con
-- cientos de invitaciones de familias el feed sería inservible). Destinatarios:
-- admin_club Y directores del club. Solo campana (in_app), sin push. Informativa (no
-- navega). El emit va en el TS que llama accept_pending_invitations (flujo web
-- invite/[token]; verificado: no hay origen nativo) — llega en el turno 2, sobre tipos
-- ya regenerados.
--
-- ALTER TYPE ADD VALUE es IRREVERSIBLE. El nombre es definitivo:
-- 'coach_invitation_accepted'. Idempotente (IF NOT EXISTS). La aplica Jose; después:
-- `pnpm db:types`.
alter type public.notification_type
  add value if not exists 'coach_invitation_accepted';
