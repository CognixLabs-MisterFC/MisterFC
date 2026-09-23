-- RC-4 — el tutor no borra su cuenta mientras su hijo tenga la suya
-- (migracion 20261101000000).
--
-- LA REGLA: primero retira la cuenta del menor —puede hacerlo el solo desde la
-- 20261100000000— y entonces puede irse. Es la hermana de la que ya existia: un tutor
-- no se borra si deja a un menor sin tutor.
--
-- Cubre:
--   [T0]  La funcion existe (si no, la migracion esta sin aplicar y el resto miente).
--   [T1]  `account_deletion_holds()` lista al hijo que YA entra con su cuenta.
--   [T2]  `request_account_deletion` se niega, y NO deja rastro: ni solicitud, ni
--         membresias de baja, ni supresiones. El rechazo va antes de la primera
--         escritura.
--   [T3]  La invitacion VIVA tambien retiene. Si no, el tutor se borra hoy y el crio
--         entra manana con el enlace que seguia vivo.
--   [T4]  EL CASO QUE MIDIO PRODUCCION: un jugador ADULTO con su propia cuenta y sin
--         tutores sale en su PROPIO preview. Si contara, no podria borrar NUNCA su
--         cuenta — que es lo que prohibe el 5.1.1(v) de Apple. No cuenta: se va.
--   [T5]  Un menor con OTRO tutor no retiene: no se queda solo.
--   [T6]  LA PUERTA TIENE LLAVE: tras retirar la cuenta del hijo, el mismo tutor SI
--         puede pedir el borrado. Sin este bloque, el candado seria una trampa.
--   [T7]  Idempotencia: con un borrado YA en curso, la segunda llamada no revienta
--         aunque hayan aparecido retenciones. Quien esta en la pantalla terminal solo
--         puede cancelar; romperle una llamada no le da ninguna salida nueva.
--   [T8]  BC-1 sigue entero: el hijo SIN cuenta propia se sigue llevando su solicitud
--         de supresion al club.
--   [T9]  CANDADO ACL: anon NO ejecuta; authenticated si.
--   [T10] CONTROL NEGATIVO: sin el candado, lo de [T2] entra.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Los privilegios se comprueban con has_function_privilege, NUNCA provocando
-- el 42501 (leccion de BC-1: eso tumbaba el backend del CI).
--
-- Y las aserciones LEEN con el rol de la sesion: toda comprobacion de estado va
-- despues de `reset role`, porque una ausencia leida por quien no podria ver la fila
-- no afirma nada.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── T0 ───────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.account_deletion_holds()') is null then
    raise exception 'FAIL [T0]: falta account_deletion_holds — la migracion 20261101000000 no esta aplicada en esta BD';
  end if;
end $$;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('bb700000-0000-4000-8000-000000000001', 'Club RC4', 'club-rc4');

insert into public.seasons (id, club_id, label, status) values
  ('bb7c0000-0000-4000-8000-000000000001', 'bb700000-0000-4000-8000-000000000001', '2026-27', 'active');

-- t  = el tutor del caso · m1 = la cuenta propia de p1 · t2 = el segundo tutor de p3
-- ad = un jugador ADULTO con su propia cuenta y sin tutores · sa = superadmin? no: nadie mas.
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000001', 't@rc4.test',  '{}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000002', 'm1@rc4.test', '{}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000003', 't2@rc4.test', '{}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000004', 'ad@rc4.test', '{}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000005', 'm3@rc4.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('bb7a0000-0000-4000-8000-000000000001', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000002', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000003', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000004', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000005', 'bb700000-0000-4000-8000-000000000001', 'jugador');

-- Fechas FIJAS. El adulto nacio en 1995: mayor de edad hoy y dentro de veinte anos.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('bb7b0000-0000-4000-8000-000000000001', 'bb700000-0000-4000-8000-000000000001', 'Uno',    'Rc4', '2014-03-03'),
  ('bb7b0000-0000-4000-8000-000000000002', 'bb700000-0000-4000-8000-000000000001', 'Dos',    'Rc4', '2014-03-03'),
  ('bb7b0000-0000-4000-8000-000000000003', 'bb700000-0000-4000-8000-000000000001', 'Tres',   'Rc4', '2014-03-03'),
  ('bb7b0000-0000-4000-8000-000000000004', 'bb700000-0000-4000-8000-000000000001', 'Adulto', 'Rc4', '1995-06-06'),
  ('bb7b0000-0000-4000-8000-000000000005', 'bb700000-0000-4000-8000-000000000001', 'Cinco',  'Rc4', '2014-03-03');

