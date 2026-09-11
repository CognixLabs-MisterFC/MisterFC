-- BC-7 — avisos del borrado de cuenta (migracion 20261061000000). Cubre:
--   [1]  el aviso al club llega a admin_club + directores ACTIVOS, y NO a los de baja.
--   [2]  el payload NO lleva el nombre de quien se borra (payload es inmutable por
--        trigger: si entrara, no habria forma de limpiarlo al anonimizar). Si lleva el
--        rol, los equipos que deja huerfanos, cuantas supresiones bloquean y la
--        fecha limite REAL de la fila (no un now() recalculado).
--   [3]  el superadmin NO se entera cuando quien se va no es admin_club.
--   [4]  ARREGLO de notify_erasure_requested: tampoco avisa a directores de baja.
--   [5]  team_staff sigue ABIERTO tras solicitar (el borrado es cancelable).
--   [6]  al rematar, el OTRO tutor recibe `tutor_unlinked`, y solo por el jugador
--        COMPARTIDO (del que era unico tutor no hay a quien avisar).
--   [7]  tras anonimizar no queda dato personal en ningun aviso, y los avisos siguen.
--   [8]  team_staff cerrado al rematar (ahi ya no hay vuelta atras).
--   [9]  un admin_club que se borra SI escala al superadmin (decision 1c de Jose).
--   [10] y al completarse, el superadmin recibe `account_deletion_completed`.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;


-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug)
values ('bc700000-0000-4000-8000-000000000001', 'Club BC7', 'club-bc7');

select pg_temp.new_test_user('bc7a0000-0000-4000-8000-00000000000a', 'admin@bc7.test',   '{"full_name":"Ada Admin"}'::jsonb);
select pg_temp.new_test_user('bc7a0000-0000-4000-8000-00000000000d', 'dir@bc7.test',     '{"full_name":"Dora Directora"}'::jsonb);
select pg_temp.new_test_user('bc7a0000-0000-4000-8000-00000000000e', 'dirbaja@bc7.test', '{"full_name":"Bruno Baja"}'::jsonb);
select pg_temp.new_test_user('bc7a0000-0000-4000-8000-00000000000f', 'super@bc7.test',   '{"full_name":"Sara Super"}'::jsonb);
select pg_temp.new_test_user('bc7a0000-0000-4000-8000-000000000011', 'tutor@bc7.test',   '{"full_name":"Tomas Tutor"}'::jsonb);
select pg_temp.new_test_user('bc7a0000-0000-4000-8000-000000000012', 'otro@bc7.test',    '{"full_name":"Olga Otra"}'::jsonb);

insert into public.platform_admins (profile_id) values ('bc7a0000-0000-4000-8000-00000000000f');

-- Bruno es director pero esta DE BAJA: no debe recibir ningun aviso.
insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('bc750000-0000-4000-8000-00000000000a','bc7a0000-0000-4000-8000-00000000000a','bc700000-0000-4000-8000-000000000001','admin_club',           null),
  ('bc750000-0000-4000-8000-00000000000d','bc7a0000-0000-4000-8000-00000000000d','bc700000-0000-4000-8000-000000000001','director',              null),
  ('bc750000-0000-4000-8000-00000000000e','bc7a0000-0000-4000-8000-00000000000e','bc700000-0000-4000-8000-000000000001','director',              current_date - 10),
  ('bc750000-0000-4000-8000-000000000011','bc7a0000-0000-4000-8000-000000000011','bc700000-0000-4000-8000-000000000001','entrenador_principal',  null),
  ('bc750000-0000-4000-8000-000000000012','bc7a0000-0000-4000-8000-000000000012','bc700000-0000-4000-8000-000000000001','jugador',               null);

do $$
declare v_cat uuid;
begin
  select id into v_cat from public.categories where club_id = 'bc700000-0000-4000-8000-000000000001' limit 1;
  if v_cat is null then
    insert into public.categories (club_id, name) values ('bc700000-0000-4000-8000-000000000001', 'Alevin')
    returning id into v_cat;
  end if;
  insert into public.teams (id, club_id, category_id, name, format, season)
  values ('bc7b0000-0000-4000-8000-000000000001','bc700000-0000-4000-8000-000000000001', v_cat, 'Alevin BC7', 'F7', '2026-27');
