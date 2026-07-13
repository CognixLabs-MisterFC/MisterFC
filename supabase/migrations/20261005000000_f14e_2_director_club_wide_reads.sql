-- ─────────────────────────────────────────────────────────────────────────────
-- F14E-2 (Opción A) — DIRECTOR = ADMIN en acceso de LECTURA club-wide.
--
-- Modelo de roles (Jose): "director = como el admin EXCEPTO invitar directores y
-- subir/gestionar documentos legales". El acceso limitado de hoy en sessions,
-- development_reports y events(training) es un HUECO respecto a ese modelo → se
-- cierra dando al director el MISMO acceso club-wide que ya tiene admin_club.
--
-- SOLO se AÑADE 'director' a la rama club-wide de cada policy (recreada a partir
-- de su definición VIGENTE). No se quita nada ni se toca ningún otro rol. Ningún
-- rol distinto de director gana acceso.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. sessions — hoy: admin_club/coordinador/entrenador_principal/entrenador_ayudante.
--    (Copia fiel de 20260716000000 + 'director'.)
drop policy if exists sessions_select on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated
  using (
    (public.user_role_in_club(club_id) = any (array[
      'admin_club', 'coordinador', 'director',
      'entrenador_principal', 'entrenador_ayudante'
    ]))
    or ((not is_template) and (visibility = 'team') and public.user_is_team_member_account(team_id))
  );

-- 2. development_reports — hoy: admin_club/coordinador club-wide, o team_staff, o
--    familia del jugador. (Copia fiel de 20260728000000 + 'director' club-wide.)
drop policy if exists development_reports_select on public.development_reports;
create policy development_reports_select on public.development_reports
  for select to authenticated
  using (
    (public.user_role_in_club(club_id) = any (array['admin_club', 'coordinador', 'director']))
    or public.user_is_team_staff(team_id)
    or ((visibility = 'team') and public.user_is_account_of_player(player_id))
  );

-- 3. events — hoy la rama club-wide es admin_club/coordinador; los partidos ya son
--    club-wide para cualquier miembro (FIX-DIRECTO). Añadir 'director' a la rama
--    club-wide le da lectura de TODOS los eventos del club (incl. training), igual
--    que el admin. (Copia fiel de 20261004000000 + 'director' en la 1ª rama.)
drop policy if exists events_select on public.events;
create policy events_select on public.events
  for select to authenticated
  using (
    (public.user_role_in_club(club_id) = any (array['admin_club', 'coordinador', 'director']))
    or ((team_id is null) and (public.user_role_in_club(club_id) is not null))
    or ((team_id is not null) and public.user_is_staff_of_team(team_id))
    or ((team_id is not null) and public.user_is_team_member_account(team_id))
    or ((team_id is not null) and public.is_spectator_of_team(team_id))
    or ((type = any (array['match', 'friendly', 'tournament'])) and (public.user_role_in_club(club_id) is not null))
    or ((type = any (array['match', 'friendly', 'tournament'])) and public.is_spectator_of_club(club_id))
  );
