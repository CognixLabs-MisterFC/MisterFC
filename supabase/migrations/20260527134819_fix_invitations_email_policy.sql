-- Subfase 1.7 (fix) — Email helper para policies de invitations
--
-- Problema en la migración 20260527133957_rls_policies.sql:
--   Las policies SELECT/UPDATE de invitations leían directamente `auth.users`:
--     email ilike (select email from auth.users where id = auth.uid())
--   Pero el rol `authenticated` no tiene SELECT sobre `auth.users`, así que las
--   consultas fallaban con "permission denied for table users". El test T4 lo
--   pilló.
--
-- Fix:
--   1. Añadir public.current_user_email() — SECURITY DEFINER, lee auth.users
--      en nombre del caller pero con privilegios del owner de la función.
--   2. Recrear las policies de invitations usando ese helper.

create or replace function public.current_user_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select email from auth.users where id = auth.uid();
$$;

comment on function public.current_user_email() is
  'Devuelve el email del user autenticado actual. SECURITY DEFINER para sortear que `authenticated` no pueda SELECT sobre auth.users.';

drop policy if exists invitations_select_admin_or_invited on public.invitations;
drop policy if exists invitations_update_invited_or_admin on public.invitations;

create policy invitations_select_admin_or_invited on public.invitations
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or email ilike public.current_user_email()
  );

create policy invitations_update_invited_or_admin on public.invitations
  for update to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or email ilike public.current_user_email()
  )
  with check (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or email ilike public.current_user_email()
  );

-- También memberships_insert_bootstrap_or_admin tenía la misma lectura directa
-- de auth.users en la rama de "aceptación de invitación". Recreamos.

drop policy if exists memberships_insert_bootstrap_or_admin on public.memberships;

create policy memberships_insert_bootstrap_or_admin on public.memberships
  for insert to authenticated
  with check (
    (
      profile_id = auth.uid()
      and role = 'admin_club'
      and not exists (
        select 1 from public.memberships m where m.profile_id = auth.uid()
      )
    )
    or
    (
      profile_id = auth.uid()
      and exists (
        select 1 from public.invitations i
        where i.email ilike public.current_user_email()
          and i.club_id = memberships.club_id
          and i.role = memberships.role
          and i.accepted_at is null
          and i.expires_at > now()
      )
    )
    or
    (
      public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    )
  );