end $$;

-- El tutor entrena ese equipo: es lo que el club tendra que cubrir.
insert into public.team_staff (team_id, membership_id, staff_role)
values ('bc7b0000-0000-4000-8000-000000000001','bc750000-0000-4000-8000-000000000011','entrenador_principal');

-- Pau: solo el tutor (bloquea). Nil: tutor + otro tutor (no bloquea, pero genera aviso).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('bc7c0000-0000-4000-8000-000000000001','bc700000-0000-4000-8000-000000000001','Pau','Unico','2014-01-01'),
  ('bc7c0000-0000-4000-8000-000000000002','bc700000-0000-4000-8000-000000000001','Nil','Compartido','2014-02-02');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('bc7c0000-0000-4000-8000-000000000001','bc7a0000-0000-4000-8000-000000000011','parent'),
  ('bc7c0000-0000-4000-8000-000000000002','bc7a0000-0000-4000-8000-000000000011','parent'),
  ('bc7c0000-0000-4000-8000-000000000002','bc7a0000-0000-4000-8000-000000000012','parent');


-- ── [1]-[5] · el tutor pide el borrado ───────────────────────────────────────
do $$
declare v_n int; v_p jsonb;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc7a0000-0000-4000-8000-000000000011","role":"authenticated"}';
  perform public.request_account_deletion('me voy');
  reset role;

  -- [1]
  select count(*) into v_n from public.notifications
   where type = 'account_deletion_requested'
     and user_id in ('bc7a0000-0000-4000-8000-00000000000a','bc7a0000-0000-4000-8000-00000000000d');
  if v_n <> 2 then raise exception 'FAIL [1]: esperaba 2 avisos al club, hubo %', v_n; end if;
  select count(*) into v_n from public.notifications
   where type = 'account_deletion_requested' and user_id = 'bc7a0000-0000-4000-8000-00000000000e';
  if v_n <> 0 then raise exception 'FAIL [1b]: el director de baja recibio aviso'; end if;

  -- [2] CANDADO de RGPD: el nombre no puede viajar en el payload.
  select payload into v_p from public.notifications
   where type = 'account_deletion_requested' and user_id = 'bc7a0000-0000-4000-8000-00000000000a';
  if v_p ? 'name' then raise exception 'FAIL [2]: el payload lleva el nombre: %', v_p; end if;
  if v_p->>'role' <> 'entrenador_principal' then raise exception 'FAIL [2a]: role = %', v_p->>'role'; end if;
  if v_p->'teams' <> '["Alevin BC7"]'::jsonb then raise exception 'FAIL [2b]: teams = %', v_p->'teams'; end if;
  if (v_p->>'blocking_players')::int <> 1 then
    raise exception 'FAIL [2c]: blocking_players = %', v_p->>'blocking_players';
  end if;

  -- [2d] la fecha que viaja en el aviso es la de la FILA, no un now() recalculado:
  --      si divergieran, el club veria un plazo distinto del que manda.
  if (v_p->>'deadline_at')::timestamptz is distinct from
     (select deadline_at from public.account_deletion_requests
       where profile_id = 'bc7a0000-0000-4000-8000-000000000011') then
    raise exception 'FAIL [2d]: deadline_at del payload no casa con la fila';
  end if;

  -- [3] no es admin_club -> plataforma no se entera.
  select count(*) into v_n from public.notifications where user_id = 'bc7a0000-0000-4000-8000-00000000000f';
  if v_n <> 0 then raise exception 'FAIL [3]: el superadmin recibio aviso de un no-admin'; end if;

  -- [4] el arreglo: la supresion de Pau la creo la RPC y disparo el trigger de D6.
  select count(*) into v_n from public.notifications
   where type = 'erasure_requested' and user_id = 'bc7a0000-0000-4000-8000-00000000000e';
  if v_n <> 0 then raise exception 'FAIL [4]: erasure_requested aviso a un director de baja'; end if;
  select count(*) into v_n from public.notifications
   where type = 'erasure_requested'
     and user_id in ('bc7a0000-0000-4000-8000-00000000000a','bc7a0000-0000-4000-8000-00000000000d');
  if v_n <> 2 then raise exception 'FAIL [4b]: esperaba 2 erasure_requested, hubo %', v_n; end if;

  -- [5] el borrado es CANCELABLE: cerrar team_staff aqui dejaria al entrenador sin sus
  --     equipos si se arrepiente (set_membership_left no los reabre al reactivar).
  select count(*) into v_n from public.team_staff
   where membership_id = 'bc750000-0000-4000-8000-000000000011' and left_at is null;
  if v_n <> 1 then raise exception 'FAIL [5]: team_staff se cerro al solicitar'; end if;
