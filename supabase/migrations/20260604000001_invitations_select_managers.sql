-- F2.6 hotfix 2026-05-30 — ampliar policy SELECT sobre `invitations`.
--
-- Motivo: en Postgres, DELETE/UPDATE requieren que la fila también pase el
-- SELECT USING (no solo el DELETE/UPDATE USING). El policy SELECT previo solo
-- cubría admin/coord/email-matches; el inviter o el principal del team_id no
-- podían ver sus propias invitaciones y por tanto tampoco borrarlas, aunque
-- el policy `invitations_delete_managers` (migración 20260604000000) lo
-- permitiera.
--
-- Esta migración alinea SELECT con DELETE: las 4 fuentes de "manager" pueden
-- ver y por tanto cancelar. La rama "email matches" (flow /invite/{token})
-- se mantiene sin cambios.

drop policy if exists invitations_select_admin_or_invited on public.invitations;

create policy invitations_select_admin_or_invited on public.invitations
  for select to authenticated
  using (
    -- 1. Admin / coordinador del club (sin cambio respecto a F1.7)
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    -- 2. Email matches el user invitado (flow /invite/{token}, sin cambio).
    --    Usamos el helper `current_user_email()` (SECURITY DEFINER) porque el
    --    rol authenticated NO tiene SELECT sobre auth.users — patrón establecido
    --    en la migración 20260527134819_fix_invitations_email_policy.sql.
    or email ilike public.current_user_email()
    -- 3. Inviter (created_by = auth.uid()) ve sus propias invitaciones
    or created_by = auth.uid()
    -- 4. Principal activo del team referenciado
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

comment on policy invitations_select_admin_or_invited on public.invitations is
  'F2.6 hotfix: admin/coord del club + email invitado + inviter + principal del team pueden ver invitaciones. Necesario para que el DELETE policy efectivamente funcione (DELETE en PG requiere SELECT visible).';
