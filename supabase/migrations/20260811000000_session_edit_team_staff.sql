-- FIX (Opción A) — El STAFF del equipo de una sesión (principal Y ayudante, vínculo
-- activo) puede EDITARLA, además del owner y el admin del club.
--
-- Causa raíz: `user_can_edit_session` = user_can_create_sessions(club) AND (owner OR
-- admin_club). El segundo conjunto NO contemplaba al `team_staff` del equipo de la
-- sesión, así que un entrenador (principal de su equipo, pero rol de CLUB ayudante)
-- no podía editar una sesión de su propio equipo creada por el admin → no podía
-- añadir ejercicios NI jugadas (la RLS de INSERT de session_block_exercises y
-- session_block_plays usa user_can_edit_session) ni editar la cabecera/publicar.
--
-- Decisión: Opción A — se añade `user_is_staff_of_team(s.team_id)` al segundo
-- conjunto. Se MANTIENE `user_can_create_sessions(club)` como prerrequisito (modelo
-- de autoridad de sesiones: el ayudante necesita la capability/rol para gestionar
-- contenido de entrenamiento). Para PLANTILLAS (team_id NULL) `user_is_staff_of_team`
-- es false → la regla de staff-de-equipo NO aplica y se queda en owner ∪ admin.
--
-- Coherencia: se alinea `sessions_update` (cabecera + publicar) con la MISMA regla,
-- para que quien puede editar las hijas también pueda editar título/objetivos/
-- visibilidad de la sesión de su equipo.

-- ─────────────────────────────────────────────────────────────────────────────
-- Helper: user_can_edit_session — ahora incluye al staff del equipo de la sesión.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_can_edit_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sessions s
    where s.id = p_session_id
      and public.user_can_create_sessions(s.club_id)
      and (
        s.owner_profile_id = auth.uid()
        or public.user_role_in_club(s.club_id) = 'admin_club'
        -- Opción A: principal/ayudante del equipo de la sesión (null-safe → las
        -- plantillas, team_id NULL, no entran por aquí: siguen owner ∪ admin).
        or public.user_is_staff_of_team(s.team_id)
      )
  );
$$;
comment on function public.user_can_edit_session(uuid) is
  'F12.1 (+ fix Opción A) — TRUE si el user puede editar la sesión y sus hijas: owner, admin del club, o STAFF del equipo de la sesión (principal/ayudante activo), con autoridad de creación de sesiones. Plantillas (team_id NULL) = owner ∪ admin. Lo usan las RLS de las hijas.';
grant execute on function public.user_can_edit_session(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — sessions UPDATE alineada con la misma regla (cabecera + publicar).
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists sessions_update on public.sessions;

create policy sessions_update on public.sessions
  for update to authenticated
  using (
    public.user_can_create_sessions(club_id)
    and (
      owner_profile_id = auth.uid()
      or public.user_role_in_club(club_id) = 'admin_club'
      or public.user_is_staff_of_team(team_id)
    )
  )
  with check (
    public.user_can_create_sessions(club_id)
    and (
      owner_profile_id = auth.uid()
      or public.user_role_in_club(club_id) = 'admin_club'
      or public.user_is_staff_of_team(team_id)
    )
  );
