-- La lista de destinatarios y el gate del hilo comparten predicado (mig 20261082).
--
-- Lo que se prueba:
--   [1] LA INVARIANTE: para cada usuario y cada jugador, `staff_conversation_players`
--       contiene al jugador si y solo si `user_can_open_conversation_with` lo permite.
--       Es el bloque que importa: si alguien reescribe una de las dos reglas, aquí se
--       ve, aunque los demás bloques sigan pasando.
--   [2] Y en números: el ayudante del equipo A ve a los suyos y no al de B; la
--       dirección los ve a todos. Ancla positiva antes que cualquier ausencia.
--   [3] La lista quita además al de baja del club y al suprimido — Y el predicado SÍ
--       los deja pasar. Eso prueba que ese filtro es de la LISTA y no del permiso,
--       que es justo como se decidió.
--   [4] La puerta de la RPC: sin sesión, `no_session`; de otro club, `forbidden`.
--   [5] La policy usa el predicado de verdad: lo que él prohíbe sigue dando 42501 al
--       insertar. Sin esto, [1] podría pasar con una policy que ya no lo llama.
--   [6] ACL: anon no ejecuta ninguna de las dos, authenticated sí, PUBLIC no.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('da000000-0000-4000-8000-000000000001', 'Club Pred',  'club-pred'),
  ('da000000-0000-4000-8000-000000000002', 'Club Ajeno', 'club-ajeno');

