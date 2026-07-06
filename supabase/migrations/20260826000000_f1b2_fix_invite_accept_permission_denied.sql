-- F1B-2 fix — regresión en la aceptación de invitación.
--
-- CAUSA: F1B-2 (20260824000000) recreó la policy INSERT
-- `memberships_insert_bootstrap_or_admin` y en su rama 2 (aceptación de
-- invitación por el propio invitado) sustituyó el helper SECURITY DEFINER
-- `public.current_user_email()` por un subquery inline
-- `(select email from auth.users where id = auth.uid())`. El rol `authenticated`
-- NO tiene SELECT sobre `auth.users`, así que al evaluar la policy bajo la sesión
-- del invitado se lanza `permission denied for table users` y aborta el INSERT de
-- la membership de CUALQUIER invitado no-admin (director, coordinador,
-- entrenador_principal, entrenador_ayudante, jugador). Rompe todo el onboarding
-- por invitación (`attachToClub`).
--
-- FIX: recrear la policy IDÉNTICA a la de F1B-2 cambiando ÚNICAMENTE esa línea
-- de la rama 2, volviendo a `public.current_user_email()` (SECURITY DEFINER, lee
-- auth.users con privilegio — su versión pre-F1B-2 en 20260527134819). Las 3
-- ramas OR, el gate de owner de la rama 3 y todo lo demás quedan intactos.
--
-- No toca nada más de F1B-2 ni F1B-2b (owner inmutable, roles altos solo por
-- invitación). Sin cambios de app.

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
      -- Aceptación de invitación: el user se autoinserta porque la invitación
      -- ya fue creada por admin/coord. Verificación de email match va en la
      -- server action (SECURITY: la lectura del email exige RLS sobre invitations
      -- que también validamos abajo).
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
      -- Inserción manual: rol alto (admin_club/director) → SOLO owner; rol bajo
      -- → admin/director/coord (director = admin en gestión de roles bajos).
      case
        when public.membership_role_is_high(role)
          then public.user_is_club_owner(club_id)
        else public.user_role_in_club(club_id) in ('admin_club', 'director', 'coordinador')
      end
    )
  );

comment on policy memberships_insert_bootstrap_or_admin on public.memberships is
  'F1B-2 + fix 20260826: bootstrap (1er admin) OR autoaceptación de invitación '
  '(rama 2, email vía current_user_email SECURITY DEFINER — NO subquery inline a '
  'auth.users, que da permission denied para authenticated) OR inserción manual '
  '(rol alto→owner, rol bajo→admin/director/coord).';
