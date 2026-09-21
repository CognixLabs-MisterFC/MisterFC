-- ─────────────────────────────────────────────────────────────────────────────
-- SEGURIDAD — el invitado deja de poder reescribir su propia invitación.
--
-- QUÉ PASABA. `invitations_update_invited_or_admin` autorizaba el UPDATE a dos
-- perfiles: el gestor del club (admin_club|director) y EL PROPIO INVITADO, por la
-- rama `email ilike current_user_email()`. Y su WITH CHECK no reimponía la regla que
-- sí tiene el INSERT: invitar con un rol ALTO (admin_club|director) es exclusivo del
-- owner del club. Resultado: cualquiera con una invitación pendiente y una sesión
-- podía reescribir su propia fila.
--
-- COMPROBADO EJECUTÁNDOLO contra producción dentro de BEGIN…ROLLBACK, con una sesión
-- `authenticated` que solo llevaba el `sub` del invitado (sin membership en el club):
--
--   · UPDATE de su invitación `entrenador_ayudante` → `director` ....... PERMITIDO
--   · UPDATE de su `player_id` para apuntarse a OTRO menor del club .... PERMITIDO
--   · UPDATE de `expires_at` para estirarla diez años .................. PERMITIDO
--   · INSERT de esa misma invitación con rol alto ............. DENEGADO (42501)
--   · INSERT de esa misma invitación con rol bajo ............. DENEGADO (42501)
--
-- Es decir: no podía CREAR ninguna invitación, pero sí REESCRIBIR la suya. Y el
-- cambio de `player_id` es el peor de los tres, no el del rol:
-- `accept_pending_invitations` crea el vínculo familiar a partir de
-- `invitations.player_id`, así que un tutor invitado para su hijo podía apuntarse al
-- hijo de otra familia y aceptar. Eso es acceso a los datos de un menor ajeno.
--
-- POR QUÉ SE QUITA LA RAMA ENTERA, Y NO SOLO SE AÑADE EL CASE. La migración que la
-- conservó (20261036000000) dice que es «del flujo de aceptación». **Ese comentario
-- está caducado** y esta migración lo sustituye: la aceptación vive desde hace tiempo
-- en `accept_pending_invitations`, que es SECURITY DEFINER y por tanto se salta la
-- RLS — no necesita esta policy para nada. Censo de quién hace UPDATE sobre
-- `invitations` hoy:
--
--   · sendInvitation (invitations/actions.ts) ....... cliente del usuario → gestor
--   · sendOrRenewTutorInvitation (lib/invite-tutor) . cliente del usuario → gestor
--   · linkInvitedUser (lib/link-invited-user) ....... service-role → exento de RLS
--   · accept_pending_invitations .................... SECURITY DEFINER → exento
--   · finalize_account_deletion ..................... SECURITY DEFINER → exento
--
-- Ninguno se apoya en la rama del invitado. Los pgTAP que hacen `update invitations`
-- lo hacen tras `reset role`, como postgres, así que tampoco dependen de ella.
--
-- QUÉ NO SE COPIA DEL INSERT, a propósito: su guard `role <> 'spectator'`. Aquí el
-- alcance es el acordado —quitar la rama del invitado y traer el CASE de rol alto— y
-- ese guard es una decisión aparte, con su propio caso de uso que mirar (hoy ninguna
-- ruta de la app hace UPDATE sobre una fila `spectator`).
--
-- Alcance: SOLO la policy de UPDATE. No se tocan SELECT, INSERT ni DELETE.
-- Test: supabase/tests/rls_invitations_update_autoascenso.sql
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists invitations_update_invited_or_admin on public.invitations;

create policy invitations_update_invited_or_admin
  on public.invitations
  for update
  to authenticated
  -- QUÉ FILAS se pueden tocar: las del club que gestionas. Sin la rama del invitado.
  using (
    public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
  )
  -- CÓMO puede quedar la fila: mismo CASE que el INSERT. Un rol alto solo lo pone el
  -- owner, así que renovar una invitación no puede ascender a nadie a admin_club ni a
  -- director. Va en WITH CHECK y no en USING porque lo que se vigila es el resultado:
  -- un director puede renovar una invitación de rol bajo, pero no dejarla en alta.
  with check (
    case
      when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
      else public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    end
  );

comment on policy invitations_update_invited_or_admin on public.invitations is
  'UPDATE de invitaciones: SOLO admin_club|director del club, y el rol alto '
  '(admin_club|director) solo lo puede dejar el owner — mismo CASE que el INSERT. '
  '2026-09: se retira la rama del propio invitado (email ilike current_user_email), '
  'que le permitia ascenderse el rol, cambiarse de menor y estirarse la caducidad. '
  'La aceptacion NO la necesita: va por accept_pending_invitations (SECURITY '
  'DEFINER, exenta de RLS). El nombre de la policy se conserva a proposito para no '
  'romper los grep de las migraciones anteriores, aunque ya no incluya al invitado.';
