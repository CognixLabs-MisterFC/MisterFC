-- Un entrenador solo abre hilo con jugadores DE SU equipo (mig 20261080000000).
--
-- Lo que se prueba:
--   [1] El ayudante del equipo A abre hilo con un jugador DE SU equipo. Ancla
--       positiva y va primero: sin ella, los bloques de abajo pasarían aunque la
--       policy prohibiera absolutamente todo.
--   [2] El mismo ayudante NO puede con un jugador del equipo B. Es el fallo.
--   [3] Ni con un jugador SIN equipo. A ese solo lo alcanza la dirección, que es
--       justo lo que su familia ve en su lista de destinatarios.
--   [4] La dirección sigue alcanzando a cualquiera, incluido el que no tiene
--       equipo: la rama 1 no se toca.
--   [5] La coordinación sigue igual y sigue acotada: el coordinador del equipo B
--       puede con el jugador de B y no con el de A.
--   [6] UN HILO YA EXISTENTE NO SE ROMPE. Se fabrica uno que la regla nueva
--       prohibiría y su coach sigue leyendo y escribiendo: esta policy es de
--       INSERT, y lo vivo va por `user_is_conversation_participant`.
--   [7] La simetría con el otro extremo: `family_conversation_recipients` del
--       jugador de A ofrece al ayudante de A y NO al de B. Las dos reglas dicen
--       lo mismo, que es lo que convertía esto en un fallo y no en una decisión.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('cc000000-0000-4000-8000-000000000001', 'Club Hilo', 'club-hilo');

insert into public.categories (id, club_id, name) values
  ('cc0d0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'Cadete');

insert into public.teams (id, category_id, name, format, color, season) values
  ('cc0e0000-0000-4000-8000-000000000001', 'cc0d0000-0000-4000-8000-000000000001', 'Equipo A', 'F7', '#10B981', '2025-26'),
  ('cc0e0000-0000-4000-8000-000000000002', 'cc0d0000-0000-4000-8000-000000000001', 'Equipo B', 'F7', '#10B981', '2025-26');

--  pA  = jugador del equipo A      · pB = jugador del equipo B
--  pSin = jugador SIN equipo: el caso que solo alcanza la direccion
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('cc0b0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'Ana',  'DeA',  (current_date - interval '13 years')::date),
  ('cc0b0000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001', 'Beni', 'DeB',  (current_date - interval '13 years')::date),
  ('cc0b0000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000001', 'Sole', 'SinEq',(current_date - interval '13 years')::date);

select pg_temp.new_test_user('cc0a0000-0000-4000-8000-000000000001', 'director@hilo.test', '{"full_name": "Directora"}'::jsonb);
select pg_temp.new_test_user('cc0a0000-0000-4000-8000-000000000002', 'ayuda@hilo.test',    '{"full_name": "Ayudante A"}'::jsonb);
select pg_temp.new_test_user('cc0a0000-0000-4000-8000-000000000003', 'ayudb@hilo.test',    '{"full_name": "Ayudante B"}'::jsonb);
select pg_temp.new_test_user('cc0a0000-0000-4000-8000-000000000004', 'coordb@hilo.test',   '{"full_name": "Coordinador B"}'::jsonb);
select pg_temp.new_test_user('cc0a0000-0000-4000-8000-000000000005', 'tutora@hilo.test',   '{"full_name": "Tutora de Ana"}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('cc0f0000-0000-4000-8000-000000000001', 'cc0a0000-0000-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'director'),
  ('cc0f0000-0000-4000-8000-000000000002', 'cc0a0000-0000-4000-8000-000000000002', 'cc000000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('cc0f0000-0000-4000-8000-000000000003', 'cc0a0000-0000-4000-8000-000000000003', 'cc000000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('cc0f0000-0000-4000-8000-000000000004', 'cc0a0000-0000-4000-8000-000000000004', 'cc000000-0000-4000-8000-000000000001', 'coordinador'),
  ('cc0f0000-0000-4000-8000-000000000005', 'cc0a0000-0000-4000-8000-000000000005', 'cc000000-0000-4000-8000-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('cc0e0000-0000-4000-8000-000000000001', 'cc0f0000-0000-4000-8000-000000000002', 'entrenador_ayudante'),
  ('cc0e0000-0000-4000-8000-000000000002', 'cc0f0000-0000-4000-8000-000000000003', 'entrenador_ayudante'),
  ('cc0e0000-0000-4000-8000-000000000002', 'cc0f0000-0000-4000-8000-000000000004', 'coordinador');

insert into public.team_members (player_id, team_id) values
  ('cc0b0000-0000-4000-8000-000000000001', 'cc0e0000-0000-4000-8000-000000000001'),
  ('cc0b0000-0000-4000-8000-000000000002', 'cc0e0000-0000-4000-8000-000000000002');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('cc0b0000-0000-4000-8000-000000000001', 'cc0a0000-0000-4000-8000-000000000005', 'parent');

create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- Abre un hilo como `p_sub` y dice si lo dejaron. Un 42501 es un NO, no un fallo
-- del test; cualquier otro error sube, porque seria un fixture roto disfrazado.
create or replace function pg_temp.puede_abrir(p_sub text, p_player uuid) returns boolean
language plpgsql as $$
declare v_id uuid;
begin
  perform pg_temp.como(p_sub);
  begin
    insert into public.conversations (club_id, player_id, coach_profile_id)
    values ('cc000000-0000-4000-8000-000000000001', p_player, p_sub::uuid)
    returning id into v_id;
  exception when insufficient_privilege then
    reset role;
    return false;
  end;
  reset role;
  return v_id is not null;
end $$;

-- ── [1] El ayudante de A, con un jugador de A ────────────────────────────────
do $$
begin
  if not pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000002',
                             'cc0b0000-0000-4000-8000-000000000001') then
    raise exception '[1] el ayudante NO pudo abrir hilo con un jugador de SU equipo: se ha cerrado de mas';
  end if;
end $$;

-- ── [2] El mismo, con un jugador de OTRO equipo ──────────────────────────────
do $$
begin
  if pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000002',
                         'cc0b0000-0000-4000-8000-000000000002') then
    raise exception '[2] el ayudante de A abrio hilo con un jugador del equipo B';
  end if;
end $$;

-- ── [3] Y con uno sin equipo ─────────────────────────────────────────────────
do $$
begin
  if pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000002',
                         'cc0b0000-0000-4000-8000-000000000003') then
    raise exception '[3] el ayudante abrio hilo con un jugador SIN equipo';
  end if;
end $$;

-- ── [4] La direccion alcanza a cualquiera ────────────────────────────────────
do $$
begin
  if not pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000001',
                             'cc0b0000-0000-4000-8000-000000000002') then
    raise exception '[4] la direccion no pudo con un jugador del equipo B';
  end if;
  if not pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000001',
                             'cc0b0000-0000-4000-8000-000000000003') then
    raise exception '[4] la direccion no pudo con el jugador SIN equipo, que es a quien solo alcanza ella';
  end if;
