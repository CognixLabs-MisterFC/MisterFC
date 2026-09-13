-- MN-BC — el guard de UNICO TUTOR frente a la cuenta propia del menor
-- (migracion 20261070000000). Cubre:
--   [1]  El helper: la fila `self` del hijo NO vale como relevo; otro tutor SI.
--   [2]  EL AGUJERO. Tutor unico + hijo con cuenta propia: el jugador sigue saliendo
--        como bloqueo. Es el caso que antes se colaba en silencio.
--   [3]  preview y request dicen LO MISMO. Estaban copiados; si uno se arregla y el
--        otro no, la pantalla promete una cosa y el borrado hace otra.
--   [4]  Con OTRO tutor vivo no hay bloqueo: el guard no se pasa de frenada.
--   [5]  El menor borrando SU cuenta no arrastra al jugador: le queda su tutor.
--   [6]  Un tutor que se borra deja la solicitud de supresion creada (lo que bloquea).
--   [7]  CANDADO de privilegios del helper.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('3e900000-0000-4000-8000-000000000001', 'Club MNBC', 'club-mnbc');

-- t1 tutor UNICO de j1 · m1 el hijo de j1 con cuenta propia
-- t2 y t3 tutores AMBOS de j2 · s1 staff
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000001', 't1@mnbc.test', '{}'::jsonb);
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000002', 'm1@mnbc.test', '{}'::jsonb);
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000003', 't2@mnbc.test', '{}'::jsonb);
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000004', 't3@mnbc.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3e9a0000-0000-4000-8000-000000000001', '3e900000-0000-4000-8000-000000000001', 'jugador'),
  ('3e9a0000-0000-4000-8000-000000000002', '3e900000-0000-4000-8000-000000000001', 'jugador'),
  ('3e9a0000-0000-4000-8000-000000000003', '3e900000-0000-4000-8000-000000000001', 'jugador'),
  ('3e9a0000-0000-4000-8000-000000000004', '3e900000-0000-4000-8000-000000000001', 'jugador');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('3e9b0000-0000-4000-8000-000000000001', '3e900000-0000-4000-8000-000000000001',
   'Hijo', 'Mnbc', (current_date - interval '12 years')::date),
  ('3e9b0000-0000-4000-8000-000000000002', '3e900000-0000-4000-8000-000000000001',
   'Dos', 'Mnbc', (current_date - interval '13 years')::date);

-- j1: UN tutor + la cuenta propia del menor  ← el caso del agujero
-- j2: DOS tutores
insert into public.player_accounts (player_id, profile_id, relation) values
  ('3e9b0000-0000-4000-8000-000000000001', '3e9a0000-0000-4000-8000-000000000001', 'parent'),
  ('3e9b0000-0000-4000-8000-000000000001', '3e9a0000-0000-4000-8000-000000000002', 'self'),
  ('3e9b0000-0000-4000-8000-000000000002', '3e9a0000-0000-4000-8000-000000000003', 'parent'),
  ('3e9b0000-0000-4000-8000-000000000002', '3e9a0000-0000-4000-8000-000000000004', 'guardian');

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] El helper
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- A t1 no le queda relevo: lo unico que hay ademas es la cuenta del propio hijo.
  if public.player_has_other_tutor('3e9b0000-0000-4000-8000-000000000001',
                                   '3e9a0000-0000-4000-8000-000000000001') then
    raise exception 'FAIL [1]: la cuenta propia del hijo NO es relevo de su tutor';
  end if;

  -- A t2 si: t3 es guardian del mismo jugador.
  if not public.player_has_other_tutor('3e9b0000-0000-4000-8000-000000000002',
                                       '3e9a0000-0000-4000-8000-000000000003') then
    raise exception 'FAIL [1]: t3 es relevo de t2';
  end if;

  -- Y visto desde el menor: su tutor si es un tutor.
  if not public.player_has_other_tutor('3e9b0000-0000-4000-8000-000000000001',
                                       '3e9a0000-0000-4000-8000-000000000002') then
    raise exception 'FAIL [1]: el tutor del menor cuenta como tutor';
  end if;
end $$;

set local role authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] EL AGUJERO: t1 es unico tutor aunque su hijo tenga cuenta propia
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.preview_account_deletion()
   where player_id = '3e9b0000-0000-4000-8000-000000000001';
  if v_n <> 1 then
    raise exception 'FAIL [2]: el jugador debe salir como bloqueo del borrado de su unico tutor (salio %)', v_n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Con OTRO tutor vivo no hay bloqueo
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.preview_account_deletion();
  if v_n <> 0 then
    raise exception 'FAIL [4]: con otro tutor vivo no se bloquea nada (salieron %)', v_n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] El MENOR borrando su cuenta no arrastra al jugador: le queda su tutor
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare v_n integer;
begin
  select count(*) into v_n from public.preview_account_deletion();
  if v_n <> 0 then
    raise exception 'FAIL [5]: el menor se borra sin arrastrar al jugador, su tutor sigue (salieron %)', v_n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] + [6] preview y request dicen lo MISMO, y request crea el bloqueo
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare
  v_prev integer;
  v_er   integer;
begin
  select count(*) into v_prev from public.preview_account_deletion();

  perform public.request_account_deletion(null);

  select count(*) into v_er from public.erasure_requests
   where player_id = '3e9b0000-0000-4000-8000-000000000001'
     and status = 'pending'
     and created_by_account_deletion;

  if v_er <> 1 then
    raise exception 'FAIL [6]: el borrado del unico tutor debe crear la solicitud que lo bloquea (hay %)', v_er;
  end if;
  if v_prev <> v_er then
    raise exception 'FAIL [3]: preview prometia % bloqueos y request creo %', v_prev, v_er;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] CANDADO de privilegios
-- ─────────────────────────────────────────────────────────────────────────────
reset role;

do $$
begin
  if not has_function_privilege('authenticated', 'public.player_has_other_tutor(uuid, uuid)', 'EXECUTE') then
    raise exception 'FAIL [7]: authenticated necesita EXECUTE sobre el helper';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ MN-BC: el guard de unico tutor aguanta self.'
\echo '──────────────────────────────────────────────'
