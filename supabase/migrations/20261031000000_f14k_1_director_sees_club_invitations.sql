-- F14K-1 · FIX — el DIRECTOR ve todas las invitaciones de su club.
--
-- CONTEXTO: F14K (invitar a los importados) permite invitar a admin_club Y director
-- (la policy de INSERT `invitations_insert_admin` ya incluye a ambos vía
-- user_role_in_club IN ('admin_club','director')). Pero la policy de SELECT quedó,
-- por descuido de cuando se añadió el rol director, con la rama de admin en
-- `user_role_in_club(club_id) = 'admin_club'` — solo admin_club ve TODAS las
-- invitaciones del club; un director solo ve las que creó él (`created_by = auth.uid`).
--
-- Esto rompe el criterio de F14K-1 ("saltar a los que ya tienen invitación
-- pendiente"): pedida la lista por un director, no vería las pendientes creadas por
-- otro admin y reinvitaría. FIX: la rama de admin pasa a
-- user_role_in_club(club_id) IN ('admin_club','director'). El coordinador SIGUE fuera.
--
-- DEFINICIÓN VIVA (pg_policies contra prod) — 4 ramas OR, PERMISSIVE, TO authenticated:
--   ANTES: (user_role_in_club(club_id) = 'admin_club')
--          OR (email ~~* current_user_email())
--          OR (created_by = auth.uid())
--          OR (team_id IS NOT NULL AND user_is_principal_of_team(team_id))
--   DESPUÉS: idéntica salvo la 1ª rama:
--          (user_role_in_club(club_id) IN ('admin_club','director'))
--          OR (email ~~* current_user_email())            -- intacta
--          OR (created_by = auth.uid())                   -- intacta
--          OR (team_id IS NOT NULL AND user_is_principal_of_team(team_id))  -- intacta
--
-- Se recrea (drop+create) para que las 4 ramas queden explícitas en el diff; nombre,
-- rol (authenticated), comando (SELECT) y carácter permissive se preservan.

drop policy if exists invitations_select_admin_or_invited on public.invitations;

create policy invitations_select_admin_or_invited
  on public.invitations
  for select
  to authenticated
  using (
    -- FIX F14K-1: admin_club Y director ven todas las invitaciones del club.
    user_role_in_club(club_id) in ('admin_club', 'director')
    -- Ramas preservadas tal cual de la definición viva:
    or email ilike current_user_email()                       -- el propio invitado
    or created_by = auth.uid()                                 -- quien la creó
    or (team_id is not null and user_is_principal_of_team(team_id))  -- principal del equipo
  );
