-- MN-9 — el estado de la cuenta propia del jugador (migracion 20261072000000).
-- Cubre:
--   [1]  'none'    · ni cuenta propia ni invitacion viva.
--   [2]  'invited' · invitacion enviada, sin aceptar y sin caducar.
--   [3]  'linked'  · el jugador ya tiene su cuenta.
--   [4]  Una invitacion CADUCADA no cuenta: vuelve a 'none' y se puede reinvitar.
--   [5]  Una invitacion ACEPTADA tampoco cuenta por si sola. Lo que manda es la cuenta.
--   [6]  PRECEDENCIA: con cuenta E invitacion viva a la vez, manda la cuenta ('linked').
--   [7]  El PROPIO jugador recibe 'linked', asi que la tarjeta le desaparece por la
--        MISMA regla que al tutor. Es lo que permite que la interfaz tenga una sola.
--   [8]  Gate: un tercero y el staff del club reciben forbidden; sin sesion, no_session.
--   [9]  NO DIVERGE de invite_player_self: cuando el estado dice 'linked', la RPC
--        levanta already_linked. Si algun dia uno cambia sin el otro, esto se pone rojo.
--   [10] CANDADO ACL: anon NO ejecuta; authenticated si.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('3eb00000-0000-4000-8000-000000000001', 'Club MN9', 'club-mn9');

insert into public.seasons (id, club_id, label, status) values
  ('3ebc0000-0000-4000-8000-000000000001', '3eb00000-0000-4000-8000-000000000001', '2026-27', 'active');

-- t = tutor, m = el menor con cuenta propia, x = un tercero, s = staff del club
select pg_temp.new_test_user('3eba0000-0000-4000-8000-000000000001', 't@mn9.test', '{}'::jsonb);
select pg_temp.new_test_user('3eba0000-0000-4000-8000-000000000002', 'm@mn9.test', '{}'::jsonb);
select pg_temp.new_test_user('3eba0000-0000-4000-8000-000000000003', 'x@mn9.test', '{}'::jsonb);
select pg_temp.new_test_user('3eba0000-0000-4000-8000-000000000004', 's@mn9.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3eba0000-0000-4000-8000-000000000001', '3eb00000-0000-4000-8000-000000000001', 'jugador'),
  ('3eba0000-0000-4000-8000-000000000002', '3eb00000-0000-4000-8000-000000000001', 'jugador'),
  ('3eba0000-0000-4000-8000-000000000003', '3eb00000-0000-4000-8000-000000000001', 'jugador'),
  ('3eba0000-0000-4000-8000-000000000004', '3eb00000-0000-4000-8000-000000000001', 'admin_club');

-- j1 el del recorrido none → invited → linked. j2 el que nace ya con cuenta propia.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('3ebb0000-0000-4000-8000-000000000001', '3eb00000-0000-4000-8000-000000000001', 'Uno', 'Mn9', (current_date - interval '12 years')::date),
  ('3ebb0000-0000-4000-8000-000000000002', '3eb00000-0000-4000-8000-000000000001', 'Dos', 'Mn9', (current_date - interval '12 years')::date);

-- El tutor lo es de los dos. El menor m es la cuenta propia de j2.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('3ebb0000-0000-4000-8000-000000000001', '3eba0000-0000-4000-8000-000000000001', 'parent'),
  ('3ebb0000-0000-4000-8000-000000000002', '3eba0000-0000-4000-8000-000000000001', 'parent'),
  ('3ebb0000-0000-4000-8000-000000000002', '3eba0000-0000-4000-8000-000000000002', 'self');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] 'none' · ni cuenta ni invitacion
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000001');
  if v is distinct from 'none' then
    raise exception 'FAIL [1]: esperaba none, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] 'linked' · el que ya tiene cuenta propia
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000002');
  if v is distinct from 'linked' then
    raise exception 'FAIL [3]: esperaba linked, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] Coherencia con invite_player_self: 'linked' ⇒ already_linked
