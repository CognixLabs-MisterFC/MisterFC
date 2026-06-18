-- Subfase 12.2b — Reordenar bloques/tareas + total_minutes derivado.
--
-- Spec: docs/specs/12.0-planificador-sesiones.md §5/§7 (12.2). Da vida a los
-- bloques: el editor reordena bloques y tareas, y la cabecera muestra el tiempo
-- total como SUMA de los `duration_min` (deja de ser manual de 12.2a).
--
-- REORDENAR: un único UPDATE ... FROM unnest(...) WITH ORDINALITY reasigna todos
-- los order_idx a sus valores finales en UNA sentencia. El UNIQUE de orden es
-- DEFERRABLE INITIALLY DEFERRED (12.1), así el intercambio de posiciones no choca
-- (la unicidad se valida al COMMIT, con el estado final ya consistente). Funciones
-- SECURITY INVOKER → la RLS de las hijas (user_can_edit_session) es el gate real.
--
-- TOTAL DERIVADO: trigger AFTER en session_block_exercises que recalcula
-- sessions.total_minutes = sum(duration_min) de la sesión. SECURITY DEFINER (es un
-- campo derivado mantenido por el sistema; no cambia owner/club).

-- ─────────────────────────────────────────────────────────────────────────────
-- Reordenar bloques de una sesión
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_session_blocks(
  p_session_id uuid,
  p_block_ids  uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.session_blocks b
     set order_idx = (t.n - 1)::smallint
    from unnest(p_block_ids) with ordinality as t(id, n)
   where b.id = t.id
     and b.session_id = p_session_id;
end;
$$;
comment on function public.reorder_session_blocks(uuid, uuid[]) is
  'F12.2b — reasigna order_idx (0..n) a los bloques de la sesión en el orden dado, en una sola sentencia (UNIQUE deferrable). RLS de session_blocks = gate.';
grant execute on function public.reorder_session_blocks(uuid, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Reordenar tareas dentro de un bloque
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.reorder_session_tasks(
  p_block_id uuid,
  p_task_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.session_block_exercises e
     set order_idx = (t.n - 1)::smallint
    from unnest(p_task_ids) with ordinality as t(id, n)
   where e.id = t.id
     and e.block_id = p_block_id;
end;
$$;
comment on function public.reorder_session_tasks(uuid, uuid[]) is
  'F12.2b — reasigna order_idx (0..n) a las tareas de un bloque en el orden dado, en una sola sentencia (UNIQUE deferrable). RLS de session_block_exercises = gate.';
grant execute on function public.reorder_session_tasks(uuid, uuid[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- total_minutes derivado (suma de duration_min de la sesión)
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.session_recompute_total()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid;
begin
  v_session := coalesce(new.session_id, old.session_id);
  update public.sessions s
     set total_minutes = (
       select sum(e.duration_min)::smallint
         from public.session_block_exercises e
        where e.session_id = v_session
     )
   where s.id = v_session;
  return null;
end;
$$;

create trigger trg_session_recompute_total
  after insert or update or delete on public.session_block_exercises
  for each row execute function public.session_recompute_total();
