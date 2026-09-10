-- BC-1 — borrado de cuenta (migraciones 20261058000000 + 20261059000000). Cubre:
--   [1]  preview: solo jugadores ACTIVOS de los que es UNICO tutor (ni suprimido, ni de baja,
--        ni uno con co-tutor).
--   [2]  request: baja en el club, fuera los push, una supresion por jugador bloqueante,
--        y la supresion queda ENLAZADA al borrado.
--   [3]  request es idempotente: dos pulsaciones, una sola solicitud.
--   [4]  cancel revierte memberships, supresiones y la propia solicitud.
--   [5]  tras cancelar se puede volver a pedir (indice parcial `one_pending`).
--   [6]  el club aprueba -> account_deletions_due() lo saca con due_reason='resolved'.
--   [7]  finalize anonimiza profiles, borra vinculos y contacto, y audita.
--   [8]  finalize es idempotente (el cron puede repetir sin dano).
--   [9]  CANDADO de privilegios: authenticated NO escribe profiles.deleted_at, pero SI
--        sigue escribiendo sus columnas normales y SI puede leer la marca.
--   [10] CANDADO: authenticated no ejecuta finalize_account_deletion ni account_deletions_due.
--   [11] un admin_club puede borrarse y el club ADMITE un admin nuevo (indice con left_at).
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('bc100000-0000-4000-8000-000000000001', 'Club BC1 Ensayo', 'club-bc1-ensayo');

