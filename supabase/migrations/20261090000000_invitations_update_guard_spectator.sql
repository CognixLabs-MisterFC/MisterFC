-- ─────────────────────────────────────────────────────────────────────────────
-- Las invitaciones de SEGUIDOR quedan fuera del alcance del UPDATE de cliente.
--
-- DE DÓNDE VIENE. El `INSERT` de `invitations` lleva desde F14C-2 un guard
-- `role <> 'spectator'`: un cliente no crea invitaciones de seguidor, las crea SOLO
-- la RPC `invite_spectator` (SECURITY DEFINER), que impone su gate de tutor/self —
-- quién puede invitar a alguien a seguir a un menor no es lo mismo que quién gestiona
-- el club. Al cerrar el agujero del autoascenso (mig 20261089000000) ese guard se dejó
-- fuera a propósito, por no ampliar el alcance de aquella pieza. Esta lo trae.
--
-- SON DOS MITADES, Y LA SEGUNDA ES LA QUE DE VERDAD PROTEGE AL SEGUIDOR:
--
--   · en WITH CHECK — lo que se pidió, el espejo del INSERT: una fila no puede
--     ACABAR siendo `spectator`. Impide fabricar un seguidor a partir de una
--     invitación de club, que es la vía que el INSERT ya cerraba.
--
--   · en USING — una fila `spectator` no se puede tocar. Sin esto, el WITH CHECK solo
--     mira el resultado: un gestor podía coger la invitación de la abuela y
--     CONVERTIRLA en una de tutor (`role='jugador'` + relación), que pasa el WITH
--     CHECK sin problema. El agujero es el mismo invariante visto del otro lado, y
--     dejarlo abierto habría hecho la mitad del trabajo.
--
-- QUÉ NO SE ROMPE, comprobado leyendo los cinco sitios que hacen UPDATE sobre
-- `invitations` (el censo vive en apps/web/src/lib/link-invited-user.ts):
--
--   · `sendInvitation` renueva con `player_id is null`; un seguidor SIEMPRE lleva
--     player_id (lo exige el CHECK invitations_player_role_consistency) → nunca lo
--     alcanza.
--   · `sendOrRenewTutorInvitation` filtra `role='jugador'` desde #665 → tampoco.
--     ANTES de ese PR sí lo alcanzaba, y esta migración le habría cambiado el error
--     de 23514 a 42501; ese camino ya no existe.
--   · `linkInvitedUser` va con service-role → exento de RLS. Es el que enlaza el
--     `invited_user_id` del seguidor, y sigue funcionando: la rama 6 del test.
--   · `accept_pending_invitations` y `finalize_account_deletion` son SECURITY
--     DEFINER → exentos.
--
-- Y el DELETE no se toca: cancelar la invitación de un seguidor sigue siendo cosa de
-- `invitations_delete_managers`. Lo comprueba la rama 5 del test.
--
-- Alcance: SOLO la policy de UPDATE. No se tocan SELECT, INSERT ni DELETE.
-- Test: supabase/tests/rls_invitations_update_spectator.sql
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists invitations_update_invited_or_admin on public.invitations;

create policy invitations_update_invited_or_admin
  on public.invitations
  for update
  to authenticated
  -- QUÉ FILAS se pueden tocar: las del club que gestionas, y NUNCA las de seguidor.
  using (
    role <> 'spectator'
    and public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
  )
  -- CÓMO puede quedar la fila: ni seguidor, y el rol alto solo lo pone el owner
  -- (mismo CASE que el INSERT).
  with check (
    role <> 'spectator'
    and case
      when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
      else public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
    end
  );

comment on policy invitations_update_invited_or_admin on public.invitations is
  'UPDATE de invitaciones: SOLO admin_club|director del club; NUNCA filas de seguidor '
  '(ni tocarlas ni fabricarlas: role <> spectator en USING y en WITH CHECK, espejo del '
  'INSERT), y el rol alto (admin_club|director) solo lo puede dejar el owner. Las de '
  'seguidor las crea y las enlaza el camino exento de RLS (invite_spectator, SECURITY '
  'DEFINER, y linkInvitedUser con service-role). 2026-09: se retiro la rama del propio '
  'invitado (email ilike current_user_email), que le permitia ascenderse el rol, '
  'cambiarse de menor y estirarse la caducidad. El nombre de la policy se conserva a '
  'proposito para no romper los grep de las migraciones anteriores.';