end $$;

-- ── [5] La coordinacion, igual que antes y acotada igual ─────────────────────
do $$
begin
  if not pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000004',
                             'cc0b0000-0000-4000-8000-000000000002') then
    raise exception '[5] el coordinador del equipo B no pudo con el jugador de B';
  end if;
  if pg_temp.puede_abrir('cc0a0000-0000-4000-8000-000000000004',
                         'cc0b0000-0000-4000-8000-000000000001') then
    raise exception '[5] el coordinador del equipo B pudo con el jugador del equipo A';
  end if;
end $$;

-- ── [6] Un hilo YA EXISTENTE no se rompe ─────────────────────────────────────
--
-- El de B con la jugadora de A: exactamente lo que [2] ya no deja abrir. Se
-- fabrica como postgres, saltandose la RLS, que es como estan los hilos que ya
-- existian antes de esta migracion.
do $$
declare v_conv uuid; v_lee int; v_msg uuid;
begin
  insert into public.conversations (club_id, player_id, coach_profile_id)
  values ('cc000000-0000-4000-8000-000000000001',
          'cc0b0000-0000-4000-8000-000000000001',
          'cc0a0000-0000-4000-8000-000000000003')
  returning id into v_conv;

  perform pg_temp.como('cc0a0000-0000-4000-8000-000000000003');
  select count(*) into v_lee from public.conversations c where c.id = v_conv;
  insert into public.messages (conversation_id, sender_profile_id, body)
  values (v_conv, 'cc0a0000-0000-4000-8000-000000000003', 'sigo aqui')
  returning id into v_msg;
  reset role;

  if v_lee <> 1 then
    raise exception '[6] el coach dejo de LEER su hilo existente (cnt=%)', v_lee;
  end if;
  if v_msg is null then
    raise exception '[6] el coach dejo de ESCRIBIR en su hilo existente';
  end if;
end $$;

-- ── [7] El otro extremo del hilo dice lo mismo ───────────────────────────────
do $$
declare v_a int; v_b int;
begin
  perform pg_temp.como('cc0a0000-0000-4000-8000-000000000005');
  select count(*) into v_a
    from public.family_conversation_recipients('cc0b0000-0000-4000-8000-000000000001') r
   where r.profile_id = 'cc0a0000-0000-4000-8000-000000000002';
  select count(*) into v_b
    from public.family_conversation_recipients('cc0b0000-0000-4000-8000-000000000001') r
   where r.profile_id = 'cc0a0000-0000-4000-8000-000000000003';
  reset role;

  if v_a <> 1 then
    raise exception '[7] la familia de Ana no puede escribir al ayudante de SU equipo (cnt=%)', v_a;
  end if;
  if v_b <> 0 then
    raise exception '[7] la familia de Ana puede escribir al ayudante del equipo B (cnt=%): las dos reglas no dicen lo mismo', v_b;
  end if;
end $$;

rollback;
