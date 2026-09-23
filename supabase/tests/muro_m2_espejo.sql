-- MURO M-2 — el espejo (migracion 20261105000000).
--
-- LA ASERCION QUE SOSTIENE TODO ES [3]: para cada perfil, lo que dice el espejo tiene
-- que ser EXACTAMENTE lo que hara `has_paid_access()` cuando ese perfil consulte con el
-- muro encendido. Un espejo que no coincide con el cristal es peor que no tener espejo:
-- se mira la lista, sale limpia, se enciende el muro y deja fuera a quien paga.
--
-- Se comprueba de la unica forma que vale: encendiendo el interruptor DENTRO de la
-- transaccion y preguntando de verdad como cada uno de los siete perfiles.
--
-- Cubre:
--   [1]  Las cuatro funciones existen (si no, la migracion esta sin aplicar).
--   [2]  El espejo lista a TODO el mundo, no solo a quien pagaria: un entrenador mal
--        clasificado tiene que poder verse en la lista.
--   [3]  CAREO ESPEJO ↔ PREDICADO, perfil a perfil, con el muro ENCENDIDO.
--   [4]  El espejo contesta lo mismo con el muro APAGADO. Es su razon de ser: se mira
--        ANTES de encender, y si callara mientras esta apagado no serviria de nada.
--   [5]  Los seis estados, con su nombre.
--   [6]  El staff GANA: entrenador que ademas es padre -> staff_free, no negado.
--   [7]  COHERENCIA DE NOMBRES con la app: `subscription_access_state(uid)` tiene que
--        decir lo mismo que `my_subscription_status().state`. No basta con que coincida
--        el booleano: si los nombres divergen, el aviso de la app y la lista de Jose
--        hablan de cosas distintas.
--   [8]  Los negados salen PRIMERO. La lista larga se lee por arriba.
--   [9]  CANDADOS: ni anon ni authenticated ejecutan el espejo ni las dos funciones por
--        perfil — listan el estado de suscripcion de terceros. `has_paid_access` SI
--        sigue concedida a authenticated.
--   [10] M-2 SIGUE SIN ENCHUFAR NADA: ninguna policy usa el predicado.
--
-- Que el reparto no cambio el comportamiento de `has_paid_access()` lo mide
-- `muro_m1_predicado.sql`, que corre en la misma suite y NO se ha tocado.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Las aserciones LEEN con el rol de la sesion: las comprobaciones van como
-- postgres.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── T1 ───────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.subscription_wall_mirror()') is null
     or to_regprocedure('public.subscription_access_state(uuid)') is null
     or to_regprocedure('public.subscription_grants_access(uuid)') is null then
    raise exception 'FAIL [1]: falta alguna funcion — la migracion 20261105000000 no esta aplicada';
  end if;
end $$;

-- ── Fixture: los mismos siete casos que M-1 ─────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('bb700000-0000-4000-8000-000000000001', 'Club Espejo', 'club-espejo-m2');

insert into public.seasons (id, club_id, label, status) values
  ('bb7c0000-0000-4000-8000-000000000001', 'bb700000-0000-4000-8000-000000000001', '2026-27', 'active');

select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000000', 'f0@espejo.test', '{"full_name":"Fam Sin Nada"}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000001', 'f1@espejo.test', '{"full_name":"Fam Al Dia"}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000002', 'f2@espejo.test', '{"full_name":"Fam En Gracia"}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000003', 'f3@espejo.test', '{"full_name":"Fam Caducada"}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-000000000004', 'f4@espejo.test', '{"full_name":"Fam Desenganchada"}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-00000000000e', 'e1@espejo.test', '{"full_name":"Entrenador"}'::jsonb);
select pg_temp.new_test_user('bb7a0000-0000-4000-8000-00000000000f', 'e2@espejo.test', '{"full_name":"Entrenador Y Padre"}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('bb7a0000-0000-4000-8000-000000000000', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000001', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000002', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000003', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-000000000004', 'bb700000-0000-4000-8000-000000000001', 'jugador'),
  ('bb7a0000-0000-4000-8000-00000000000e', 'bb700000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('bb7a0000-0000-4000-8000-00000000000f', 'bb700000-0000-4000-8000-000000000001', 'entrenador_ayudante');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('bb7b0000-0000-4000-8000-000000000001', 'bb700000-0000-4000-8000-000000000001', 'Hijo', 'Espejo', '2014-03-03');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('bb7b0000-0000-4000-8000-000000000001', 'bb7a0000-0000-4000-8000-00000000000f', 'parent');

insert into public.subscription_entitlements (profile_id, expires_at) values
  ('bb7a0000-0000-4000-8000-000000000001', now() + interval '200 days'),
  ('bb7a0000-0000-4000-8000-000000000003', now() - interval '2 days');

insert into public.subscription_entitlements
  (profile_id, expires_at, grace_period_expires_at, billing_issue_detected_at) values
  ('bb7a0000-0000-4000-8000-000000000002', now() - interval '3 days',
   now() + interval '10 days', now() - interval '3 days');

insert into public.subscription_entitlements (profile_id, expires_at, unlinked_at) values
  ('bb7a0000-0000-4000-8000-000000000004', now() + interval '200 days', now());

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] El espejo los lista a los siete.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.subscription_wall_mirror()
   where profile_id::text like 'bb7a0000%';
  if v_n <> 7 then
    raise exception 'FAIL [2]: el espejo tenia que listar los 7 perfiles del fixture, listo %', v_n;
  end if;
  -- Y en concreto a los que NO pagan: un entrenador mal clasificado se ve aqui o no se
  -- ve en ninguna parte.
  if not exists (
    select 1 from public.subscription_wall_mirror()
     where profile_id = 'bb7a0000-0000-4000-8000-00000000000e'
  ) then
    raise exception 'FAIL [2]: el espejo se salta al staff — entonces no sirve para cazar a un entrenador mal clasificado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Con el muro APAGADO el espejo ya contesta. (Va antes de [3] porque [3]
--     enciende el interruptor y ya no se puede volver a medir esto.)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_apagado boolean; v_negados integer;
begin
  select enabled into v_apagado from public.subscription_wall where id;
  if coalesce(v_apagado, false) then
    raise exception 'FAIL [4]: el fixture esperaba el interruptor APAGADO';
  end if;
  select count(*) into v_negados from public.subscription_wall_mirror()
   where profile_id::text like 'bb7a0000%' and would_be_denied;
  if v_negados <> 3 then
    raise exception 'FAIL [4]: con el muro apagado el espejo tenia que seguir senalando a los 3 negados, dijo %', v_negados;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Los seis estados con su nombre. [6] va dentro: el entrenador-padre.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record; v_esp text;