end $$;


-- ── [6]-[8] · el club aprueba y el servidor remata ───────────────────────────
do $$
declare v_n int; v_p jsonb;
begin
  update public.erasure_requests set status = 'approved', decided_at = now()
   where player_id = 'bc7c0000-0000-4000-8000-000000000001' and status = 'pending';

  perform public.finalize_account_deletion('bc7a0000-0000-4000-8000-000000000011');

  -- [6]
  select count(*) into v_n from public.notifications
   where type = 'tutor_unlinked' and user_id = 'bc7a0000-0000-4000-8000-000000000012';
  if v_n <> 1 then raise exception 'FAIL [6]: esperaba 1 tutor_unlinked, hubo %', v_n; end if;
  select payload into v_p from public.notifications
   where type = 'tutor_unlinked' and user_id = 'bc7a0000-0000-4000-8000-000000000012';
  if v_p->>'player_first_name' <> 'Nil' then
    raise exception 'FAIL [6b]: player_first_name = %', v_p->>'player_first_name';
  end if;

  -- [7]
  select count(*) into v_n from public.notifications
   where type = 'account_deletion_requested' and payload ? 'name';
  if v_n <> 0 then raise exception 'FAIL [7]: hay % payloads con nombre', v_n; end if;
  select count(*) into v_n from public.notifications where type = 'account_deletion_requested';
  if v_n <> 2 then raise exception 'FAIL [7b]: se perdieron avisos, quedan %', v_n; end if;

  -- [8]
  select count(*) into v_n from public.team_staff
   where membership_id = 'bc750000-0000-4000-8000-000000000011' and left_at is null;
  if v_n <> 0 then raise exception 'FAIL [8]: team_staff sigue abierto tras rematar'; end if;
end $$;


-- ── [9]-[10] · un admin_club que se borra escala a plataforma ────────────────
do $$
declare v_n int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc7a0000-0000-4000-8000-00000000000a","role":"authenticated"}';
  perform public.request_account_deletion(null);
  reset role;

  -- [9]
  select count(*) into v_n from public.notifications
   where type = 'account_deletion_requested'
     and user_id = 'bc7a0000-0000-4000-8000-00000000000f'
     and (payload->>'is_platform')::boolean;
  if v_n <> 1 then raise exception 'FAIL [9]: esperaba 1 escalado al superadmin, hubo %', v_n; end if;

  -- [10]
  perform public.finalize_account_deletion('bc7a0000-0000-4000-8000-00000000000a');
  select count(*) into v_n from public.notifications
   where type = 'account_deletion_completed' and user_id = 'bc7a0000-0000-4000-8000-00000000000f';
  if v_n <> 1 then raise exception 'FAIL [10]: esperaba 1 account_deletion_completed, hubo %', v_n; end if;
end $$;


\echo ''
\echo '───────────────────────────────────────────────'
\echo '✅ Tests BC-7 (avisos del borrado de cuenta): 10 bloques pasaron.'
\echo '───────────────────────────────────────────────'

rollback;
