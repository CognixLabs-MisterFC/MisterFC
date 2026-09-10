-- BC-6 — cron del borrado de cuenta (migracion 20261060000000). Cubre:
--   [1]  el barrido saca una solicitud COMPLETADA cuyo email de GoTrue sigue vivo.
--   [2]  con el email ya neutralizado pero SIN ban, sigue saliendo (reason='not_banned').
--        El literal del email se escribe A MANO: es el contrato con `deletedEmailFor()`
--        de packages/core. Si alguien cambia uno de los dos, este bloque cae.
--   [3]  con email + ban vigente desaparece de la cola; un ban CADUCADO la devuelve.
--   [4]  una solicitud `pending` NUNCA entra en el barrido (de esa vive
--        `account_deletions_due()`; sacarla aqui la banearia antes de tiempo).
--   [5]  CANDADO: quien tiene un borrado en curso NO puede aceptar una invitacion.
--   [6]  el candado no rompe el camino normal: sin borrado se sigue llegando al token.
--   [7]  CANDADO de privilegios: el barrido cerrado a authenticated/anon y abierto a
--        service_role, y `accept_pending_invitations` conserva su EXECUTE tras el
--        `create or replace`.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
--
-- NOTA (leccion de BC-1): los privilegios se comprueban con `has_function_privilege`,
-- NUNCA provocando el 42501. Provocarlo desde una funcion SECURITY DEFINER con `SET`
-- bajo `set local role` tumbo el backend de Postgres del CI.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('bc600000-0000-4000-8000-000000000001', 'Club BC6', 'club-bc6');

-- c1: borrado YA completado (el que barre el cron). c2: borrado en curso.
select pg_temp.new_test_user('bc6a0000-0000-4000-8000-0000000000c1', 'c1@bc6.test', '{}'::jsonb);
select pg_temp.new_test_user('bc6a0000-0000-4000-8000-0000000000c2', 'c2@bc6.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('bc6a0000-0000-4000-8000-0000000000c1', 'bc600000-0000-4000-8000-000000000001', 'jugador'),
  ('bc6a0000-0000-4000-8000-0000000000c2', 'bc600000-0000-4000-8000-000000000001', 'jugador');

insert into public.account_deletion_requests (profile_id, status, deadline_at, completed_at) values
  ('bc6a0000-0000-4000-8000-0000000000c1', 'completed', now() - interval '1 day', now() - interval '1 hour');
insert into public.account_deletion_requests (profile_id, status, deadline_at) values
  ('bc6a0000-0000-4000-8000-0000000000c2', 'pending', now() + interval '30 days');


-- ── [1]-[4] · la cola del barrido ────────────────────────────────────────────
do $$
declare
  v_c1 uuid := 'bc6a0000-0000-4000-8000-0000000000c1';
  v_c2 uuid := 'bc6a0000-0000-4000-8000-0000000000c2';
  v_n int;
  v_reason text;
begin
  -- [1] anonimizada pero con el email vivo: la cuenta PARECE borrada y se puede
  --     seguir entrando en ella. Es exactamente el estado que nadie repescaba.
  select count(*), max(reason) into v_n, v_reason
    from public.account_deletions_auth_pending() where profile_id = v_c1;
  if v_n <> 1 or v_reason <> 'email_alive' then
    raise exception 'FAIL [1]: esperaba 1/email_alive, obtuve %/%', v_n, v_reason;
  end if;

  -- [2] email neutralizado, ban sin aplicar (updateUserById a medias).
  update auth.users set email = 'deleted-' || v_c1::text || '@deleted.invalid' where id = v_c1;
  select count(*), max(reason) into v_n, v_reason
    from public.account_deletions_auth_pending() where profile_id = v_c1;
  if v_n <> 1 or v_reason <> 'not_banned' then
    raise exception 'FAIL [2]: esperaba 1/not_banned, obtuve %/%', v_n, v_reason;
  end if;

  -- [3] neutralizada del todo -> fuera de la cola.
  update auth.users set banned_until = now() + interval '100 years' where id = v_c1;
  select count(*) into v_n from public.account_deletions_auth_pending() where profile_id = v_c1;
  if v_n <> 0 then raise exception 'FAIL [3]: seguia en la cola (%)', v_n; end if;

  -- [3b] un ban caducado la devuelve: el ban de BC-3 son 100 anos, pero un ban
  --      corto puesto a mano dejaria la cuenta accesible otra vez.
  update auth.users set banned_until = now() - interval '1 day' where id = v_c1;
  select count(*), max(reason) into v_n, v_reason
    from public.account_deletions_auth_pending() where profile_id = v_c1;
  if v_n <> 1 or v_reason <> 'not_banned' then
    raise exception 'FAIL [3b]: esperaba 1/not_banned, obtuve %/%', v_n, v_reason;
  end if;

  -- [4] la pending no es asunto del barrido.
  select count(*) into v_n from public.account_deletions_auth_pending() where profile_id = v_c2;
  if v_n <> 0 then raise exception 'FAIL [4]: una solicitud pending salio en el barrido'; end if;
end $$;


-- ── [5] · candado de invitaciones ────────────────────────────────────────────
-- Token inexistente A PROPOSITO: el candado va ANTES de mirar el token, asi que este
-- bloque ademas fija el ORDEN. Si algun dia el candado se mueve detras, aqui saldria
-- 'not_found' y el test cae.
do $$
declare v_msg text;
begin
  begin
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"bc6a0000-0000-4000-8000-0000000000c2","role":"authenticated"}';
    perform public.accept_pending_invitations('00000000-0000-4000-8000-00000000dead'::uuid);
    reset role;
    raise exception 'FAIL [5]: la RPC dejo aceptar a un usuario con borrado en curso';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg <> 'account_deletion_in_progress' then
      raise exception 'FAIL [5]: esperaba account_deletion_in_progress, obtuve %', v_msg;
    end if;
  end;
