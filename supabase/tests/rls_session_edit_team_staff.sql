-- Tests FIX (Opción A) — el STAFF del equipo de una sesión puede editarla:
-- cabecera (sessions_update), publicar, y añadir ejercicio/jugada (hijas vía
-- user_can_edit_session). Migración 20260811000000.
--
-- Escenario del bug real: admin del club CREA la sesión de un equipo; un entrenador
-- con rol de CLUB = ayudante pero PRINCIPAL del equipo debe poder editarla.
-- Cubre: coachP (ayudante club, principal Team A) edita cabecera + publica + añade
-- ejercicio + añade jugada en sesión de SU equipo creada por el admin; coachOther
-- (principal de OTRO equipo) no puede; la PLANTILLA (team_id NULL) sigue owner∪admin.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('5dc00000-0000-4000-8000-000000000001', 'Club Edit A', 'club-edit-a');

insert into public.categories (id, club_id, name) values
  ('5dca0000-0000-4000-8000-000000000001', '5dc00000-0000-4000-8000-000000000001', 'Cat A'),
  ('5dca0000-0000-4000-8000-000000000002', '5dc00000-0000-4000-8000-000000000001', 'Cat A2');

insert into public.teams (id, category_id, name, format, color, season) values
  ('5d700000-0000-4000-8000-000000000001', '5dca0000-0000-4000-8000-000000000001', 'Team A',  'F11', '#10B981', '2025-26'),
  ('5d700000-0000-4000-8000-000000000002', '5dca0000-0000-4000-8000-000000000002', 'Team A2', 'F11', '#0EA5E9', '2025-26');

select pg_temp.new_test_user('5da00000-0000-4000-8000-00000000000a', 'admin@edit.test', '{}'::jsonb);
select pg_temp.new_test_user('5da00000-0000-4000-8000-00000000000c', 'coachP@edit.test', '{}'::jsonb);
select pg_temp.new_test_user('5da00000-0000-4000-8000-00000000000d', 'coachO@edit.test', '{}'::jsonb);

-- coachP y coachOther tienen rol de CLUB = entrenador_ayudante (¡no admin!).
insert into public.memberships (id, profile_id, club_id, role) values
  ('5d550000-0000-4000-8000-00000000000a', '5da00000-0000-4000-8000-00000000000a', '5dc00000-0000-4000-8000-000000000001', 'admin_club'),
  ('5d550000-0000-4000-8000-00000000000c', '5da00000-0000-4000-8000-00000000000c', '5dc00000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('5d550000-0000-4000-8000-00000000000d', '5da00000-0000-4000-8000-00000000000d', '5dc00000-0000-4000-8000-000000000001', 'entrenador_ayudante');

-- coachP = PRINCIPAL de Team A; coachOther = PRINCIPAL de Team A2 (otro equipo).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('5d700000-0000-4000-8000-000000000001', '5d550000-0000-4000-8000-00000000000c', 'entrenador_principal'),
  ('5d700000-0000-4000-8000-000000000002', '5d550000-0000-4000-8000-00000000000d', 'entrenador_principal');

-- Ejercicio + jugada publicada + selección en el playbook de Team A (triggers off).
alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status) values
  ('5d9e0000-0000-4000-8000-000000000001', '5da00000-0000-4000-8000-00000000000a', '5dc00000-0000-4000-8000-000000000001', 'Rondo 5v2', 'published');
alter table public.exercises enable trigger trg_exercises_validate;

alter table public.plays disable trigger trg_plays_validate;
insert into public.plays (id, owner_profile_id, club_id, name, play, status) values
  ('5d910000-0000-4000-8000-0000000000b1', '5da00000-0000-4000-8000-00000000000a', '5dc00000-0000-4000-8000-000000000001', 'Play A', '{"version":1,"field":{},"frames":[{"elements":[]}]}'::jsonb, 'published');
alter table public.plays enable trigger trg_plays_validate;

alter table public.team_plays disable trigger trg_team_plays_validate;
insert into public.team_plays (id, club_id, team_id, play_id, shared_with_family) values
  ('5d710000-0000-4000-8000-0000000000b1', '5dc00000-0000-4000-8000-000000000001', '5d700000-0000-4000-8000-000000000001', '5d910000-0000-4000-8000-0000000000b1', false);
alter table public.team_plays enable trigger trg_team_plays_validate;

-- Sesión de Team A CREADA POR EL ADMIN (owner=admin) + plantilla (team_id NULL).
alter table public.sessions disable trigger trg_sessions_validate;
insert into public.sessions (id, owner_profile_id, club_id, team_id, session_date, visibility, is_template) values
  ('5d500000-0000-4000-8000-0000000000c2', '5da00000-0000-4000-8000-00000000000a', '5dc00000-0000-4000-8000-000000000001', '5d700000-0000-4000-8000-000000000001', '2026-10-02', 'staff', false),
  ('5d500000-0000-4000-8000-0000000000c3', '5da00000-0000-4000-8000-00000000000a', '5dc00000-0000-4000-8000-000000000001', null, null, 'staff', true);