begin
  for r in select * from public.subscription_wall_mirror() where profile_id::text like 'bb7a0000%' loop
    v_esp := case right(r.profile_id::text, 1)
               when '0' then 'none' when '1' then 'active' when '2' then 'grace'
               when '3' then 'expired' when '4' then 'unlinked' else 'staff_free' end;
    if r.state <> v_esp then
      raise exception 'FAIL [5]: % esperaba estado % y dio %', r.full_name, v_esp, r.state;
    end if;
  end loop;
  -- [6] El staff GANA sobre el vinculo familiar.
  if exists (
    select 1 from public.subscription_wall_mirror()
     where profile_id = 'bb7a0000-0000-4000-8000-00000000000f'
       and (state <> 'staff_free' or would_be_denied)
  ) then
    raise exception 'FAIL [6]: el entrenador que ademas es padre tenia que ser staff_free y no quedar negado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] Los negados, primero.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  -- No puede haber un negado POR DEBAJO de alguien que pasa.
  if exists (
    select 1 from (
      select would_be_denied, row_number() over () n from public.subscription_wall_mirror()
    ) x
    where x.would_be_denied
      and x.n > (
        select min(y.n) from (
          select would_be_denied, row_number() over () n from public.subscription_wall_mirror()
        ) y where not y.would_be_denied
      )
  ) then
    raise exception 'FAIL [8]: hay un negado por debajo de alguien que pasa — la lista no se lee por arriba';
  end if;
end $$;

-- ── Se enciende el interruptor: a partir de aqui se mide contra la realidad ──
update public.subscription_wall set enabled = true, enabled_at = now() where id;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] CAREO ESPEJO ↔ PREDICADO, y [7] careo de NOMBRES con la app.
-- ─────────────────────────────────────────────────────────────────────────────
create temp table _c(uid uuid, espejo_niega boolean, predicado boolean,
                     estado_espejo text, estado_app text) on commit drop;
grant all on _c to authenticated;

do $$
declare r record; v_pred boolean; v_app text;
begin
  for r in select profile_id, would_be_denied, state
             from public.subscription_wall_mirror()
            where profile_id::text like 'bb7a0000%'
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.profile_id, 'role', 'authenticated')::text, true);
    v_pred := public.has_paid_access();
    select s.state into v_app from public.my_subscription_status() s;
    perform set_config('role', 'postgres', true);
    insert into _c values (r.profile_id, r.would_be_denied, v_pred, r.state, v_app);
  end loop;
end $$;

reset role;
do $$
declare r record;
begin
  if (select count(*) from _c) <> 7 then
    raise exception 'FAIL [3]: se esperaban 7 careos, hay %', (select count(*) from _c);
  end if;
  for r in select * from _c loop
    if r.espejo_niega = r.predicado then
      raise exception 'FAIL [3]: % — el espejo dice negado=% y la base, con el muro encendido, contesta %. El espejo miente: se mira la lista, sale limpia, se enciende y deja fuera a quien paga',
        r.uid, r.espejo_niega, r.predicado;
    end if;
    if r.estado_espejo <> r.estado_app then
      raise exception 'FAIL [7]: % — el espejo llama a esto "%" y la app ensena "%". Los nombres tienen que ser los mismos o el aviso de la app y la lista hablan de cosas distintas',
        r.uid, r.estado_espejo, r.estado_app;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] CANDADOS.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.subscription_wall_mirror()', 'execute')
     or has_function_privilege('authenticated', 'public.subscription_wall_mirror()', 'execute') then
    raise exception 'FAIL [9]: el espejo esta abierto al cliente — lista el estado de suscripcion de todo el mundo';
  end if;
  if has_function_privilege('authenticated', 'public.subscription_access_state(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.subscription_grants_access(uuid)', 'execute') then
    raise exception 'FAIL [9]: authenticated puede preguntar por el estado de un tercero';
  end if;
  if not has_function_privilege('authenticated', 'public.has_paid_access()', 'execute') then
    raise exception 'FAIL [9]: el reparto se llevo por delante el grant de has_paid_access: las policies de M-3 fallarian para todos';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [10] M-2 sigue sin enchufar nada.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_pol text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into v_pol
    from pg_policies
   where schemaname = 'public'
     and coalesce(qual, '') || coalesce(with_check, '') like '%has_paid_access%';
  if v_pol is not null then
    raise exception 'FAIL [10]: M-2 tampoco enchufa nada, y estas politicas ya lo usan: %', v_pol;
  end if;
end $$;

reset role;
rollback;
