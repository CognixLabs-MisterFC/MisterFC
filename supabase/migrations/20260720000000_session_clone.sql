-- Subfase 12.6 — Plantillas de sesión: clonado atómico (guardar como / crear desde).
--
-- Spec: docs/specs/12.0-planificador-sesiones.md §3 (D5) / §7 (12.6). Las plantillas
-- viven en la MISMA tabla `sessions` con is_template=true (sin fecha, sin equipo, sin
-- evento, visibility='staff' — endurecido por los CHECK de 12.1). Esta migración añade
-- UN solo RPC `clone_session` que cubre las DOS direcciones:
--   · GUARDAR COMO PLANTILLA: source = sesión real → clon con is_template=true.
--   · CREAR DESDE PLANTILLA:  source = plantilla   → clon con is_template=false + fecha.
--
-- Atómico (una transacción): copia cabecera + bloques + tareas (con overrides del día)
-- respetando order_idx. NO siembra el esqueleto por defecto (D5): copia los bloques del
-- origen tal cual. SECURITY INVOKER → la RLS de 12.1 es el gate real:
--   · el INSERT en sessions exige owner=auth.uid() + user_can_create_sessions (RLS),
--     y el trigger sessions_validate fuerza el owner;
--   · el SELECT del origen lo filtra sessions_select (si no se ve, 0 filas → error);
--   · los INSERT de las hijas exigen user_can_edit_session(clon) (owner) y los triggers
--     de 12.1 DERIVAN club_id/session_id del padre (denorm fiable);
--   · total_minutes lo recalcula el trigger AFTER de 12.2b al copiar las tareas.
--
-- Decisiones de implementación (Regla #11, documentadas en el PR):
--   · La plantilla NO hereda equipo (club-scoped, reutilizable): team_id se elige al
--     crear DESDE plantilla. Al guardar COMO plantilla, team_id := null.
--   · La plantilla SÍ hereda objetivos (físico/táctico/técnico) + meso/micro + bloques
--     + ejercicios con sus overrides: es el contenido metodológico reutilizable.
--   · p_title sobrescribe el título si se pasa (nombre de la plantilla); si es null,
--     se copia el del origen (crear desde plantilla hereda el nombre de la plantilla).

create or replace function public.clone_session(
  p_source_id    uuid,
  p_is_template  boolean,
  p_title        text   default null,
  p_session_date date   default null,
  p_team_id      uuid   default null
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_id    uuid;
  v_block     record;
  v_new_block uuid;
begin
  -- Cabecera: copia del origen (RLS de SELECT decide si se ve). owner lo fuerza el
  -- trigger; club se hereda del origen. Una plantilla nunca tiene fecha/equipo/evento
  -- ni visibility distinta de 'staff' (CHECK de 12.1); el clon arranca como borrador.
  insert into public.sessions (
    owner_profile_id, club_id, team_id, is_template, session_date, title,
    objective_physical, tactical_objectives, technical_objectives,
    mesocycle, microcycle, visibility
  )
  select
    auth.uid(),
    s.club_id,
    case when p_is_template then null else p_team_id end,
    p_is_template,
    case when p_is_template then null else p_session_date end,
    coalesce(p_title, s.title),
    s.objective_physical, s.tactical_objectives, s.technical_objectives,
    s.mesocycle, s.microcycle,
    'staff'
  from public.sessions s
  where s.id = p_source_id
  returning id into v_new_id;

  if v_new_id is null then
    raise exception 'clone_source_not_found' using errcode = 'no_data_found';
  end if;

  -- Bloques + sus tareas, en orden. club_id/session_id de las hijas los DERIVAN los
  -- triggers de 12.1 del padre (por eso no se pasan aquí).
  for v_block in
    select id, block_type, title, notes, order_idx
      from public.session_blocks
     where session_id = p_source_id
     order by order_idx
  loop
    insert into public.session_blocks (session_id, block_type, title, notes, order_idx)
    values (v_new_id, v_block.block_type, v_block.title, v_block.notes, v_block.order_idx)
    returning id into v_new_block;

    insert into public.session_block_exercises
      (block_id, exercise_id, order_idx, duration_min, series, notes)
    select v_new_block, e.exercise_id, e.order_idx, e.duration_min, e.series, e.notes
      from public.session_block_exercises e
     where e.block_id = v_block.id
     order by e.order_idx;
  end loop;

  return v_new_id;
end;
$$;

comment on function public.clone_session(uuid, boolean, text, date, uuid) is
  'F12.6 — clona una sesión a una nueva fila (plantilla si p_is_template, sesión real si no), copiando cabecera + bloques + tareas con overrides. RLS de 12.1 = gate. No siembra esqueleto (copia los bloques del origen).';

grant execute on function public.clone_session(uuid, boolean, text, date, uuid) to authenticated;
