-- Tests F12.2b (fix) — move_session_task + block_id mutable dentro de la misma
-- sesión (migración 20260718000000_session_move_task.sql).
--
-- Cubre: mover una tarea del bloque b1 al b2 (misma sesión) → block_id cambia y el
-- destino queda reindexado; cruzar a un bloque de OTRA sesión → bloqueado; un
-- jugador (no editor) no puede mover (RLS). Transaccional.
-- IDs (HEX): owner d, jugador f; sesión a1 (b1,b2) + sesión a2 (bx); tareas c1/c2.

begin;

insert into public.clubs (id, name, slug) values
  ('5e570000-0000-4000-8000-000000000001', 'Club Move', 'club-move');
insert into public.categories (id, club_id, name, kind) values
  ('5e571000-0000-4000-8000-000000000001', '5e570000-0000-4000-8000-000000000001', 'Infantil', 'infantil');
insert into public.teams (id, category_id, name, format, color, season) values
  ('5e572000-0000-4000-8000-000000000001', '5e571000-0000-4000-8000-000000000001', 'Team M', 'F11', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('5e573000-0000-4000-8000-00000000000f', '5e570000-0000-4000-8000-000000000001', 'Fede', 'M', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('5e572000-0000-4000-8000-000000000001', '5e573000-0000-4000-8000-00000000000f', '2025-09-01');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('5ea70000-0000-4000-8000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@move.test', now(), '{}'::jsonb, now(), now()),
  ('5ea70000-0000-4000-8000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jug@move.test',   now(), '{}'::jsonb, now(), now());
insert into public.memberships (id, profile_id, club_id, role) values
  ('5e575000-0000-4000-8000-00000000000d', '5ea70000-0000-4000-8000-00000000000d', '5e570000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5e575000-0000-4000-8000-00000000000f', '5ea70000-0000-4000-8000-00000000000f', '5e570000-0000-4000-8000-000000000001', 'jugador');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('5e573000-0000-4000-8000-00000000000f', '5ea70000-0000-4000-8000-00000000000f', 'self');

update public.capabilities set granted = true
  where membership_id = '5e575000-0000-4000-8000-00000000000d' and capability_name = 'can_create_sessions';

alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status) values
  ('5e97e000-0000-4000-8000-000000000001', '5ea70000-0000-4000-8000-00000000000d', '5e570000-0000-4000-8000-000000000001', 'Ej 1', 'published'),
  ('5e97e000-0000-4000-8000-000000000002', '5ea70000-0000-4000-8000-00000000000d', '5e570000-0000-4000-8000-000000000001', 'Ej 2', 'published');
alter table public.exercises enable trigger trg_exercises_validate;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"5ea70000-0000-4000-8000-00000000000d","role":"authenticated"}';

-- Sesión a1 con bloques b1,b2; sesión a2 con bloque bx.
insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date) values
  ('5e500000-0000-4000-8000-0000000000a1', '5ea70000-0000-4000-8000-00000000000d', '5e570000-0000-4000-8000-000000000001', '5e572000-0000-4000-8000-000000000001', '2026-10-01'),
  ('5e500000-0000-4000-8000-0000000000a2', '5ea70000-0000-4000-8000-00000000000d', '5e570000-0000-4000-8000-000000000001', '5e572000-0000-4000-8000-000000000001', '2026-10-02');

insert into public.session_blocks (id, session_id, club_id, block_type, order_idx) values
  ('5e5b0000-0000-4000-8000-0000000000b1', '5e500000-0000-4000-8000-0000000000a1', '5e570000-0000-4000-8000-000000000001', 'calentamiento', 0),
  ('5e5b0000-0000-4000-8000-0000000000b2', '5e500000-0000-4000-8000-0000000000a1', '5e570000-0000-4000-8000-000000000001', 'principal', 1),
  ('5e5b0000-0000-4000-8000-0000000000b9', '5e500000-0000-4000-8000-0000000000a2', '5e570000-0000-4000-8000-000000000001', 'principal', 0);

-- b1 tiene c1 (idx0) y c2 (idx1); b2 vacío.
insert into public.session_block_exercises (id, block_id, exercise_id, order_idx) values
  ('5e5e0000-0000-4000-8000-0000000000c1', '5e5b0000-0000-4000-8000-0000000000b1', '5e97e000-0000-4000-8000-000000000001', 0),
  ('5e5e0000-0000-4000-8000-0000000000c2', '5e5b0000-0000-4000-8000-0000000000b1', '5e97e000-0000-4000-8000-000000000002', 1);

-- ── T-move: mover c1 a b2 (destino solo c1) → block_id=b2, order_idx=0 ────────
do $$
declare v_block uuid; v_idx int;
begin
  perform public.move_session_task(
    '5e5e0000-0000-4000-8000-0000000000c1',
    '5e5b0000-0000-4000-8000-0000000000b2',
    array['5e5e0000-0000-4000-8000-0000000000c1']::uuid[]
  );
  select block_id, order_idx into v_block, v_idx
    from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000c1';
  if v_block <> '5e5b0000-0000-4000-8000-0000000000b2' or v_idx <> 0 then
    raise exception 'FAIL [move]: c1 quedó block=% idx=% (esperaba b2/0)', v_block, v_idx;
  end if;
end $$;

-- ── T-cross-session: mover c2 a bx (otra sesión) → bloqueado por el trigger ───
do $$
declare ok boolean := false;
begin
  begin
    perform public.move_session_task(
      '5e5e0000-0000-4000-8000-0000000000c2',
      '5e5b0000-0000-4000-8000-0000000000b9',
      array['5e5e0000-0000-4000-8000-0000000000c2']::uuid[]
    );
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [cross-session]: se pudo mover a otra sesión'; end if;
end $$;

-- ── T-rls: el jugador no puede mover (RLS) → c2 sigue en b1 ───────────────────
do $$
declare v_block uuid;
begin
  set local "request.jwt.claims" = '{"sub":"5ea70000-0000-4000-8000-00000000000f","role":"authenticated"}';
  perform public.move_session_task(
    '5e5e0000-0000-4000-8000-0000000000c2',
    '5e5b0000-0000-4000-8000-0000000000b2',
    array['5e5e0000-0000-4000-8000-0000000000c2']::uuid[]
  );
  select block_id into v_block from public.session_block_exercises where id = '5e5e0000-0000-4000-8000-0000000000c2';
  if v_block <> '5e5b0000-0000-4000-8000-0000000000b1' then
    raise exception 'FAIL [rls-move]: el jugador movió la tarea (quedó en %)', v_block;
  end if;
end $$;

reset role;

rollback;