alter table public.sessions enable trigger trg_sessions_validate;

insert into public.session_blocks (id, session_id, club_id, block_type, order_idx) values
  ('5d5b0000-0000-4000-8000-0000000000c2', '5d500000-0000-4000-8000-0000000000c2', '5dc00000-0000-4000-8000-000000000001', 'principal', 0),
  ('5d5b0000-0000-4000-8000-0000000000c3', '5d500000-0000-4000-8000-0000000000c3', '5dc00000-0000-4000-8000-000000000001', 'principal', 0);

-- ─────────────────────────────────────────────────────────────────────────────
-- coachP (ayudante de club, PRINCIPAL de Team A) sobre la sesión de Team A
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- E1: edita la CABECERA (título) → 1 fila (sessions_update con la nueva regla).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.sessions set title = 'Editada por coachP' where id = '5d500000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [E1]: el principal del equipo no pudo editar la cabecera'; end if;
end $$;

-- E2: PUBLICA al equipo (visibility staff→team) → 1 fila.
do $$
declare n int; v text;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.sessions set visibility = 'team' where id = '5d500000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  select visibility into v from public.sessions where id = '5d500000-0000-4000-8000-0000000000c2';
  if n <> 1 or v <> 'team' then raise exception 'FAIL [E2]: el principal del equipo no pudo publicar (n=% v=%)', n, v; end if;
end $$;

-- E3: añade un EJERCICIO al bloque → OK.
do $$
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.session_block_exercises (block_id, session_id, club_id, exercise_id, order_idx)
  values ('5d5b0000-0000-4000-8000-0000000000c2', '5d500000-0000-4000-8000-0000000000c2', '5dc00000-0000-4000-8000-000000000001', '5d9e0000-0000-4000-8000-000000000001', 0);
exception when others then
  raise exception 'FAIL [E3]: el principal del equipo no pudo añadir un ejercicio: %', sqlerrm;
end $$;

-- E4: añade una JUGADA (del playbook de Team A) al bloque → OK.
do $$
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.session_block_plays (block_id, session_id, club_id, play_id, order_idx)
  values ('5d5b0000-0000-4000-8000-0000000000c2', '5d500000-0000-4000-8000-0000000000c2', '5dc00000-0000-4000-8000-000000000001', '5d910000-0000-4000-8000-0000000000b1', 0);
exception when others then
  raise exception 'FAIL [E4]: el principal del equipo no pudo añadir una jugada: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- coachOther (principal de OTRO equipo) sobre la sesión de Team A → bloqueado
-- ─────────────────────────────────────────────────────────────────────────────

-- E5: edita la cabecera → 0 filas (RLS).
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.sessions set title = 'hack' where id = '5d500000-0000-4000-8000-0000000000c2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [E5]: staff de otro equipo editó la cabecera'; end if;
end $$;

-- E6: añade ejercicio → 42501.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    insert into public.session_block_exercises (block_id, session_id, club_id, exercise_id, order_idx)
    values ('5d5b0000-0000-4000-8000-0000000000c2', '5d500000-0000-4000-8000-0000000000c2', '5dc00000-0000-4000-8000-000000000001', '5d9e0000-0000-4000-8000-000000000001', 5);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [E6]: staff de otro equipo añadió un ejercicio'; end if;
end $$;

-- E7: añade jugada → 42501.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    insert into public.session_block_plays (block_id, session_id, club_id, play_id, order_idx)
    values ('5d5b0000-0000-4000-8000-0000000000c2', '5d500000-0000-4000-8000-0000000000c2', '5dc00000-0000-4000-8000-000000000001', '5d910000-0000-4000-8000-0000000000b1', 5);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [E7]: staff de otro equipo añadió una jugada'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Plantilla (team_id NULL) → sigue owner ∪ admin: coachP NO puede
-- ─────────────────────────────────────────────────────────────────────────────

-- E8: coachP edita la cabecera de la plantilla → 0 filas.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  update public.sessions set title = 'hack plantilla' where id = '5d500000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [E8]: el staff de equipo editó una plantilla (debe ser owner∪admin)'; end if;
end $$;

-- E9: coachP añade ejercicio a un bloque de la plantilla → 42501.
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    insert into public.session_block_exercises (block_id, session_id, club_id, exercise_id, order_idx)
    values ('5d5b0000-0000-4000-8000-0000000000c3', '5d500000-0000-4000-8000-0000000000c3', '5dc00000-0000-4000-8000-000000000001', '5d9e0000-0000-4000-8000-000000000001', 0);
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [E9]: el staff de equipo editó una plantilla (hija)'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Regresión: admin (owner) sigue pudiendo editar la plantilla → 1 fila
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"5da00000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.sessions set title = 'Plantilla admin' where id = '5d500000-0000-4000-8000-0000000000c3';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [A0]: el admin/owner no pudo editar la plantilla'; end if;
end $$;

reset role;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS edición de sesión por staff del equipo (Opción A) pasaron.'
\echo '──────────────────────────────────────────────'
