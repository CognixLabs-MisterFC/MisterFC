-- El PRINCIPAL del equipo modera los anuncios de SU equipo (UPDATE + DELETE).
--
-- LA DEUDA, anotada en docs/journey/known-issues.md desde el 2026-06-27 y decidida por
-- Jose el 2026-10-07. El INSERT de anuncios ya reconoce al staff del equipo:
--
--   announcements_insert_managers … (team_id is not null and (
--     user_role_in_club(club_id) = any (array['admin_club','director','entrenador_principal'])
--     or user_coordinates_team(team_id) or user_is_staff_of_team(team_id)))
--
-- pero el UPDATE y el DELETE se gobiernan por el ROL DE CLUB (`user_role_in_club`) más la
-- rama del coordinador, y no miran `team_staff`. Efecto medido: un entrenador cuyo rol de
-- CLUB es `entrenador_ayudante` y que es PRINCIPAL de su equipo podía crear anuncios de
-- ese equipo y editar los SUYOS (rama `author_profile_id = auth.uid()`), pero no moderar
-- los de otra persona en su propio equipo. Es el mismo patrón «rol de club sin contemplar
-- team_staff» que ya se arregló en asistencia (#223), eventos (#224) y sesiones (#236).
--
-- QUÉ SE AÑADE, Y SOLO ESO: la rama `user_is_principal_of_team(team_id)` en las dos
-- políticas. PRINCIPAL, no staff: la decisión es que modere quien dirige el equipo, no
-- todo el que esté asignado a él (ayudante, preparador físico, delegado). Por eso NO se
-- reutiliza `user_is_staff_of_team`, que es lo que usa el INSERT.
--
-- COPIA FIEL, y aquí el repo ya tiene una cicatriz: la lección F1B de known-issues es que
-- recrear una policy «copia fiel» NO lo es si se cambia un helper por el camino (sustituir
-- `current_user_email()` por un subquery a `auth.users` rompió TODO el onboarding por
-- invitación, fix #280). Así que las dos definiciones de abajo salen de `pg_policies` de
-- PRODUCCIÓN, leídas el 2026-10-07, y lo único distinto es la rama nueva. Verificado en la
-- misma lectura, porque una copia fiel no se adivina: las dos son PERMISSIVE, las dos son
-- `to authenticated`, el UPDATE lleva USING **y** WITH CHECK (idénticos entre sí) y el
-- DELETE solo USING.
--
-- El helper ya existe (no se crea ni se toca nada en él) y hoy lo usa una sola policy,
-- `invitations_select_admin_or_invited`:
--
--   user_is_principal_of_team(p_team_id) → exists (team_staff ts join memberships m
--     where ts.team_id = p_team_id and ts.left_at is null
--       and ts.staff_role = 'entrenador_principal' and m.profile_id = auth.uid())
--
-- ⚠️ UN HUECO QUE NO ARREGLA ESTA MIGRACIÓN, dicho para que no se descubra dos veces: ese
-- helper NO comprueba `m.left_at is null`, al contrario que sus dos hermanos
-- (`user_coordinates_team` y `user_is_staff_of_team`, que sí). En la práctica lo tapa el
-- invariante de 20261053000000: la baja pasa SIEMPRE por `set_membership_left`, que cierra
-- las `team_staff` activas del target. Lo que NO lo tapa es un `update memberships set
-- left_at` a mano —que es como se cierran hoy las membresías, porque ningún trigger vigila
-- el UPDATE—: ahí la asignación queda colgando y el helper diría que sí. Cambiarlo afecta
-- a la otra policy que lo usa, así que es su propio PR con su propio ensayo.
--
-- El `muro_pago_select` de esta tabla es RESTRICTIVE y solo de SELECT: no interviene aquí.
-- Nada de esquema: solo estas dos políticas.
--
-- Suite: supabase/tests/anuncios_principal_modera_su_equipo.sql

-- ═══════════ UPDATE ═══════════
drop policy if exists announcements_update_author_or_manager on public.announcements;
create policy announcements_update_author_or_manager
  on public.announcements
  for update
  to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
    or (team_id is not null and public.user_coordinates_team(team_id))
    -- NUEVO: el principal de ESE equipo, por team_staff y no por el rol de club.
    or (team_id is not null and public.user_is_principal_of_team(team_id))
  )
  with check (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
    or (team_id is not null and public.user_coordinates_team(team_id))
    or (team_id is not null and public.user_is_principal_of_team(team_id))
  );

-- ═══════════ DELETE ═══════════
drop policy if exists announcements_delete_author_or_manager on public.announcements;
create policy announcements_delete_author_or_manager
  on public.announcements
  for delete
  to authenticated
  using (
    author_profile_id = auth.uid()
    or public.user_role_in_club(club_id) = any (array['admin_club', 'director', 'entrenador_principal'])
    or (team_id is not null and public.user_coordinates_team(team_id))
    -- NUEVO: igual que arriba. Moderar incluye borrar.
    or (team_id is not null and public.user_is_principal_of_team(team_id))
  );
