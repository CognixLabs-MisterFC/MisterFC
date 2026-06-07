-- Fix — recursión infinita de RLS entre team_staff ↔ invitations.
--
-- Síntoma: cualquier `INSERT INTO public.team_staff` falla con
--   "infinite recursion detected in policy for relation team_staff"
-- (pgTAP rls_team_staff [T2.a], rls_move_staff). Rompe el alta de cuerpo técnico
-- al aceptar invitación y la gestión de staff por admin/coord.
--
-- Causa raíz — ciclo mutuo de políticas entre dos tablas:
--   - `team_staff_insert_invitee` (WITH CHECK, mig 20260529000000) subconsulta
--     `public.invitations`.
--   - `invitations_select_admin_or_invited` (mig 20260604000001, cláusula 4
--     "principal activo del team") subconsulta DIRECTAMENTE `public.team_staff`.
-- Al insertar en team_staff, PG combina con OR todas las WITH CHECK de INSERT
-- (incluida la de invitee) → debe leer invitations → su policy SELECT lee
-- team_staff → PG reentra en la expansión de políticas de team_staff → aborta.
-- Falla incluso el INSERT de admin (la policy de invitee forma parte de la
-- expresión combinada).
--
-- Fix: la lectura de team_staff que vive dentro de la policy de invitations pasa
-- por un helper SECURITY DEFINER (bypassa RLS → no reentra). Se recrea la policy
-- de invitations usándolo. No se editan migraciones aplicadas; el predicado
-- lógico es idéntico (admin/coord + email invitado + inviter + principal del team).

-- Helper: ¿el user actual es ENTRENADOR PRINCIPAL activo del team? SECURITY
-- DEFINER + search_path fijo (mismo patrón que user_is_staff_of_team).
create or replace function public.user_is_principal_of_team(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.team_staff ts
    join public.memberships m on m.id = ts.membership_id
    where ts.team_id = p_team_id
      and ts.left_at is null
      and ts.staff_role = 'entrenador_principal'
      and m.profile_id = auth.uid()
  );
$$;

comment on function public.user_is_principal_of_team(uuid) is
  'TRUE si el user actual es entrenador_principal activo del team. SECURITY DEFINER para usarse en la policy SELECT de invitations sin recursión RLS con team_staff.';

-- Recrear la policy SELECT de invitations: idéntica salvo la cláusula 4, que
-- ahora usa el helper en vez de leer team_staff bajo RLS.
drop policy if exists invitations_select_admin_or_invited on public.invitations;

create policy invitations_select_admin_or_invited on public.invitations
  for select to authenticated
  using (
    -- 1. Admin / coordinador del club.
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    -- 2. Email matches el user invitado (flow /invite/{token}).
    or email ilike public.current_user_email()
    -- 3. Inviter (created_by = auth.uid()).
    or created_by = auth.uid()
    -- 4. Principal activo del team referenciado (vía helper definer → sin recursión).
    or (team_id is not null and public.user_is_principal_of_team(team_id))
  );

comment on policy invitations_select_admin_or_invited on public.invitations is
  'F2.6 hotfix + fix recursión: admin/coord del club + email invitado + inviter + principal del team pueden ver invitaciones. La rama "principal" usa user_is_principal_of_team (SECURITY DEFINER) para no recursar con la RLS de team_staff.';
