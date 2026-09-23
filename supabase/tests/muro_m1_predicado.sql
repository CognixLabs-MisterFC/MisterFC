-- MURO M-1 — el predicado del muro de pago (migracion 20261104000000).
--
-- Lo que esta migracion promete es DOBLE, y las dos mitades se comprueban aqui:
--   · que el predicado decide bien en los ocho estados posibles, y
--   · que NO cambia nada todavia — el bloque [12] falla si alguna politica ya lo usa.
--
-- LA ASERCION QUE MAS VALE es [9]: con el muro encendido, `has_paid_access()` tiene que
-- decir EXACTAMENTE lo mismo que `my_subscription_status().has_access`. Si divergen, la
-- app ensena una cosa y la base hace otra: o el muro aparece con el producto abierto
-- detras, o —lo caro— la pantalla deja entrar y la base niega, y quien paga ve
-- pantallas en blanco. Son dos implementaciones de la misma regla y hay que atarlas.
--
-- Cubre:
--   [1]  APAGADO (enabled=false): pasa hasta la familia sin ninguna suscripcion.
--   [2]  APAGADO POR AUSENCIA (sin fila): igual. El modo de fallo benigno es el que NO
--        deja fuera a quien paga.
--   [3]  Encendido · familia SIN entitlement -> no.
--   [4]  Encendido · familia con acceso vivo -> si.
--   [5]  Encendido · EN GRACIA (impago abierto, gracia futura) -> si. `access_until` es
--        greatest(expires_at, grace), y la gracia da acceso: decision de Jose.
--   [6]  Encendido · caducado -> no.
--   [7]  Encendido · desenganchado por borrado de cuenta -> no, aunque la fecha viva.
--   [8]  Encendido · STAFF sin pagar -> si. Y el entrenador que ADEMAS es padre -> si:
--        el staff GANA sobre el vinculo familiar.
--   [9]  COHERENCIA con my_subscription_status().has_access en los seis casos.
--   [10] Sin sesion -> no.
--   [11] CANDADOS: la tabla del interruptor, cerrada a anon y authenticated (nadie se
--        abre el muro a si mismo); la FUNCION, concedida a authenticated.
--
--        AVISO SOBRE ESTA ULTIMA, medido: si se revoca el EXECUTE a `authenticated`, el
--        fichero se pone rojo en el bloque [1] con un 42501, no aqui — [1] ya llama a la
--        funcion con ese rol. O sea que la proteccion de verdad la dan [1]-[10] y esta
--        linea NO llega a dispararse nunca: esta para que el motivo quede escrito junto
--        al candado, no como control. No se cuenta como comprobacion.
--
--        Y el `grant` de la migracion es REDUNDANTE hoy: los privilegios por defecto de
--        Supabase ya conceden EXECUTE a `authenticated` POR NOMBRE. Se escribe igual,
--        explicito, porque de eso depende que las policies de M-3 funcionen y no quiero
--        que dependa de un default que nadie ve.
--
--
-- BLOQUE [12] RETIRADO (M-3, mig 20261106000000). Decia "ninguna policy menciona todavia has_paid_access" y era cierto hasta que M-3
-- enchufo las 18 politicas. Una asercion que el proyecto ha decidido incumplir a
-- proposito no se deja fallando ni se comenta a medias: se retira y se dice donde vive
-- ahora lo que sostenia.
--
-- Lo que sostenia era "entra el codigo, no el efecto". Eso lo miden ahora:
--   · `muro_m3_politicas.sql` [10] — la migracion deja el interruptor APAGADO;
--   · `muro_m3_politicas.sql` [1]  — el candado esta en las 18 tablas y SOLO en esas;
--   · y el bloque [1] de este mismo fichero, que ya comprueba que con el interruptor
--     apagado pasa todo el mundo.
--
-- No se sustituye por una comprobacion nueva aqui porque este fichero ENCIENDE el
-- interruptor a mitad para medir, asi que no puede afirmar nada sobre su valor al final.
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Las aserciones LEEN con el rol de la sesion: las comprobaciones de estado van
-- como postgres.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('ba700000-0000-4000-8000-000000000001', 'Club Muro', 'club-muro-m1');