-- p1: menor con cuenta propia (RETIENE) · p2: menor sin cuenta (no retiene, pero si
-- genera supresion) · p3: menor con cuenta propia y DOS tutores (no retiene) ·
-- p4: el jugador adulto, su propia cuenta y sin tutores · p5: menor con invitacion viva.
-- El tutor va SIEMPRE antes que el `self`: lo exige la 20261097000000.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('bb7b0000-0000-4000-8000-000000000001', 'bb7a0000-0000-4000-8000-000000000001', 'parent'),
  ('bb7b0000-0000-4000-8000-000000000002', 'bb7a0000-0000-4000-8000-000000000001', 'parent'),
  ('bb7b0000-0000-4000-8000-000000000003', 'bb7a0000-0000-4000-8000-000000000001', 'parent'),
  ('bb7b0000-0000-4000-8000-000000000003', 'bb7a0000-0000-4000-8000-000000000003', 'parent'),
  ('bb7b0000-0000-4000-8000-000000000005', 'bb7a0000-0000-4000-8000-000000000001', 'parent'),
  ('bb7b0000-0000-4000-8000-000000000001', 'bb7a0000-0000-4000-8000-000000000002', 'self'),
  ('bb7b0000-0000-4000-8000-000000000003', 'bb7a0000-0000-4000-8000-000000000005', 'self'),
  ('bb7b0000-0000-4000-8000-000000000004', 'bb7a0000-0000-4000-8000-000000000004', 'self');

-- ─────────────────────────────────────────────────────────────────────────────
-- [T1] Quien retiene, y con que motivo.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare r record; n integer;
begin
  select count(*) into n from public.account_deletion_holds();
  if n <> 1 then
    raise exception 'FAIL [T1]: esperaba 1 retencion, hay %', n;
  end if;
  select * into r from public.account_deletion_holds();
  if r.hold_player_id is distinct from 'bb7b0000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [T1]: retiene el jugador equivocado: %', r.hold_player_id;
  end if;
  if r.estado is distinct from 'linked' then
    raise exception 'FAIL [T1]: esperaba linked, dio: %', r.estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T2] Se niega, y NO deja rastro.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.request_account_deletion('ensayo');
  raise exception 'FAIL [T2]: el tutor ha podido pedir el borrado dejando a un menor con cuenta y sin tutor';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%hijo_con_cuenta_propia%' then
      raise exception 'FAIL [T2]: esperaba hijo_con_cuenta_propia, dio: %', sqlerrm;
    end if;
end $$;

reset role;
do $$
begin
  if exists (select 1 from public.account_deletion_requests
              where profile_id = 'bb7a0000-0000-4000-8000-000000000001') then
    raise exception 'FAIL [T2]: el rechazo ha dejado una solicitud escrita';
  end if;
  if exists (select 1 from public.memberships
              where profile_id = 'bb7a0000-0000-4000-8000-000000000001' and left_at is not null) then
    raise exception 'FAIL [T2]: el rechazo ha dado de baja sus membresias';
  end if;
  if exists (select 1 from public.erasure_requests where requested_by = 'bb7a0000-0000-4000-8000-000000000001') then
    raise exception 'FAIL [T2]: el rechazo ha pedido supresiones al club';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T3] La invitacion VIVA tambien retiene.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.invitations (email, club_id, role, player_id, player_relation, created_by, expires_at) values
  ('hijo5@rc4.test', 'bb700000-0000-4000-8000-000000000001', 'jugador',
   'bb7b0000-0000-4000-8000-000000000005', 'self', 'bb7a0000-0000-4000-8000-000000000001',
   now() + interval '7 days');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.account_deletion_holds() where estado = 'invited';
  if n <> 1 then
    raise exception 'FAIL [T3]: la invitacion viva no retiene (invited=%). El tutor se borraria hoy y el crio entraria manana', n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T5] El menor con OTRO tutor no retiene: no se queda solo. (Va aqui porque p3 ya
--      esta montado y el tutor sigue siendo el de la sesion.)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.account_deletion_holds()
     where hold_player_id = 'bb7b0000-0000-4000-8000-000000000003'
  ) then
    raise exception 'FAIL [T5]: retiene por un menor que TIENE otro tutor';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T4] EL CASO MEDIDO EN PRODUCCION. El jugador ADULTO con su propia cuenta sale en
--      su propio preview (`preview_account_deletion` no filtra por relacion). Si
--      contara como retencion, no podria borrar NUNCA su cuenta: 5.1.1(v) de Apple.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"bb7a0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
declare n integer;
begin
  -- Primero, que el montaje es el que dice ser: SI sale en su propio preview.
  select count(*) into n from public.preview_account_deletion()
   where player_id = 'bb7b0000-0000-4000-8000-000000000004';
  if n <> 1 then
    raise exception 'FAIL [T4]: el montaje falla — el jugador adulto no sale en su propio preview (n=%), asi que este test no mide lo que dice', n;
  end if;

  select count(*) into n from public.account_deletion_holds();
  if n <> 0 then
    raise exception 'FAIL [T4]: el jugador adulto se retiene a SI MISMO (n=%). No podria borrar nunca su cuenta', n;
  end if;

  begin
    perform public.request_account_deletion('ensayo adulto');
  exception when others then
    raise exception 'FAIL [T4]: el jugador adulto no ha podido pedir el borrado de SU cuenta (%)', sqlerrm;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T6] LA PUERTA TIENE LLAVE. El mismo tutor de [T2], tras retirar la cuenta de su
