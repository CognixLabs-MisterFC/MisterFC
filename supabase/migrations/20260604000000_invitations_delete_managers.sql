-- F2.6 hotfix 2026-05-30 — Ampliar policy DELETE sobre `invitations` para que
-- el flujo "Cancelar invitación pendiente" funcione desde tres vistas (club,
-- equipo, jugador) sin requerir admin_club / coordinador en todos los casos.
--
-- Política previa (rls_policies F1.7):
--   `invitations_delete_admin`: solo admin_club o coordinador del club.
--
-- Política nueva (`invitations_delete_managers`):
--   1. El inviter — quien creó la fila (`created_by = auth.uid()`).
--      Permite que un entrenador principal que invitó a un ayudante cancele su
--      propia invitación si el destinatario nunca la respondió, sin tener que
--      escalar al admin del club.
--   2. admin_club / coordinador del club — sin cambios.
--   3. Si la invitación apunta a un team_id, también el entrenador_principal
--      activo de ese team_staff. Usamos el helper `user_is_staff_of_team` y
--      añadimos el check de `staff_role = 'entrenador_principal'`.
--
-- Defense in depth: el server action `cancelInvitation` valida primero
-- `accepted_at IS NULL` para impedir borrar invitaciones ya consumidas (esas
-- ya generaron memberships reales; revocar acceso es otro camino).

drop policy if exists invitations_delete_admin on public.invitations;

create policy invitations_delete_managers on public.invitations
  for delete to authenticated
  using (
    -- 1. Inviter (quien creó la fila)
    created_by = auth.uid()
    -- 2. Admin / coordinador del club
    or public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    -- 3. Principal del team referenciado (si la invitación está atada a un team)
    or (
      team_id is not null
      and exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = invitations.team_id
          and ts.left_at is null
          and ts.staff_role = 'entrenador_principal'
          and m.profile_id = auth.uid()
      )
    )
  );

comment on policy invitations_delete_managers on public.invitations is
  'F2.6 hotfix: el inviter + admin_club/coordinador del club + entrenador_principal del team pueden borrar invitaciones (incluidas las expiradas). Las aceptadas no se borran aquí.';