insert into public.seasons (id, club_id, label, status) values
  ('ba7c0000-0000-4000-8000-000000000001', 'ba700000-0000-4000-8000-000000000001', '2026-27', 'active');

-- f0 = familia sin nada · f1 = con acceso vivo · f2 = en gracia · f3 = caducada
-- f4 = desenganchada · e1 = entrenador · e2 = entrenador QUE ADEMAS es padre
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-000000000000', 'f0@muro.test', '{}'::jsonb);
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-000000000001', 'f1@muro.test', '{}'::jsonb);
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-000000000002', 'f2@muro.test', '{}'::jsonb);
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-000000000003', 'f3@muro.test', '{}'::jsonb);
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-000000000004', 'f4@muro.test', '{}'::jsonb);
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-00000000000e', 'e1@muro.test', '{}'::jsonb);
select pg_temp.new_test_user('ba7a0000-0000-4000-8000-00000000000f', 'e2@muro.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('ba7a0000-0000-4000-8000-000000000000', 'ba700000-0000-4000-8000-000000000001', 'jugador'),
  ('ba7a0000-0000-4000-8000-000000000001', 'ba700000-0000-4000-8000-000000000001', 'jugador'),
  ('ba7a0000-0000-4000-8000-000000000002', 'ba700000-0000-4000-8000-000000000001', 'jugador'),
  ('ba7a0000-0000-4000-8000-000000000003', 'ba700000-0000-4000-8000-000000000001', 'jugador'),
  ('ba7a0000-0000-4000-8000-000000000004', 'ba700000-0000-4000-8000-000000000001', 'jugador'),
  ('ba7a0000-0000-4000-8000-00000000000e', 'ba700000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('ba7a0000-0000-4000-8000-00000000000f', 'ba700000-0000-4000-8000-000000000001', 'entrenador_ayudante');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('ba7b0000-0000-4000-8000-000000000001', 'ba700000-0000-4000-8000-000000000001', 'Hijo', 'Muro', '2014-03-03');

-- e2 es entrenador Y padre: es el caso que mide que el staff GANA.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('ba7b0000-0000-4000-8000-000000000001', 'ba7a0000-0000-4000-8000-00000000000f', 'parent');

insert into public.subscription_entitlements (profile_id, expires_at) values
  ('ba7a0000-0000-4000-8000-000000000001', now() + interval '200 days'),
  ('ba7a0000-0000-4000-8000-000000000003', now() - interval '2 days');

-- En gracia: el periodo pagado vencio y la tienda da gracia hasta dentro de 10 dias.
insert into public.subscription_entitlements
  (profile_id, expires_at, grace_period_expires_at, billing_issue_detected_at) values
  ('ba7a0000-0000-4000-8000-000000000002', now() - interval '3 days',
   now() + interval '10 days', now() - interval '3 days');

-- Desenganchada por borrado: la fecha sigue viva y aun asi no da acceso.
insert into public.subscription_entitlements (profile_id, expires_at, unlinked_at) values
  ('ba7a0000-0000-4000-8000-000000000004', now() + interval '200 days', now());

-- Recolector: las respuestas se guardan y se juzgan al final, como postgres.
create temp table _m(caso text, uid uuid, predicado boolean, has_access boolean) on commit drop;
grant all on _m to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] APAGADO: pasa todo el mundo, incluida la familia sin nada.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ba7a0000-0000-4000-8000-000000000000","role":"authenticated"}';
do $$
begin
  if not public.has_paid_access() then
    raise exception 'FAIL [1]: con el interruptor apagado tenia que pasar todo el mundo';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] APAGADO POR AUSENCIA DE FILA: mismo resultado.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
delete from public.subscription_wall;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ba7a0000-0000-4000-8000-000000000000","role":"authenticated"}';
do $$
begin
  if not public.has_paid_access() then
    raise exception 'FAIL [2]: sin fila de interruptor el muro no existe: tenia que pasar';
  end if;