--      hijo (y la invitacion viva de p5), SI puede irse. Sin esto el candado seria
--      una trampa, que es lo que el 5.1.1(v) no permite.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"bb7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v text; n integer;
begin
  v := public.revoke_player_self_account('bb7b0000-0000-4000-8000-000000000001');
  if v is distinct from 'account' then
    raise exception 'FAIL [T6]: retirar la cuenta devolvio %, esperaba account', v;
  end if;
  v := public.revoke_player_self_account('bb7b0000-0000-4000-8000-000000000005');
  if v is distinct from 'invitation' then
    raise exception 'FAIL [T6]: retirar la invitacion devolvio %, esperaba invitation', v;
  end if;

  select count(*) into n from public.account_deletion_holds();
  if n <> 0 then
    raise exception 'FAIL [T6]: despues de retirar siguen quedando % retenciones', n;
  end if;

  begin
    perform public.request_account_deletion('ya puedo irme');
  exception when others then
    raise exception 'FAIL [T6]: tras retirar las cuentas, el tutor SIGUE sin poder borrarse (%). El candado seria una trampa', sqlerrm;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T8] BC-1 sigue entero: el hijo SIN cuenta propia se lleva su supresion al club.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if not exists (
    select 1 from public.erasure_requests
     where player_id = 'bb7b0000-0000-4000-8000-000000000002'
       and requested_by = 'bb7a0000-0000-4000-8000-000000000001'
       and status = 'pending'
  ) then
    raise exception 'FAIL [T8]: el hijo sin cuenta propia ya no genera su solicitud de supresion. El candado se ha llevado por delante BC-1';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T7] Idempotencia con retenciones sobrevenidas. El tutor YA tiene un borrado en
--      curso (lo acaba de pedir en [T6]); le devolvemos una cuenta propia al hijo y
--      la segunda llamada NO puede reventar: en la pantalla terminal solo se cancela.
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.player_accounts (player_id, profile_id, relation) values
  ('bb7b0000-0000-4000-8000-000000000001', 'bb7a0000-0000-4000-8000-000000000002', 'self');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n integer;
begin
  select count(*) into n from public.account_deletion_holds();
  if n <> 1 then
    raise exception 'FAIL [T7]: el montaje falla — esperaba 1 retencion sobrevenida, hay %', n;
  end if;
  begin
    perform public.request_account_deletion('segunda llamada');
  exception when others then
    raise exception 'FAIL [T7]: con un borrado YA en curso la llamada ha reventado (%). A quien esta en la pantalla terminal no se le rompe lo que le funcionaba', sqlerrm;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T9] CANDADO ACL — con has_function_privilege, nunca provocando el 42501.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.account_deletion_holds()', 'execute') then
    raise exception 'FAIL [T9]: anon NO puede ejecutar account_deletion_holds';
  end if;
  if not has_function_privilege('authenticated', 'public.account_deletion_holds()', 'execute') then
    raise exception 'FAIL [T9]: authenticated tiene que poder ejecutarla';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T10] CONTROL NEGATIVO. Sin el candado, lo de [T2] entra. Si esto fallara, aquel
--       rechazo lo produciria otra cosa. El rollback lo repone.
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000009', 'neg@rc4.test', '{}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-00000000000a', 'negself@rc4.test', '{}'::jsonb);
insert into public.memberships (profile_id, club_id, role) values
  ('bb7a0000-0000-4000-8000-000000000009', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-00000000000a', 'bb700000-0000-4000-8000-000000000001', 'jugador');
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('bb7b0000-0000-4000-8000-000000000009', 'bb700000-0000-4000-8000-000000000001', 'Neg', 'Rc4', '2014-03-03');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('bb7b0000-0000-4000-8000-000000000009', 'bb7a0000-0000-4000-8000-000000000009', 'parent'),
  ('bb7b0000-0000-4000-8000-000000000009', 'bb7a0000-0000-4000-8000-00000000000a', 'self');

-- Se repone el cuerpo ANTERIOR de la RPC quitandole solo el bloque del candado.
create or replace function public.request_account_deletion(p_reason text default null)
returns table (request_id uuid, blocking_players integer)
language plpgsql security definer set search_path to 'public', 'pg_temp'
as $fn$
declare v_uid uuid := auth.uid(); v_req uuid;
begin
  if v_uid is null then raise exception 'no_session'; end if;
  insert into public.account_deletion_requests (profile_id, deadline_at, reason)
  values (v_uid, now() + interval '30 days', nullif(btrim(p_reason), ''))
  returning id into v_req;
  return query select v_req, 0;
end;
$fn$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb7a0000-0000-4000-8000-000000000009","role":"authenticated"}';
do $$
begin
  begin
    perform public.request_account_deletion('sin candado');
  exception when others then
    raise exception 'FAIL [T10]: sin el candado el borrado deberia entrar. Ha fallado con % — el rechazo de [T2] no lo produce este bloque', sqlerrm;
  end;
end $$;

rollback;
