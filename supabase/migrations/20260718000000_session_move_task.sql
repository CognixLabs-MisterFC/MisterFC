-- Subfase 12.2b (fix) — mover una tarea ENTRE bloques de la misma sesión.
--
-- 12.1 hizo block_id INMUTABLE (block_immutable). Para arrastrar una tarea del
-- bloque A al B (misma sesión) se recrea el trigger de validación permitiendo el
-- cambio de bloque SIEMPRE que el nuevo bloque sea de la MISMA sesión (cruzar de
-- sesión sigue prohibido). session_id/club_id se re-derivan del nuevo bloque (al
-- ser misma sesión, no cambian de hecho).
--
-- move_session_task: en UNA transacción cambia el bloque de la tarea y reindexa el
-- bloque DESTINO a 0..n con el orden dado (UNIQUE deferrable de 12.1 → sin choque).
-- El bloque ORIGEN queda con un hueco en order_idx (irrelevante: se ordena por
-- order_idx y el próximo reorder lo normaliza). SECURITY INVOKER → RLS = gate.

-- ─────────────────────────────────────────────────────────────────────────────
-- Trigger: block_id mutable dentro de la MISMA sesión
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.session_block_exercises_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_session uuid; v_club uuid;
begin
  select session_id, club_id into v_session, v_club
    from public.session_blocks where id = new.block_id;
  if v_session is null then
    raise exception 'block_not_found' using errcode = 'foreign_key_violation';
  end if;
  new.session_id := v_session;
  new.club_id := v_club;

  -- Mover de bloque sí; mover a un bloque de OTRA sesión, no.
  if tg_op = 'UPDATE' and new.block_id is distinct from old.block_id then
    if v_session is distinct from old.session_id then
      raise exception 'cross_session_move' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Mover una tarea a otro bloque + reindexar el destino
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.move_session_task(
  p_task_id     uuid,
  p_to_block_id uuid,
  p_dest_ids    uuid[]   -- orden final del bloque destino (incluye la tarea movida)
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  update public.session_block_exercises
     set block_id = p_to_block_id
   where id = p_task_id;

  update public.session_block_exercises e
     set order_idx = (t.n - 1)::smallint
    from unnest(p_dest_ids) with ordinality as t(id, n)
   where e.id = t.id
     and e.block_id = p_to_block_id;
end;
$$;
comment on function public.move_session_task(uuid, uuid, uuid[]) is
  'F12.2b — mueve una tarea a otro bloque (misma sesión, lo valida el trigger) y reindexa el destino a 0..n. RLS de session_block_exercises = gate.';
grant execute on function public.move_session_task(uuid, uuid, uuid[]) to authenticated;