insert into public.categories (id, club_id, name) values
  ('da0d0000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'Cadete');

insert into public.teams (id, category_id, name, format, color, season) values
  ('da0e0000-0000-4000-8000-000000000001', 'da0d0000-0000-4000-8000-000000000001', 'Equipo A', 'F7', '#10B981', '2025-26'),
  ('da0e0000-0000-4000-8000-000000000002', 'da0d0000-0000-4000-8000-000000000001', 'Equipo B', 'F7', '#10B981', '2025-26');

--  1 = del equipo A · 2 = del equipo B · 3 = del A pero DE BAJA · 4 = del A pero SUPRIMIDO
insert into public.players (id, club_id, first_name, last_name, date_of_birth, left_club_at, erased_at) values
  ('da0b0000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'Ana',  'DeA',   (current_date - interval '13 years')::date, null,  null),
  ('da0b0000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000001', 'Beni', 'DeB',   (current_date - interval '13 years')::date, null,  null),
  ('da0b0000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000001', 'Caro', 'Baja',  (current_date - interval '13 years')::date, now(), null),
  ('da0b0000-0000-4000-8000-000000000004', 'da000000-0000-4000-8000-000000000001', 'Dani', 'Supri', (current_date - interval '13 years')::date, null,  now());

select pg_temp.new_test_user('da0a0000-0000-4000-8000-000000000001', 'dir@pred.test',    '{"full_name": "Directora"}'::jsonb);
select pg_temp.new_test_user('da0a0000-0000-4000-8000-000000000002', 'ayuda@pred.test',  '{"full_name": "Ayudante A"}'::jsonb);
select pg_temp.new_test_user('da0a0000-0000-4000-8000-000000000003', 'ayudb@pred.test',  '{"full_name": "Ayudante B"}'::jsonb);
select pg_temp.new_test_user('da0a0000-0000-4000-8000-000000000004', 'ajeno@pred.test',  '{"full_name": "De otro club"}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('da0f0000-0000-4000-8000-000000000001', 'da0a0000-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-000000000001', 'director'),
  ('da0f0000-0000-4000-8000-000000000002', 'da0a0000-0000-4000-8000-000000000002', 'da000000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('da0f0000-0000-4000-8000-000000000003', 'da0a0000-0000-4000-8000-000000000003', 'da000000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('da0f0000-0000-4000-8000-000000000004', 'da0a0000-0000-4000-8000-000000000004', 'da000000-0000-4000-8000-000000000002', 'admin_club');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('da0e0000-0000-4000-8000-000000000001', 'da0f0000-0000-4000-8000-000000000002', 'entrenador_ayudante'),
  ('da0e0000-0000-4000-8000-000000000002', 'da0f0000-0000-4000-8000-000000000003', 'entrenador_ayudante');

insert into public.team_members (player_id, team_id) values
  ('da0b0000-0000-4000-8000-000000000001', 'da0e0000-0000-4000-8000-000000000001'),
  ('da0b0000-0000-4000-8000-000000000002', 'da0e0000-0000-4000-8000-000000000002'),
  ('da0b0000-0000-4000-8000-000000000003', 'da0e0000-0000-4000-8000-000000000001'),
  ('da0b0000-0000-4000-8000-000000000004', 'da0e0000-0000-4000-8000-000000000001');

create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- `reset role` NO borra las claims: `set_config(..., true)` es LOCAL a la
-- transacción y sobrevive. Sin esto, el caso "sin sesión" de [4] se mide con el
-- `sub` del bloque anterior y pasa por el motivo equivocado — que es exactamente lo
-- que hizo la primera versión de este test.
create or replace function pg_temp.sin_sesion() returns void
language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '{}', true);
end $$;

-- ── [1] La invariante: lista ⟺ predicado ─────────────────────────────────────
--
-- Se recorren los 3 usuarios del club × los 4 jugadores. Los de baja y el suprimido
-- se excluyen de la comparación: ahí la lista quita a propósito, y eso lo mira [3].
do $$
declare
  u record; p record;
  v_en_lista boolean; v_permite boolean; v_disc text := '';
begin
  for u in select profile_id from public.memberships
            where club_id = 'da000000-0000-4000-8000-000000000001' order by profile_id
  loop
    for p in select id from public.players
              where club_id = 'da000000-0000-4000-8000-000000000001'
                and left_club_at is null and erased_at is null order by id
    loop
      perform pg_temp.como(u.profile_id::text);
      select exists (
        select 1 from public.staff_conversation_players('da000000-0000-4000-8000-000000000001') r
         where r.id = p.id
      ) into v_en_lista;
      select public.user_can_open_conversation_with(p.id) into v_permite;
      reset role;

      if v_en_lista is distinct from v_permite then
        v_disc := v_disc || format('user=%s player=%s lista=%s permite=%s; ',
                                   u.profile_id, p.id, v_en_lista, v_permite);
      end if;
    end loop;
  end loop;

  if v_disc <> '' then
    raise exception '[1] la lista y el permiso NO dicen lo mismo: %', v_disc;
  end if;
end $$;

-- ── [2] Y en números ─────────────────────────────────────────────────────────
do $$
declare v_n int; v_tiene_a boolean; v_tiene_b boolean;
begin
  perform pg_temp.como('da0a0000-0000-4000-8000-000000000002');   -- ayudante de A
  select count(*) into v_n from public.staff_conversation_players('da000000-0000-4000-8000-000000000001');
  select exists (select 1 from public.staff_conversation_players('da000000-0000-4000-8000-000000000001') r
                  where r.id = 'da0b0000-0000-4000-8000-000000000001') into v_tiene_a;
  select exists (select 1 from public.staff_conversation_players('da000000-0000-4000-8000-000000000001') r
                  where r.id = 'da0b0000-0000-4000-8000-000000000002') into v_tiene_b;
  reset role;

  if not v_tiene_a then
    raise exception '[2] el ayudante de A no ve a la jugadora de SU equipo: se ha cerrado de mas';
  end if;
  if v_tiene_b then
    raise exception '[2] el ayudante de A ve al jugador del equipo B';
  end if;
  if v_n <> 1 then
    raise exception '[2] el ayudante de A ve % jugadores y solo deberia ver 1', v_n;
  end if;

  perform pg_temp.como('da0a0000-0000-4000-8000-000000000001');   -- direccion
  select count(*) into v_n from public.staff_conversation_players('da000000-0000-4000-8000-000000000001');
  reset role;
  if v_n <> 2 then
    raise exception '[2] la direccion ve % jugadores activos y deberia ver los 2', v_n;
  end if;
end $$;

-- ── [3] El filtro de actividad es de la LISTA, no del permiso ────────────────
do $$
declare v_permite_baja boolean; v_permite_supri boolean; v_en_lista int;
begin
  perform pg_temp.como('da0a0000-0000-4000-8000-000000000002');
  select public.user_can_open_conversation_with('da0b0000-0000-4000-8000-000000000003') into v_permite_baja;
  select public.user_can_open_conversation_with('da0b0000-0000-4000-8000-000000000004') into v_permite_supri;
  select count(*) into v_en_lista
    from public.staff_conversation_players('da000000-0000-4000-8000-000000000001') r
   where r.id in ('da0b0000-0000-4000-8000-000000000003', 'da0b0000-0000-4000-8000-000000000004');
  reset role;

  if not v_permite_baja or not v_permite_supri then
    raise exception '[3] el PREDICADO ya excluye al de baja o al suprimido: el filtro se ha colado en el permiso';
  end if;
  if v_en_lista <> 0 then
    raise exception '[3] la lista ofrece al de baja o al suprimido (cnt=%)', v_en_lista;
  end if;
end $$;

-- ── [4] La puerta de la RPC ──────────────────────────────────────────────────
do $$
declare ok_sin boolean := false; ok_ajeno boolean := false;
begin
  -- Sin sesion de verdad: rol Y claims limpias.
  perform pg_temp.sin_sesion();
  if auth.uid() is not null then
    raise exception '[4] el fixture no consiguio quedarse sin sesion';
  end if;
  begin
    perform * from public.staff_conversation_players('da000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm like '%no_session%' then ok_sin := true; else raise; end if;
  end;
  if not ok_sin then raise exception '[4] sin sesion la RPC contesta igual'; end if;

  perform pg_temp.como('da0a0000-0000-4000-8000-000000000004');   -- admin de OTRO club
  begin
    perform * from public.staff_conversation_players('da000000-0000-4000-8000-000000000001');
  exception when others then
    if sqlerrm like '%forbidden%' then ok_ajeno := true; else reset role; raise; end if;
  end;
  reset role;
  if not ok_ajeno then raise exception '[4] un admin de otro club puede pedir la plantilla ajena'; end if;
end $$;

-- ── [5] La policy sigue colgando del predicado ───────────────────────────────
do $$
declare ok boolean := false; v_id uuid;
begin
  perform pg_temp.como('da0a0000-0000-4000-8000-000000000002');
  -- Positivo primero: con el de SU equipo entra.
  insert into public.conversations (club_id, player_id, coach_profile_id)
  values ('da000000-0000-4000-8000-000000000001',
          'da0b0000-0000-4000-8000-000000000001',
          'da0a0000-0000-4000-8000-000000000002')
  returning id into v_id;
  if v_id is null then reset role; raise exception '[5] no pudo abrir hilo con el de su equipo'; end if;

  begin
    insert into public.conversations (club_id, player_id, coach_profile_id)
    values ('da000000-0000-4000-8000-000000000001',
            'da0b0000-0000-4000-8000-000000000002',
            'da0a0000-0000-4000-8000-000000000002');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception '[5] la policy dejo abrir hilo con un jugador que el predicado prohibe';
  end if;
end $$;

-- ── [6] ACL de las dos funciones ─────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('user_can_open_conversation_with', 'staff_conversation_players')
  loop
    if has_function_privilege('anon', r.oid, 'execute') then
      raise exception '[6] anon puede ejecutar %', r.proname;
    end if;
    if not has_function_privilege('authenticated', r.oid, 'execute') then
      raise exception '[6] authenticated NO puede ejecutar %: la policy y la lista se quedan mudas', r.proname;
    end if;
    if (select count(*) from aclexplode((select proacl from pg_proc where oid = r.oid))
         where grantee = 0) > 0 then
      raise exception '[6] la ACL de % sigue concediendo a PUBLIC', r.proname;
    end if;
  end loop;
end $$;

rollback;
