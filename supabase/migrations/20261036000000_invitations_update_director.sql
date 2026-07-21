-- ─────────────────────────────────────────────────────────────────────────────
-- Rework B2 — el DIRECTOR puede RENOVAR/REENVIAR invitaciones igual que el admin.
--
-- Contexto: el circuito sendOrRenewTutorInvitation (alta manual + botón de ficha)
-- hace UPDATE de la invitación cuando ya existe una vigente (renovar token +
-- expiración). Hoy el INSERT de invitations autoriza admin_club|director, pero la
-- policy de UPDATE solo autoriza admin_club → un director recibe 42501 al renovar.
--
-- Este cambio amplía SOLO la rama de rol de la policy de UPDATE para incluir al
-- director, usando la MISMA condición que ya autoriza el INSERT/SELECT:
--   user_role_in_club(club_id) = ANY (ARRAY['admin_club','director'])
-- Se conserva intacta la rama del propio invitado (email ~~* current_user_email())
-- del flujo de aceptación. NO se tocan SELECT, DELETE ni INSERT.
--
-- Seguridad: `user_role_in_club(club_id) = ANY(...)` devuelve NULL si el rol es
-- NULL → la policy lo trata como false (sin bypass). Hereda la seguridad del
-- INSERT, que usa exactamente la misma expresión.
--
-- Definición ANTES (pg_policies, prod):
--   USING/WITH CHECK:
--     ((user_role_in_club(club_id) = 'admin_club'::text)
--      OR (email ~~* current_user_email()))
-- Definición DESPUÉS: la rama 'admin_club' pasa a ANY(ARRAY['admin_club','director']).
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists invitations_update_invited_or_admin on public.invitations;

create policy invitations_update_invited_or_admin
  on public.invitations
  for update
  to authenticated
  using (
    public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    or email ilike public.current_user_email()
  )
  with check (
    public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    or email ilike public.current_user_email()
  );

comment on policy invitations_update_invited_or_admin on public.invitations is
  'UPDATE de invitaciones: admin_club|director del club (misma condición que el '
  'INSERT/SELECT) o el propio invitado (email). B2 2026-07: se añade director '
  'para que pueda renovar/reenviar invitaciones (sendOrRenewTutorInvitation).';