select pg_temp.new_test_user('bc1a0000-0000-4000-8000-00000000000a', 'admin@bc1.test', '{}'::jsonb);
select pg_temp.new_test_user('bc1a0000-0000-4000-8000-0000000000b1', 'tutor1@bc1.test', '{}'::jsonb);
select pg_temp.new_test_user('bc1a0000-0000-4000-8000-0000000000b2', 'tutor2@bc1.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role, phone, contact_email) values
  ('bc150000-0000-4000-8000-00000000000a', 'bc1a0000-0000-4000-8000-00000000000a', 'bc100000-0000-4000-8000-000000000001', 'admin_club', null, null),
  ('bc150000-0000-4000-8000-0000000000b1', 'bc1a0000-0000-4000-8000-0000000000b1', 'bc100000-0000-4000-8000-000000000001', 'jugador', '600111222', 'contacto1@bc1.test'),
  ('bc150000-0000-4000-8000-0000000000b2', 'bc1a0000-0000-4000-8000-0000000000b2', 'bc100000-0000-4000-8000-000000000001', 'jugador', null, null);

-- P1: SOLO tutor1 (bloqueante). P2: tutor1 + tutor2 (no bloqueante).
-- P3: solo tutor1 pero YA suprimido → no bloquea. P4: solo tutor1 pero de BAJA → no bloquea.
insert into public.players (id, club_id, first_name, last_name, date_of_birth, erased_at, left_club_at) values
  ('bc1b0000-0000-4000-8000-000000000001', 'bc100000-0000-4000-8000-000000000001', 'Uno',    'Solo',  '2014-01-01', null, null),
  ('bc1b0000-0000-4000-8000-000000000002', 'bc100000-0000-4000-8000-000000000001', 'Dos',    'Doble', '2014-01-02', null, null),
  ('bc1b0000-0000-4000-8000-000000000003', 'bc100000-0000-4000-8000-000000000001', 'Tres',   'Supri', '2014-01-03', now(), null),
  ('bc1b0000-0000-4000-8000-000000000004', 'bc100000-0000-4000-8000-000000000001', 'Cuatro', 'Baja',  '2014-01-04', null, current_date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('bc1b0000-0000-4000-8000-000000000001', 'bc1a0000-0000-4000-8000-0000000000b1', 'parent'),
  ('bc1b0000-0000-4000-8000-000000000002', 'bc1a0000-0000-4000-8000-0000000000b1', 'parent'),
  ('bc1b0000-0000-4000-8000-000000000002', 'bc1a0000-0000-4000-8000-0000000000b2', 'parent'),
  ('bc1b0000-0000-4000-8000-000000000003', 'bc1a0000-0000-4000-8000-0000000000b1', 'parent'),
  ('bc1b0000-0000-4000-8000-000000000004', 'bc1a0000-0000-4000-8000-0000000000b1', 'parent');

insert into public.expo_push_tokens (user_id, token) values
  ('bc1a0000-0000-4000-8000-0000000000b1', 'ExponentPushToken[bc1-ensayo]');

update public.profiles set full_name = 'Tutor Uno', phone = '600111222', date_of_birth = '1985-05-05',
                           avatar_url = 'bc1a0000-0000-4000-8000-0000000000b1/avatar.jpg'
 where id = 'bc1a0000-0000-4000-8000-0000000000b1';

\echo '=== [1] preview_account_deletion: solo el jugador activo del que es UNICO tutor ==='
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select first_name, last_name, club_name from public.preview_account_deletion();

do $$
declare n int;
begin
  select count(*) into n from public.preview_account_deletion();
  if n <> 1 then raise exception 'FAIL [1]: preview devolvio % filas, esperaba 1 (P2 tiene otro tutor, P3 suprimido, P4 de baja)', n; end if;
end $$;

\echo '=== [2] request_account_deletion: una pulsacion ==='
select request_id is not null as tiene_request, blocking_players
  from public.request_account_deletion('me voy');

do $$
declare v_left int; v_tok int; v_er int; v_link int;
begin
  reset role;
  select count(*) into v_left from public.memberships
   where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1' and left_at is not null;
  select count(*) into v_tok from public.expo_push_tokens where user_id = 'bc1a0000-0000-4000-8000-0000000000b1';
  select count(*) into v_er  from public.erasure_requests
   where player_id = 'bc1b0000-0000-4000-8000-000000000001' and status = 'pending';
  select count(*) into v_link from public.erasure_requests where account_deletion_id is not null;
  if v_left <> 1 then raise exception 'FAIL [2a]: membership no dada de baja (%)', v_left; end if;
  if v_tok  <> 0 then raise exception 'FAIL [2b]: quedan % push tokens', v_tok; end if;
  if v_er   <> 1 then raise exception 'FAIL [2c]: esperaba 1 supresion pendiente de P1, hay %', v_er; end if;
  if v_link <> 1 then raise exception 'FAIL [2d]: la supresion no quedo enlazada al borrado (%)', v_link; end if;
end $$;

\echo '=== [3] idempotencia: segunda pulsacion no duplica ==='
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b1","role":"authenticated"}';
do $$
declare a uuid; b uuid; n int;
begin
  select request_id into a from public.request_account_deletion(null);
  select request_id into b from public.request_account_deletion(null);
  if a <> b then raise exception 'FAIL [3a]: dos ids distintos (% vs %)', a, b; end if;
  reset role;
  select count(*) into n from public.account_deletion_requests where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1';
  if n <> 1 then raise exception 'FAIL [3b]: hay % solicitudes, esperaba 1', n; end if;
end $$;

\echo '=== [4] cancel_account_deletion: se revierte TODO ==='
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select public.cancel_account_deletion();

do $$
declare v_left int; v_er text; v_st text;
begin
  reset role;
  select count(*) into v_left from public.memberships
   where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1' and left_at is not null;
  select status into v_er from public.erasure_requests where player_id = 'bc1b0000-0000-4000-8000-000000000001';
  select status into v_st from public.account_deletion_requests where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1';
  if v_left <> 0 then raise exception 'FAIL [4a]: la membership sigue de baja'; end if;
  if v_er <> 'cancelled' then raise exception 'FAIL [4b]: la supresion quedo en %', v_er; end if;
  if v_st <> 'cancelled' then raise exception 'FAIL [4c]: la solicitud quedo en %', v_st; end if;
end $$;

\echo '=== [5] tras cancelar se puede volver a pedir (el indice parcial lo permite) ==='
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select blocking_players from public.request_account_deletion(null);

\echo '=== [6] el club APRUEBA la supresion -> el borrado pasa a estar listo ==='
do $$
declare v_id uuid;
begin
  reset role;
  select id into v_id from public.erasure_requests
   where player_id = 'bc1b0000-0000-4000-8000-000000000001' and status = 'pending';
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-00000000000a","role":"authenticated"}';
  perform public.decide_player_erasure(v_id, true, null);
end $$;

reset role;
set local role service_role;
select due_reason from public.account_deletions_due();

do $$
declare n int;
begin
  select count(*) into n from public.account_deletions_due();
  if n <> 1 then raise exception 'FAIL [6]: account_deletions_due devolvio %, esperaba 1', n; end if;
end $$;

\echo '=== [7] finalize_account_deletion: la anonimizacion ==='
select public.finalize_account_deletion('bc1a0000-0000-4000-8000-0000000000b1') as avatar_a_borrar;

do $$
declare r record; v_pa int; v_st text; v_ph int;
begin
  reset role;
  select full_name, phone, date_of_birth, avatar_url, deleted_at into r
    from public.profiles where id = 'bc1a0000-0000-4000-8000-0000000000b1';
  if r.full_name is not null or r.phone is not null or r.date_of_birth is not null or r.avatar_url is not null then
    raise exception 'FAIL [7a]: queda PII en profiles (%, %, %, %)', r.full_name, r.phone, r.date_of_birth, r.avatar_url;
  end if;
  if r.deleted_at is null then raise exception 'FAIL [7b]: deleted_at sin marcar'; end if;
  select count(*) into v_pa from public.player_accounts where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1';
  if v_pa <> 0 then raise exception 'FAIL [7c]: quedan % vinculos player_accounts', v_pa; end if;
  select count(*) into v_ph from public.memberships
   where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1' and (phone is not null or contact_email is not null);
  if v_ph <> 0 then raise exception 'FAIL [7d]: queda contacto en memberships'; end if;
  select status into v_st from public.account_deletion_requests
   where profile_id = 'bc1a0000-0000-4000-8000-0000000000b1' and status = 'completed';
  if v_st is null then raise exception 'FAIL [7e]: la solicitud no quedo completed'; end if;
end $$;

\echo '=== [7bis] lo que SOBREVIVE por decision: consents, mensajes, auditoria ==='
do $$
declare n int;
begin
  select count(*) into n from public.audit_log
   where actor_profile_id = 'bc1a0000-0000-4000-8000-0000000000b1' and action = 'account.deleted';
  if n < 1 then raise exception 'FAIL [7bis]: no se audito el borrado'; end if;
end $$;

\echo '=== [8] finalize es IDEMPOTENTE (el cron puede repetir) ==='
set local role service_role;
do $$
declare v text;
begin
  select public.finalize_account_deletion('bc1a0000-0000-4000-8000-0000000000b1') into v;
  if v is not null then raise exception 'FAIL [8]: la segunda pasada devolvio %', v; end if;
end $$;
reset role;

\echo '=== [9] CANDADO: authenticated NO puede escribir profiles.deleted_at ==='
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b2","role":"authenticated"}';
  begin
    update public.profiles set deleted_at = null where id = 'bc1a0000-0000-4000-8000-0000000000b2';
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then raise exception 'FAIL [9]: un cliente pudo escribir deleted_at'; end if;
end $$;

\echo '=== [9bis] pero SI puede seguir escribiendo sus columnas normales ==='
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b2","role":"authenticated"}';
  update public.profiles set full_name = 'Tutor Dos', phone = '600999888' where id = 'bc1a0000-0000-4000-8000-0000000000b2';
  reset role;
exception when others then
  reset role;
  raise exception 'FAIL [9bis]: se rompio el UPDATE normal del perfil: %', sqlerrm;
end $$;

\echo '=== [9ter] y SI puede LEER deleted_at ==='
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select count(*) as perfiles_legibles_con_marca from public.profiles where deleted_at is not null;
reset role;

\echo '=== [10] CANDADO: authenticated NO puede ejecutar finalize ni ver la cola ==='
do $$
declare ok1 boolean := false; ok2 boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-0000000000b2","role":"authenticated"}';
  begin perform public.finalize_account_deletion('bc1a0000-0000-4000-8000-0000000000b2');
  exception when insufficient_privilege then ok1 := true; end;
  begin perform public.account_deletions_due();
  exception when insufficient_privilege then ok2 := true; end;
  reset role;
  if not ok1 then raise exception 'FAIL [10a]: un cliente pudo llamar a finalize_account_deletion'; end if;
  if not ok2 then raise exception 'FAIL [10b]: un cliente pudo llamar a account_deletions_due'; end if;
end $$;

\echo '=== [11] admin_club se borra y el club PUEDE recibir un admin nuevo ==='
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc1a0000-0000-4000-8000-00000000000a","role":"authenticated"}';
select blocking_players as bloqueantes_del_admin from public.request_account_deletion(null);
reset role;

set local role service_role;
select public.finalize_account_deletion('bc1a0000-0000-4000-8000-00000000000a') is null as sin_avatar;
reset role;

select pg_temp.new_test_user('bc1a0000-0000-4000-8000-0000000000c1', 'adminnuevo@bc1.test', '{}'::jsonb);

do $$
declare v_owner uuid; v_left date;
begin
  select left_at into v_left from public.memberships where id = 'bc150000-0000-4000-8000-00000000000a';
  if v_left is null then raise exception 'FAIL [11a]: la membership del admin borrado NO quedo de baja'; end if;

  select owner_profile_id into v_owner from public.clubs where id = 'bc100000-0000-4000-8000-000000000001';
  if v_owner is not null then raise exception 'FAIL [11b]: el club sigue con owner_profile_id = %', v_owner; end if;

  -- Con el indice VIEJO (`where role = 'admin_club'` a secas) este INSERT reventaba:
  -- la fila del admin borrado seguia ocupando el hueco y el club quedaba bloqueado.
  begin
    insert into public.memberships (profile_id, club_id, role)
    values ('bc1a0000-0000-4000-8000-0000000000c1', 'bc100000-0000-4000-8000-000000000001', 'admin_club');
  exception when unique_violation then
    raise exception 'FAIL [11c]: el hueco de admin_club sigue ocupado por el admin borrado';
  end;

  select owner_profile_id into v_owner from public.clubs where id = 'bc100000-0000-4000-8000-000000000001';
  if v_owner <> 'bc1a0000-0000-4000-8000-0000000000c1' then
    raise exception 'FAIL [11d]: el admin nuevo no quedo como owner (%)', v_owner;
  end if;
end $$;

\echo ''
\echo '───────────────────────────────────────────────'
\echo '✅ Tests BC-1 (borrado de cuenta): 11 bloques pasaron.'
\echo '───────────────────────────────────────────────'

rollback;
