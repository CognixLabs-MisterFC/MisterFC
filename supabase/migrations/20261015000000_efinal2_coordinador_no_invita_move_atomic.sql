-- E-final-2 — (A) El COORDINADOR no invita a nadie: se retira su rama de las 4
-- policies de invitations (insert/delete/select/update), recreándolas desde su
-- def viva (C-1d, 20261012) SIN la rama coordinador. admin/director/owner-high/
-- created_by/email/principal_of_team quedan intactos.
-- (B) move_team_staff: mueve UNA asignación de staff de forma ATÓMICA (cerrar
-- origen + crear destino en una sola transacción). SECURITY INVOKER → la RLS de
-- team_staff sigue decidiendo qué puede mover cada rol; si el destino/rol lo
-- rechaza, la excepción revierte también el cierre del origen → nadie pierde la
-- asignación. Protege a TODOS los roles, no solo al coordinador.

-- ─────────────────────────────────────────────────────────────────────────────
-- A) invitations — quitar la rama coordinador de las 4 policies
-- ─────────────────────────────────────────────────────────────────────────────

-- A.1 INSERT (base viva C-1d): el case else vuelve a ser solo admin/director.
drop policy if exists invitations_insert_admin on public.invitations;
create policy invitations_insert_admin
  on public.invitations
  for insert
  to authenticated
  with check (
    role <> 'spectator'
    and case
          when public.membership_role_is_high(role) then public.user_is_club_owner(club_id)
          else public.user_role_in_club(club_id) = any (array['admin_club', 'director'])
        end
  );

-- A.2 DELETE (base viva C-1d): se retira `or (team_id is not null and
-- user_coordinates_team(team_id))`. created_by / admin_club / principal_of_team
-- intactos.
drop policy if exists invitations_delete_managers on public.invitations;
create policy invitations_delete_managers
  on public.invitations
  for delete
  to authenticated
  using (
    created_by = auth.uid()
    or public.user_role_in_club(club_id) = 'admin_club'
    or (
      team_id is not null
      and exists (
        select 1 from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = invitations.team_id
          and ts.left_at is null
          and ts.staff_role = 'entrenador_principal'
          and m.profile_id = auth.uid()
      )
    )
  );

-- A.3 SELECT (base viva C-1d): se retira la rama coordinador. admin_club / email /
-- created_by / principal_of_team intactos.
drop policy if exists invitations_select_admin_or_invited on public.invitations;
create policy invitations_select_admin_or_invited
  on public.invitations
  for select
  to authenticated
  using (
    public.user_role_in_club(club_id) = 'admin_club'
    or email ilike public.current_user_email()
    or created_by = auth.uid()
    or (team_id is not null and public.user_is_principal_of_team(team_id))
  );

-- A.4 UPDATE (base viva C-1d): se retira la rama coordinador. admin_club / email
-- intactos.
drop policy if exists invitations_update_invited_or_admin on public.invitations;
create policy invitations_update_invited_or_admin
  on public.invitations
  for update
  to authenticated
  using (
    public.user_role_in_club(club_id) = 'admin_club'
    or email ilike public.current_user_email()
  )
  with check (
    public.user_role_in_club(club_id) = 'admin_club'
    or email ilike public.current_user_email()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- B) move_team_staff — mover una asignación de forma atómica
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.move_team_staff(
  p_source_id uuid,
  p_target_team_id uuid,
  p_staff_role text
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_membership uuid;
begin
  -- Origen activo (la RLS de SELECT de team_staff permite leerlo a los miembros
  -- del club). Capturamos la membership para recrear la fila en el destino.
  select membership_id into v_membership
    from public.team_staff
   where id = p_source_id and left_at is null;
  if v_membership is null then
    raise exception 'move_source_not_found' using errcode = 'P0002';
  end if;

  -- Cerrar el origen. La RLS de UPDATE (team_staff_update_admin) decide: si no la
  -- pasa, se actualizan 0 filas → abortamos ANTES de insertar (no se pierde nada).
  update public.team_staff
     set left_at = current_date
   where id = p_source_id and left_at is null;
  if not found then
    raise exception 'move_denied' using errcode = '42501';
  end if;

  -- Crear el destino. La RLS de INSERT (team_staff_insert_admin) decide; si la
  -- rechaza (o choca el UNIQUE de principal), la excepción revierte también el
  -- UPDATE anterior (misma transacción) → movimiento atómico.
  insert into public.team_staff (team_id, membership_id, staff_role, joined_at)
  values (p_target_team_id, v_membership, p_staff_role, current_date);
end;
$$;

grant execute on function public.move_team_staff(uuid, uuid, text) to authenticated;

comment on function public.move_team_staff(uuid, uuid, text) is
  'E-final-2 — Mueve una asignación team_staff (cierra origen + crea destino) de '
  'forma atómica. SECURITY INVOKER: la RLS de team_staff gobierna quién puede mover.';
