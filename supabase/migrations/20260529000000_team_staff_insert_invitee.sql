-- F2.4/F2.6 fix — el invitee necesita insertar su propia fila al aceptar
-- una invitación. Las policies existentes solo cubrían admin/coord, no el
-- propio user invitado.
--
-- Patrón calcado de `memberships_insert_bootstrap_or_admin`: una segunda
-- policy ADITIVA que permite al user insertar SU entry SI hay una invitación
-- pendiente válida que coincida en los campos relevantes.
--
-- Razonado:
--   * La invitación ya fue creada por admin/coord (la RLS de invitations lo
--     garantiza al inserto).
--   * Email match + accepted_at IS NULL + expires_at > now() certifica que
--     este user es el invitado y la invitación está vigente.
--   * El membership/profile referenciado debe ser del propio user — evita
--     inyectar entries para terceros.
--
-- Síntoma sin este fix: el server action de accept devolvía "generic" porque
-- el INSERT a team_staff (F2.6 staff) o a player_accounts (F2.4 tutor)
-- fallaba con SQLSTATE 42501 (RLS policy violation).

-- ─────────────────────────────────────────────────────────────────────────────
-- team_staff: invitee inserta SU fila (entrenador/preparador/delegado)
-- ─────────────────────────────────────────────────────────────────────────────

create policy team_staff_insert_invitee
  on public.team_staff
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.memberships m
      join public.invitations i on i.club_id = m.club_id
      where m.id = team_staff.membership_id
        and m.profile_id = auth.uid()
        and i.email ilike public.current_user_email()
        and i.team_id = team_staff.team_id
        and i.team_staff_role = team_staff.staff_role
        and i.accepted_at is null
        and i.expires_at > now()
    )
  );

comment on policy team_staff_insert_invitee on public.team_staff is
  'Permite al invitee insertar su propia fila al aceptar una invitación con team_id + team_staff_role pendiente vigente.';

-- ─────────────────────────────────────────────────────────────────────────────
-- player_accounts: invitee tutor inserta SU vínculo (parent/guardian)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- El comentario en 20260528180000_invitations_player_link.sql asumió que la
-- policy `player_accounts_write_admin` (F1.7) cubría este caso. No es así:
-- solo admin/coord pueden, no el propio invitee. Añadimos una policy aditiva
-- para INSERT (no para UPDATE/DELETE, que siguen reservados a admin/coord).

create policy player_accounts_insert_invitee
  on public.player_accounts
  for insert
  to authenticated
  with check (
    profile_id = auth.uid()
    and exists (
      select 1
      from public.invitations i
      where i.player_id = player_accounts.player_id
        and i.player_relation = player_accounts.relation
        and i.role = 'jugador'
        and i.email ilike public.current_user_email()
        and i.accepted_at is null
        and i.expires_at > now()
    )
  );

comment on policy player_accounts_insert_invitee on public.player_accounts is
  'Permite al invitee tutor (parent/guardian) insertar su propio vínculo al aceptar la invitación.';