end $$;


-- ── [6] · el camino normal sigue intacto ─────────────────────────────────────
do $$
declare v_msg text;
begin
  begin
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"bc6a0000-0000-4000-8000-0000000000c1","role":"authenticated"}';
    perform public.accept_pending_invitations('00000000-0000-4000-8000-00000000dead'::uuid);
    reset role;
    raise exception 'FAIL [6]: no lanzo nada';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg <> 'not_found' then
      raise exception 'FAIL [6]: esperaba not_found (token inexistente), obtuve %', v_msg;
    end if;
  end;
end $$;


-- ── [7] · candados de privilegios ────────────────────────────────────────────
do $$
begin
  if has_function_privilege('authenticated','public.account_deletions_auth_pending()','EXECUTE') then
    raise exception 'FAIL [7a]: authenticated puede ejecutar el barrido';
  end if;
  if has_function_privilege('anon','public.account_deletions_auth_pending()','EXECUTE') then
    raise exception 'FAIL [7b]: anon puede ejecutar el barrido';
  end if;
  if not has_function_privilege('service_role','public.account_deletions_auth_pending()','EXECUTE') then
    raise exception 'FAIL [7c]: service_role NO puede ejecutar el barrido';
  end if;
  -- `create or replace` conserva la ACL. Si algun dia esto pasa a drop+create, el
  -- alta de cualquier familia se cae con 42501 y este bloque lo caza antes.
  if not has_function_privilege('authenticated',
       'public.accept_pending_invitations(uuid,boolean,boolean,text,text,jsonb,jsonb)','EXECUTE') then
    raise exception 'FAIL [7d]: accept_pending_invitations perdio el EXECUTE de authenticated';
  end if;
end $$;


\echo ''
\echo '───────────────────────────────────────────────'
\echo '✅ Tests BC-6 (cron del borrado de cuenta): 7 bloques pasaron.'
\echo '───────────────────────────────────────────────'

rollback;