end $$;

-- ── Se enciende ──────────────────────────────────────────────────────────────
reset role;
insert into public.subscription_wall (id, enabled, enabled_at) values (true, true, now());

-- ─────────────────────────────────────────────────────────────────────────────
-- [3]-[8] Los seis estados, con el muro encendido. Se recoge tambien
--         my_subscription_status().has_access para el careo de [9].
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record; v_pred boolean; v_has boolean;
begin
  for r in select * from (values
      ('3_sin_suscripcion', 'ba7a0000-0000-4000-8000-000000000000'::uuid),
      ('4_acceso_vivo',     'ba7a0000-0000-4000-8000-000000000001'::uuid),
      ('5_en_gracia',       'ba7a0000-0000-4000-8000-000000000002'::uuid),
      ('6_caducada',        'ba7a0000-0000-4000-8000-000000000003'::uuid),
      ('7_desenganchada',   'ba7a0000-0000-4000-8000-000000000004'::uuid),
      ('8a_entrenador',     'ba7a0000-0000-4000-8000-00000000000e'::uuid),
      ('8b_entrena_y_padre','ba7a0000-0000-4000-8000-00000000000f'::uuid)
    ) as t(caso, uid)
  loop
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.uid, 'role', 'authenticated')::text, true);
    v_pred := public.has_paid_access();
    select s.has_access into v_has from public.my_subscription_status() s;
    perform set_config('role', 'postgres', true);
    insert into _m values (r.caso, r.uid, v_pred, v_has);
  end loop;
end $$;

reset role;
do $$
declare r record;
begin
  for r in select * from _m loop
    if r.caso in ('4_acceso_vivo','5_en_gracia','8a_entrenador','8b_entrena_y_padre')
       and r.predicado is not true then
      raise exception 'FAIL [%]: tenia que PASAR y no paso', r.caso;
    end if;
    if r.caso in ('3_sin_suscripcion','6_caducada','7_desenganchada')
       and r.predicado is not false then
      raise exception 'FAIL [%]: tenia que NO pasar y paso', r.caso;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] COHERENCIA con lo que ensena la app. La asercion que de verdad protege.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in select * from _m where predicado is distinct from has_access loop
    raise exception 'FAIL [9]: % — la base dice % y la app ensena %. Divergen: quien paga veria pantallas en blanco, o el muro tendria el producto abierto detras',
      r.caso, r.predicado, r.has_access;
  end loop;
  if (select count(*) from _m) <> 7 then
    raise exception 'FAIL [9]: se esperaban 7 casos medidos, hay %', (select count(*) from _m);
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [10] Sin sesion.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
reset "request.jwt.claims";
do $$
begin
  if public.has_paid_access() then
    raise exception 'FAIL [10]: sin sesion no se pasa';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [11] CANDADOS.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_table_privilege('anon', 'public.subscription_wall', 'select') then
    raise exception 'FAIL [11]: anon lee el interruptor';
  end if;
  if has_table_privilege('authenticated', 'public.subscription_wall', 'select')
     or has_table_privilege('authenticated', 'public.subscription_wall', 'update')
     or has_table_privilege('authenticated', 'public.subscription_wall', 'insert')
     or has_table_privilege('authenticated', 'public.subscription_wall', 'delete') then
    raise exception 'FAIL [11]: authenticated toca el interruptor — un admin podria apagarse su propio muro';
  end if;
  if has_function_privilege('anon', 'public.has_paid_access()', 'execute') then
    raise exception 'FAIL [11]: anon ejecuta has_paid_access';
  end if;
  -- Y al reves: SIN este grant, las politicas de M-3 darian 42501 a TODO el mundo.
  if not has_function_privilege('authenticated', 'public.has_paid_access()', 'execute') then
    raise exception 'FAIL [11]: authenticated NO puede ejecutar has_paid_access: las policies de M-3 fallarian para todos';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [12] M-1 NO ENCHUFA NADA.
reset role;
rollback;
