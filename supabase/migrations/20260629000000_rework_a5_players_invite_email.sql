-- Rework A · A5 — players.invite_email (🔒 O2).
--
-- Spec: docs/specs/A.0-categorias-equipos.md §3.4 / §7 / 🔒 O2.
--
-- Email de CONTACTO/INVITACIÓN del jugador (probablemente del familiar). En esta
-- fase SOLO se persiste desde el import; el auto-envío de la invitación, quién la
-- recibe y el tratamiento RGPD son fase futura (fuera de alcance, O2).
--
-- NULLABLE. Check de formato igual al patrón usado en otras columnas email
-- (un @, sin espacios, dominio con punto) para que cualquier valor aceptado por
-- el parser (Zod email) pase también la constraint de BD.
--
-- RLS: NO se toca. RLS de players es a nivel de fila; una columna nueva queda
-- cubierta por las policies existentes sin ampliar la visibilidad a
-- jugador/familia más allá de lo que ya hay.

alter table public.players
  add column invite_email text
  check (invite_email is null or invite_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

comment on column public.players.invite_email is
  'Rework A (A5, 🔒 O2) — email de contacto/invitación del jugador (probablemente del familiar). Solo se guarda (import); el auto-envío y el RGPD son fase futura. NULLABLE.';