--     (en la RPC el already_linked va ANTES que consentimientos y temporada, asi
--      que este bloque mide la divergencia y no el resto de precondiciones).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.invite_player_self('3ebb0000-0000-4000-8000-000000000002', 'otro@mn9.test');
  raise exception 'FAIL [9]: con estado linked la RPC tenia que negarse';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%already_linked%' then
      raise exception 'FAIL [9]: esperaba already_linked, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] 'invited' · invitacion viva
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
insert into public.invitations (email, club_id, role, player_id, player_relation) values
  ('hijo@mn9.test', '3eb00000-0000-4000-8000-000000000001', 'jugador',
   '3ebb0000-0000-4000-8000-000000000001', 'self');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000001');
  if v is distinct from 'invited' then
    raise exception 'FAIL [2]: esperaba invited, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Caducada ⇒ vuelve a 'none'
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
update public.invitations set expires_at = now() - interval '1 day'
 where player_id = '3ebb0000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000001');
  if v is distinct from 'none' then
    raise exception 'FAIL [4]: una invitacion caducada no puede contar, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Aceptada ⇒ tampoco cuenta
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
update public.invitations
   set expires_at = now() + interval '7 days', accepted_at = now()
 where player_id = '3ebb0000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000001');
  if v is distinct from 'none' then
    raise exception 'FAIL [5]: una invitacion aceptada no crea la cuenta por si sola, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] PRECEDENCIA: cuenta + invitacion viva ⇒ 'linked'
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
insert into public.invitations (email, club_id, role, player_id, player_relation) values
  ('otrohijo@mn9.test', '3eb00000-0000-4000-8000-000000000001', 'jugador',
   '3ebb0000-0000-4000-8000-000000000002', 'self');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000002');
  if v is distinct from 'linked' then
    raise exception 'FAIL [6]: con cuenta ya creada manda la cuenta, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] El PROPIO jugador recibe 'linked' (una sola regla para la interfaz)
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare v text;
begin
  v := public.player_self_account_status('3ebb0000-0000-4000-8000-000000000002');
  if v is distinct from 'linked' then
    raise exception 'FAIL [7]: el propio jugador tiene que recibir linked, dio: %', v;
  end if;
end $$;

-- ...y sobre un jugador que no es suyo, ni lo ve.
do $$
begin
  perform public.player_self_account_status('3ebb0000-0000-4000-8000-000000000001');
  raise exception 'FAIL [7]: un jugador ajeno no se consulta';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [7]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] Gate: tercero, staff del club, y sin sesion
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.player_self_account_status('3ebb0000-0000-4000-8000-000000000002');
  raise exception 'FAIL [8a]: un tercero no consulta el estado';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [8a]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- El staff del club VE la fila en player_accounts (su RLS se lo permite), pero esta
-- tarjeta es de la pantalla de la familia: aqui tambien es forbidden.
set local "request.jwt.claims" = '{"sub":"3eba0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.player_self_account_status('3ebb0000-0000-4000-8000-000000000002');
  raise exception 'FAIL [8b]: el staff del club tampoco consulta esta tarjeta';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [8b]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

set local "request.jwt.claims" = '{}';
do $$
begin
  perform public.player_self_account_status('3ebb0000-0000-4000-8000-000000000002');
  raise exception 'FAIL [8c]: sin sesion no se contesta';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%no_session%' then
      raise exception 'FAIL [8c]: esperaba no_session, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [10] CANDADO ACL — con has_function_privilege, nunca provocando el 42501
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.player_self_account_status(uuid)', 'execute') then
    raise exception 'FAIL [10]: anon NO puede ejecutar player_self_account_status';
  end if;
  if not has_function_privilege('authenticated', 'public.player_self_account_status(uuid)', 'execute') then
    raise exception 'FAIL [10]: authenticated tiene que poder ejecutarla';
  end if;
end $$;

rollback;
