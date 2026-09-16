-- La familia abre hilo, y el que se va del club deja de leerlo (mig 20261076000000).
-- Cubre:
--   [1] La LISTA: el tutor ve a la dirección del club y a los asignados a SU equipo.
--   [2] Y a NADIE MÁS: ni staff de otro equipo, ni otra familia, ni a sí mismo.
--   [3] Deduplicado: quien es director Y entrena al equipo sale UNA vez, como 'team'.
--   [4] Crear el hilo es idempotente, y el hilo que ya existe vuelve en la lista.
--   [5] La regla se aplica AL CREAR, no solo al listar: un destinatario que no está
--       en la lista es 'forbidden' aunque la pantalla lo pintara.
--   [6] La puerta: sin sesión, y un tutor de OTRO jugador.
--   [7] EL AGUJERO QUE SE CIERRA: el entrenador que se va del club deja de ver el
--       hilo, de leer los mensajes y de contarlos como no leídos. Los TRES caminos.
--   [8] La familia NO pierde su historial por el arreglo de [7] (es asimétrico a
--       propósito).
--   [9] CANDADO de privilegios: las dos RPC cerradas a anon y a PUBLIC.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (lección de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('fc000000-0000-4000-8000-000000000001', 'Club FC', 'club-fc');

insert into public.seasons (id, club_id, label, status) values
  ('fc0c0000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', '2026-27', 'active');

insert into public.categories (id, club_id, name) values
  ('fc0d0000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'Cadete');

-- SU equipo (t1) y OTRO equipo (t2, del mismo club).
insert into public.teams (id, club_id, category_id, name, format, season) values
  ('fc0e0000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001',
   'fc0d0000-0000-4000-8000-000000000001', 'Cadete A', 'F11', '2026-27'),
  ('fc0e0000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000001',
   'fc0d0000-0000-4000-8000-000000000001', 'Cadete B', 'F11', '2026-27');

--  tutor     = el padre del jugador
--  admin     = admin_club          → destinatario 'club'
--  director  = director            → destinatario 'club'
--  mister    = entrenador de SU equipo        → 'team'
--  delegado  = delegado de SU equipo          → 'team' (Jose: "asignados, todos")
--  ajeno     = entrenador del OTRO equipo     → NO
--  dirmister = director Y entrenador de SU equipo → una sola fila, 'team'
--  exmister  = entrenador de SU equipo que SE VA del club
--  tutor2    = tutor de otro jugador
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000001', 'tutor@fc.test', '{"full_name": "Tutor"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000002', 'admin@fc.test', '{"full_name": "Admin"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000003', 'director@fc.test', '{"full_name": "Director"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000004', 'mister@fc.test', '{"full_name": "Mister"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000005', 'delegado@fc.test', '{"full_name": "Delegado"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000006', 'ajeno@fc.test', '{"full_name": "Ajeno"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000007', 'dirmister@fc.test', '{"full_name": "DirMister"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000008', 'exmister@fc.test', '{"full_name": "ExMister"}'::jsonb);
select pg_temp.new_test_user('fc0a0000-0000-4000-8000-000000000009', 'tutor2@fc.test', '{"full_name": "Tutor2"}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('fc0f0000-0000-4000-8000-000000000001', 'fc0a0000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'jugador',             null),
  ('fc0f0000-0000-4000-8000-000000000002', 'fc0a0000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000001', 'admin_club',          null),
  ('fc0f0000-0000-4000-8000-000000000003', 'fc0a0000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000001', 'director',            null),
  ('fc0f0000-0000-4000-8000-000000000004', 'fc0a0000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000001', 'entrenador_principal',null),
  ('fc0f0000-0000-4000-8000-000000000005', 'fc0a0000-0000-4000-8000-000000000005', 'fc000000-0000-4000-8000-000000000001', 'entrenador_ayudante', null),
  ('fc0f0000-0000-4000-8000-000000000006', 'fc0a0000-0000-4000-8000-000000000006', 'fc000000-0000-4000-8000-000000000001', 'entrenador_principal',null),
  ('fc0f0000-0000-4000-8000-000000000007', 'fc0a0000-0000-4000-8000-000000000007', 'fc000000-0000-4000-8000-000000000001', 'director',            null),
  ('fc0f0000-0000-4000-8000-000000000008', 'fc0a0000-0000-4000-8000-000000000008', 'fc000000-0000-4000-8000-000000000001', 'entrenador_principal',null),
  ('fc0f0000-0000-4000-8000-000000000009', 'fc0a0000-0000-4000-8000-000000000009', 'fc000000-0000-4000-8000-000000000001', 'jugador',             null);

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('fc0b0000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', 'Hijo', 'Fc', (current_date - interval '14 years')::date),
  ('fc0b0000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000001', 'Otro', 'Fc', (current_date - interval '14 years')::date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('fc0b0000-0000-4000-8000-000000000001', 'fc0a0000-0000-4000-8000-000000000001', 'parent'),
  ('fc0b0000-0000-4000-8000-000000000002', 'fc0a0000-0000-4000-8000-000000000009', 'parent');

insert into public.team_members (player_id, team_id) values
  ('fc0b0000-0000-4000-8000-000000000001', 'fc0e0000-0000-4000-8000-000000000001'),
  ('fc0b0000-0000-4000-8000-000000000002', 'fc0e0000-0000-4000-8000-000000000002');

insert into public.team_staff (team_id, membership_id, staff_role, left_at) values
  ('fc0e0000-0000-4000-8000-000000000001', 'fc0f0000-0000-4000-8000-000000000004', 'entrenador_principal', null),
  ('fc0e0000-0000-4000-8000-000000000001', 'fc0f0000-0000-4000-8000-000000000005', 'delegado',             null),
  ('fc0e0000-0000-4000-8000-000000000001', 'fc0f0000-0000-4000-8000-000000000007', 'entrenador_ayudante',  null),
  ('fc0e0000-0000-4000-8000-000000000001', 'fc0f0000-0000-4000-8000-000000000008', 'entrenador_ayudante',  null),
  ('fc0e0000-0000-4000-8000-000000000002', 'fc0f0000-0000-4000-8000-000000000006', 'entrenador_principal', null);

-- Helper: ponerse en la piel de alguien.
create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ── [1] La lista que ve el tutor ─────────────────────────────────────────────
do $$
declare v text;
begin
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  -- Ordenado por profile_id y NO por nombre: el orden alfabetico depende de la
  -- colacion de la base ("Director" vs "DirMister" cambia de sitio), y el CI no tiene
  -- por que llevar la misma que produccion. Por uuid es el mismo en todas partes.
  select string_agg(r.full_name || ':' || r.kind, ' | ' order by r.profile_id)
    into v
    from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r;
  -- admin y director por el club; mister, delegado y dirmister por SU equipo.
  if v is distinct from
     'Admin:club | Director:club | Mister:team | Delegado:team | DirMister:team | ExMister:team'
  then
    raise exception '[1] la lista no es la esperada: %', v;
  end if;
  reset role;
end $$;

-- ── [2] Y nadie más ──────────────────────────────────────────────────────────
do $$
declare v_ajeno int; v_otra int; v_yo int;
begin
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  select count(*) into v_ajeno from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r
    where r.profile_id = 'fc0a0000-0000-4000-8000-000000000006';  -- staff del OTRO equipo
  select count(*) into v_otra  from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r
    where r.profile_id = 'fc0a0000-0000-4000-8000-000000000009';  -- otra familia
  select count(*) into v_yo    from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r
    where r.profile_id = 'fc0a0000-0000-4000-8000-000000000001';  -- el propio tutor
  if v_ajeno <> 0 then raise exception '[2] sale el staff de OTRO equipo'; end if;
  if v_otra  <> 0 then raise exception '[2] sale OTRA familia'; end if;
  if v_yo    <> 0 then raise exception '[2] el tutor se ve a si mismo'; end if;
  reset role;
end $$;

-- ── [3] El que es director Y entrenador sale una sola vez, como 'team' ──────
do $$
declare v_n int; v_kind text;
begin
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  select count(*), min(r.kind) into v_n, v_kind
    from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r
   where r.profile_id = 'fc0a0000-0000-4000-8000-000000000007';
  if v_n <> 1 then raise exception '[3] dirmister sale % veces, esperaba 1', v_n; end if;
  if v_kind <> 'team' then raise exception '[3] dirmister sale como %, esperaba team', v_kind; end if;
  reset role;
end $$;

-- ── [4] Crear es idempotente, y el hilo vuelve en la lista ──────────────────
do $$
declare a uuid; b uuid; v_conv uuid; v_filas int;
begin
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  a := public.family_start_conversation('fc0b0000-0000-4000-8000-000000000001',
                                        'fc0a0000-0000-4000-8000-000000000004');
  b := public.family_start_conversation('fc0b0000-0000-4000-8000-000000000001',
                                        'fc0a0000-0000-4000-8000-000000000004');
  if a is null then raise exception '[4] no devolvio hilo'; end if;
  if a <> b then raise exception '[4] dos toques crearon dos hilos: % y %', a, b; end if;

  select count(*) into v_filas from public.conversations
   where player_id='fc0b0000-0000-4000-8000-000000000001'
     and coach_profile_id='fc0a0000-0000-4000-8000-000000000004';
  if v_filas <> 1 then raise exception '[4] hay % filas en conversations, esperaba 1', v_filas; end if;

  select r.conversation_id into v_conv
    from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r
   where r.profile_id = 'fc0a0000-0000-4000-8000-000000000004';
  if v_conv is distinct from a then
    raise exception '[4] la lista no trae el hilo existente (trajo %)', v_conv;
  end if;
  reset role;
end $$;

-- ── [5] La regla se aplica AL CREAR, no solo al listar ──────────────────────
--
-- Con un FLAG y no con un `raise` dentro del bloque protegido: un raise ahi lo caza
-- su propio `exception when others` y se reporta como "error inesperado" — o peor, si
-- el texto coincidiera con 'forbidden', pasaria por bueno.
do $$
declare v_colo boolean; v_msg text;
begin
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');

  v_colo := false;
  begin
    perform public.family_start_conversation('fc0b0000-0000-4000-8000-000000000001',
                                             'fc0a0000-0000-4000-8000-000000000006');
    v_colo := true;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_colo then raise exception '[5] dejo abrir hilo con el staff de OTRO equipo'; end if;
  if v_msg <> 'forbidden' then raise exception '[5] error inesperado (staff ajeno): %', v_msg; end if;

  v_colo := false;
  begin
    perform public.family_start_conversation('fc0b0000-0000-4000-8000-000000000001',
                                             'fc0a0000-0000-4000-8000-000000000009');
    v_colo := true;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_colo then raise exception '[5] dejo abrir hilo con OTRA familia'; end if;
  if v_msg <> 'forbidden' then raise exception '[5] error inesperado (otra familia): %', v_msg; end if;

  reset role;
end $$;

-- ── [6] La puerta ───────────────────────────────────────────────────────────
do $$
declare v_colo boolean; v_msg text;
begin
  -- Sin sesion (authenticated con claims vacias): no_session.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{}', true);
  v_colo := false;
  begin
    perform public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001');
    v_colo := true;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_colo then raise exception '[6] sin sesion devolvio destinatarios'; end if;
  if v_msg <> 'no_session' then raise exception '[6] error inesperado sin sesion: %', v_msg; end if;

  -- El tutor de OTRO jugador: forbidden.
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000009');
  v_colo := false;
  begin
    perform public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001');
    v_colo := true;
  exception when others then
    v_msg := sqlerrm;
  end;
  if v_colo then raise exception '[6] un tutor ajeno vio los destinatarios'; end if;
  if v_msg <> 'forbidden' then raise exception '[6] error inesperado (tutor ajeno): %', v_msg; end if;

  reset role;
end $$;

-- ── [7] EL AGUJERO: el que se va del club deja de leer, por los TRES caminos ─
--
-- Arreglar solo la policy habria sido cosmetico: el ex-entrenador no veria el hilo
-- en su bandeja, pero seguiria leyendo `messages` con el id en la mano y le seguiria
-- subiendo el contador de no leidos.
do $$
declare v_conv uuid; v_ve int; v_msgs int; v_badge int;
begin
  -- exmister abre hilo con la familia mientras AUN es del club, y le escribe.
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000008');
  insert into public.conversations (club_id, player_id, coach_profile_id)
  values ('fc000000-0000-4000-8000-000000000001',
          'fc0b0000-0000-4000-8000-000000000001',
          'fc0a0000-0000-4000-8000-000000000008')
  returning id into v_conv;
  insert into public.messages (conversation_id, sender_profile_id, body)
  values (v_conv, 'fc0a0000-0000-4000-8000-000000000008', 'hola');
  reset role;

  -- Y la FAMILIA le contesta. Sin esto el contador de no leidos no probaba nada: el
  -- unico mensaje lo habria escrito el propio entrenador, y `user_unread_...` excluye
  -- los propios — habria dado 0 por el motivo equivocado.
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  insert into public.messages (conversation_id, sender_profile_id, body)
  values (v_conv, 'fc0a0000-0000-4000-8000-000000000001', 'buenas');
  reset role;
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000008');

  -- ANTES de irse: lo ve, lo lee y le cuenta.
  select count(*) into v_ve    from public.conversations where id = v_conv;
  select count(*) into v_msgs  from public.messages where conversation_id = v_conv;
  if v_ve = 0 or v_msgs = 0 then
    raise exception '[7] el entrenador ACTIVO ya no ve su propio hilo (ve=%, msgs=%)', v_ve, v_msgs;
  end if;
  reset role;

  -- Se va del club.
  update public.memberships set left_at = now()
   where id = 'fc0f0000-0000-4000-8000-000000000008';

  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000008');
  select count(*) into v_ve   from public.conversations where id = v_conv;
  select count(*) into v_msgs from public.messages where conversation_id = v_conv;
  select public.user_unread_conversations_count() into v_badge;

  if v_ve   <> 0 then raise exception '[7] el ex-entrenador SIGUE viendo el hilo'; end if;
  if v_msgs <> 0 then raise exception '[7] el ex-entrenador SIGUE leyendo los mensajes'; end if;
  if v_badge <> 0 then raise exception '[7] al ex-entrenador le sigue contando el badge (%)', v_badge; end if;
  reset role;

  -- Y deja de salir como destinatario para la familia.
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  select count(*) into v_ve from public.family_conversation_recipients('fc0b0000-0000-4000-8000-000000000001') r
   where r.profile_id = 'fc0a0000-0000-4000-8000-000000000008';
  if v_ve <> 0 then raise exception '[7] el ex-entrenador sigue en la lista de destinatarios'; end if;
  reset role;
end $$;

-- ── [8] La familia NO pierde su historial (asimetria deliberada) ────────────
do $$
declare v_ve int; v_msgs int;
begin
  perform pg_temp.como('fc0a0000-0000-4000-8000-000000000001');
  select count(*) into v_ve from public.conversations
   where player_id = 'fc0b0000-0000-4000-8000-000000000001'
     and coach_profile_id = 'fc0a0000-0000-4000-8000-000000000008';
  select count(*) into v_msgs from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.player_id = 'fc0b0000-0000-4000-8000-000000000001'
     and c.coach_profile_id = 'fc0a0000-0000-4000-8000-000000000008';
  if v_ve = 0 then
    raise exception '[8] la familia perdio el hilo con el entrenador que se fue';
  end if;
  if v_msgs = 0 then
    raise exception '[8] la familia perdio los mensajes del entrenador que se fue';
  end if;
  reset role;
end $$;

-- ── [9] Candado de privilegios ──────────────────────────────────────────────
-- Con has_function_privilege, NUNCA provocando el 42501 (BC-1).
do $$
declare r record;
begin
  for r in
    select unnest(array[
      'public.family_conversation_recipients(uuid)',
      'public.family_start_conversation(uuid,uuid)'
    ]) as firma
  loop
    if has_function_privilege('anon', r.firma::regprocedure::oid, 'execute') then
      raise exception '[9] anon puede ejecutar %', r.firma;
    end if;
    if not has_function_privilege('authenticated', r.firma::regprocedure::oid, 'execute') then
      raise exception '[9] authenticated NO puede ejecutar %; la app va con ese rol', r.firma;
    end if;
    if not has_function_privilege('service_role', r.firma::regprocedure::oid, 'execute') then
      raise exception '[9] service_role NO puede ejecutar %', r.firma;
    end if;
  end loop;
end $$;

rollback;
