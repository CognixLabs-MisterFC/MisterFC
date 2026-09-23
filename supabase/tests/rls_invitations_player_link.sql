-- Tests F2.4 — Extensión de invitations con player_id + player_relation
--
-- Verifica:
--   C1. CHECK estructural rol↔player_id↔player_relation:
--       · admin_club + player_id → falla.
--       · jugador + player_id sin player_relation → falla.
--       · jugador + player_id + relation → OK.
--       · jugador sin player_id ni relation → OK (jugador adulto auto-invitándose).
--   T1. Trigger same_club: invitation con player_id de OTRO club → falla.
--   T2. Trigger same_club: invitation con player_id del mismo club → OK.
--   X1. relation='self' → OK desde MN-2 (la cuenta propia del menor).
--   X2. Relation inventada → falla por CHECK de columna.
\ir helpers/auth_users.sql

begin;

-- Setup: 2 clubs, 2 jugadores.
insert into public.clubs (id, name, slug) values
  ('eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'Club Alfa Inv', 'alfa-inv'),
  ('eeeeeeee-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'Club Beta Inv', 'beta-inv');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('00000000-aaaa-2222-0000-000000000001', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'P', 'A', '2015-04-12'),
  ('00000000-bbbb-2222-0000-000000000001', 'eeeeeeee-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'P', 'B', '2015-04-12');

-- Tutor del jugador A. Lo exige la mig 20261098000000: la invitación de cuenta propia
-- de un MENOR no se crea sin tutor. X1 no mide eso —mide que el CHECK de columna deja
-- pasar el catálogo de relaciones y ni una más—, así que el tutor está aquí para que
-- X1 pueda seguir midiendo lo suyo y no muera por un motivo ajeno.
select pg_temp.new_test_user('eeee0000-0000-4000-8000-00000000f001', 'tutor-a@inv.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('eeee0000-0000-4000-8000-00000000f001', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('00000000-aaaa-2222-0000-000000000001', 'eeee0000-0000-4000-8000-00000000f001', 'parent');

-- ─────────────────────────────────────────────────────────────────────────────
-- Aquí trabajamos en rol postgres (bypass RLS) — solo validamos constraints
-- de tabla (CHECK + trigger). RLS de INSERT del invocador se valida aparte.
-- ─────────────────────────────────────────────────────────────────────────────

-- C1.a: admin_club + player_id → CHECK rechaza
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation)
    values ('x@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'admin_club',
            '00000000-aaaa-2222-0000-000000000001', 'parent');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C1.a]: admin_club + player_id debería violar CHECK';
  end if;
end $$;

-- C1.b: jugador + player_id sin relation → CHECK rechaza
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (email, club_id, role, player_id)
    values ('x2@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador',
            '00000000-aaaa-2222-0000-000000000001');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C1.b]: jugador + player_id sin relation debería violar CHECK';
  end if;
end $$;

-- C1.c: jugador + player_id + relation → OK
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('x3@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador',
          '00000000-aaaa-2222-0000-000000000001', 'parent');
exception when others then
  raise exception 'FAIL [C1.c]: jugador + player_id + parent debería aceptarse: %', sqlerrm;
end $$;

-- C1.d: jugador sin player_id ni relation → OK
do $$
begin
  insert into public.invitations (email, club_id, role)
  values ('x4@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador');
exception when others then
  raise exception 'FAIL [C1.d]: jugador sin player_id debería aceptarse: %', sqlerrm;
end $$;

-- T1: player_id de OTRO club → trigger falla con SQLSTATE 23514
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation)
    values ('cross@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador',
            '00000000-bbbb-2222-0000-000000000001', 'parent');
  exception when others then
    if sqlstate = '23514' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [T1]: cross-club player_id debería disparar el trigger same_club';
  end if;
end $$;

-- T2: mismo club → OK (ya probado en C1.c, pero verificamos otro caso explícito)
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('same@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador',
          '00000000-aaaa-2222-0000-000000000001', 'guardian');
exception when others then
  raise exception 'FAIL [T2]: same-club player_id no debería fallar: %', sqlerrm;
end $$;

-- X1: el CHECK de columna, tras MN-2. Hasta MN-2 este bloque afirmaba lo contrario
-- —que 'self' se rechazaba— porque hasta MN-2 no existía la cuenta propia del menor.
-- Lo que el bloque mide no ha cambiado: que el CHECK deja pasar exactamente las
-- relaciones del catálogo y ni una más. Lo que ha cambiado es el catálogo.
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('self@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador',
          '00000000-aaaa-2222-0000-000000000001', 'self');
exception when others then
  raise exception 'FAIL [X1]: relation=self debería aceptarse desde MN-2: %', sqlerrm;
end $$;

-- X2: y sigue rechazando cualquier cosa fuera del catálogo.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation)
    values ('primo@x.test', 'eeeeeeee-e0e0-e0e0-e0e0-e0e0e0e0e0e0', 'jugador',
            '00000000-aaaa-2222-0000-000000000001', 'primo');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [X2]: una relación inventada no debería aceptarse';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests invitations player_link pasaron.'
\echo '──────────────────────────────────────────────'
