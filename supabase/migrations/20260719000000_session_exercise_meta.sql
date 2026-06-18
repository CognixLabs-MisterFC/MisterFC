-- Subfase 12.4 (fix) — Nombres/objetivos de los ejercicios de una sesión VISIBLE,
-- para la vista read-only del jugador/familia.
--
-- Problema: la RLS de `exercises` (F11.1) solo deja leer a STAFF del club. Un
-- jugador/familia que ve una sesión PUBLICADA (visibility='team') no puede resolver
-- el NOMBRE del ejercicio referenciado por cada tarea → en /mi-equipo/sesiones/[id]
-- las tareas aparecían en blanco.
--
-- Decisión (Regla #11): NO se abre la RLS de `exercises` (expondría TODA la fila
-- —descripción, diagrama, media— de ejercicios que el jugador no debe ver, incluso
-- borradores referenciados por una sesión publicada). En su lugar, este RPC
-- SECURITY DEFINER devuelve SOLO nombre + objetivos, y SOLO de los ejercicios
-- referenciados por una sesión que el usuario PUEDE ver (user_can_see_session, el
-- mismo gate que las hijas de 12.1). Mínima superficie, sin tocar políticas.

create or replace function public.session_exercise_meta(p_session_id uuid)
returns table (
  exercise_id          uuid,
  name                 text,
  tactical_objectives  text[],
  technical_objectives text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.name, e.tactical_objectives, e.technical_objectives
  from public.exercises e
  where public.user_can_see_session(p_session_id)   -- gate: staff del club o jugador/familia de una sesión team
    and e.id in (
      select sbe.exercise_id
      from public.session_block_exercises sbe
      where sbe.session_id = p_session_id
    );
$$;

comment on function public.session_exercise_meta(uuid) is
  'F12.4 — nombre + objetivos de los ejercicios referenciados por una sesión que el user puede ver (user_can_see_session). Expone lo mínimo para la vista read-only del jugador/familia sin abrir la RLS de exercises.';

grant execute on function public.session_exercise_meta(uuid) to authenticated;
