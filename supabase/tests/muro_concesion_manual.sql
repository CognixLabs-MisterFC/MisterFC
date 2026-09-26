-- MURO E-1 — la CONCESIÓN manual: acceso dado a mano, con caducidad.
--
-- QUÉ SE PROTEGE. El muro tiene que encenderse antes de enviar a las tiendas, y encendido
-- hoy deja fuera a las 8 cuentas de familia de producción: no por no pagar, sino porque no
-- hay tienda viva donde pagar. La concesión es la palanca que lo evita.
--
-- LAS DOS ASERCIONES QUE MÁS VALEN:
--
--   [1] Con la tabla VACÍA, los siete estados son los de antes, uno por uno. Es la prueba
--       de que esta migración, aplicada y sin conceder nada, no cambia el acceso de nadie.
--
--   [3] Un perfil concedido recibe `active` de `my_subscription_status`, y NO `granted`.
--       Parece al revés de lo razonable y es la decisión central: `reads.ts` convierte un
--       estado desconocido en `none` y FUERZA `hasAccess=false`, así que un nombre nuevo
--       pondría el muro justo a quien tiene acceso concedido, en todo build ya publicado
--       —y `EXPO_PUBLIC_SUBSCRIPTION_GATE` se incrusta al construir y no hay OTA—. Si
--       alguien "arregla" esto devolviendo `granted`, este bloque es lo que lo caza.
--
-- Cubre:
--   [0]  La tabla: RLS, sin policies, motivo obligatorio y no vacío, valid_until sin default.
--   [1]  Tabla VACÍA: los siete estados intactos.
--   [2]  Concesión vigente: `granted` y veredicto favorable.
--   [3]  EL CAREO: has_paid_access = my_subscription_status().has_access, y state=`active`.
--   [4]  Concesión CADUCADA: no da nada.
--   [5]  `unlinked` GANA a la concesión (ADR-0022 §4: el borrado no se reabre).
--   [6]  Quien paga sale `active`, no `granted`: la concesión es respaldo, no atajo.
--   [7]  `staff_free` gana: a quien no le hace falta no se le concede nada.
--   [8]  El espejo: `granted`, no negado, y con la FECHA de la concesión.
--   [9]  Candados: la tabla cerrada a anon/authenticated; las funciones como estaban.
--   [10] CONTROL NEGATIVO: sin la fila de concesión, [2] y [3] se invierten.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final). Las
-- funciones cerradas a `authenticated` se llaman como postgres; el careo se hace con el
-- rol de la sesión, que es como lo vive la app.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('e1700000-0000-4000-8000-000000000001', 'Club Concesion', 'club-concesion-e1');

insert into public.seasons (id, club_id, label, status) values
  ('e17c0000-0000-4000-8000-000000000001', 'e1700000-0000-4000-8000-000000000001', '2026-27', 'active');

-- f0 = familia sin nada · f1 = con acceso vivo · f2 = en gracia · f3 = caducada
-- f4 = desenganchada por borrado · e1 = entrenador
select pg_temp.new_test_user('e17a0000-0000-4000-8000-000000000000', 'f0@conc.test', '{}'::jsonb);
select pg_temp.new_test_user('e17a0000-0000-4000-8000-000000000001', 'f1@conc.test', '{}'::jsonb);
select pg_temp.new_test_user('e17a0000-0000-4000-8000-000000000002', 'f2@conc.test', '{}'::jsonb);
select pg_temp.new_test_user('e17a0000-0000-4000-8000-000000000003', 'f3@conc.test', '{}'::jsonb);
select pg_temp.new_test_user('e17a0000-0000-4000-8000-000000000004', 'f4@conc.test', '{}'::jsonb);
select pg_temp.new_test_user('e17a0000-0000-4000-8000-00000000000e', 'e1@conc.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('e17a0000-0000-4000-8000-000000000000', 'e1700000-0000-4000-8000-000000000001', 'jugador'),
  ('e17a0000-0000-4000-8000-000000000001', 'e1700000-0000-4000-8000-000000000001', 'jugador'),
  ('e17a0000-0000-4000-8000-000000000002', 'e1700000-0000-4000-8000-000000000001', 'jugador'),
  ('e17a0000-0000-4000-8000-000000000003', 'e1700000-0000-4000-8000-000000000001', 'jugador'),
  ('e17a0000-0000-4000-8000-000000000004', 'e1700000-0000-4000-8000-000000000001', 'jugador'),
  ('e17a0000-0000-4000-8000-00000000000e', 'e1700000-0000-4000-8000-000000000001', 'entrenador_principal');

insert into public.subscription_entitlements (profile_id, expires_at) values
  ('e17a0000-0000-4000-8000-000000000001', now() + interval '200 days'),
  ('e17a0000-0000-4000-8000-000000000003', now() - interval '2 days');

insert into public.subscription_entitlements
  (profile_id, expires_at, grace_period_expires_at, billing_issue_detected_at) values
  ('e17a0000-0000-4000-8000-000000000002', now() - interval '3 days',
   now() + interval '10 days', now() - interval '3 days');

insert into public.subscription_entitlements (profile_id, expires_at, unlinked_at) values
  ('e17a0000-0000-4000-8000-000000000004', now() + interval '200 days', now());

-- ─────────────────────────────────────────────────────────────────────────────
-- [0] La tabla.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_txt text;
begin
  if not exists (select 1 from pg_class
                  where oid = 'public.subscription_grants'::regclass and relrowsecurity) then
    raise exception 'FAIL [0]: subscription_grants sin RLS activada';
  end if;

  if exists (select 1 from pg_policies
              where schemaname = 'public' and tablename = 'subscription_grants') then
    raise exception 'FAIL [0]: subscription_grants tiene policies. Va SIN ninguna: con RLS activada y sin policies no la toca nadie desde PostgREST';
  end if;

  select is_nullable into v_txt from information_schema.columns
   where table_schema = 'public' and table_name = 'subscription_grants'
     and column_name = 'valid_until';
  if v_txt <> 'NO' then
    raise exception 'FAIL [0]: valid_until admite NULL. Una concesión sin fecha es la que se queda puesta para siempre';
  end if;

  select column_default into v_txt from information_schema.columns
   where table_schema = 'public' and table_name = 'subscription_grants'
     and column_name = 'valid_until';
  if v_txt is not null then
    raise exception 'FAIL [0]: valid_until tiene default (%). El operador tiene que decir hasta cuándo', v_txt;
  end if;

  -- El motivo no puede ser una cadena vacía: una lista de UUID sin motivo es una lista
  -- que nadie se atreve a limpiar.
  begin
    insert into public.subscription_grants (profile_id, motivo, valid_until) values
      ('e17a0000-0000-4000-8000-000000000000', '   ', now() + interval '30 days');
    raise exception 'FAIL [0]: se ha podido conceder con el motivo en blanco';
  exception when check_violation then null;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] TABLA VACÍA: los siete estados, uno por uno. Sin esto, todo lo de abajo podría
--     estar midiendo una función que ha cambiado el acceso de todo el mundo.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  r record;
  v_estado text;
begin
  if (select count(*) from public.subscription_grants) <> 0 then
    raise exception 'FAIL [1]: el fixture esperaba la tabla de concesiones VACÍA';
  end if;

  for r in
    select * from (values
      ('e17a0000-0000-4000-8000-000000000000'::uuid, 'none'),
      ('e17a0000-0000-4000-8000-000000000001'::uuid, 'active'),
      ('e17a0000-0000-4000-8000-000000000002'::uuid, 'grace'),
      ('e17a0000-0000-4000-8000-000000000003'::uuid, 'expired'),
      ('e17a0000-0000-4000-8000-000000000004'::uuid, 'unlinked'),
      ('e17a0000-0000-4000-8000-00000000000e'::uuid, 'staff_free')
    ) as t(uid, esperado)
  loop
    v_estado := public.subscription_access_state(r.uid);
    if v_estado <> r.esperado then
      raise exception 'FAIL [1]: sin conceder nada, % tenía que ser % y dijo %',
        r.uid, r.esperado, v_estado;
    end if;
    -- Y el veredicto, que es lo que de verdad decide, sigue siendo el mismo.
    if public.subscription_grants_access(r.uid)
       <> (r.esperado in ('staff_free', 'active', 'grace')) then
      raise exception 'FAIL [1]: el veredicto de % (%) ha cambiado', r.uid, r.esperado;
    end if;
  end loop;

  if public.subscription_access_state(null) <> 'no_session' then
    raise exception 'FAIL [1]: sin perfil tenía que decir no_session';
  end if;
end $$;

-- ── Se concede a la familia que no tiene nada ───────────────────────────────
insert into public.subscription_grants (profile_id, motivo, valid_until) values
  ('e17a0000-0000-4000-8000-000000000000', 'E-1: sin tiendas vivas donde pagar',
   now() + interval '30 days');

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] La concesión se ve y da acceso.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_estado text;
begin
  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-000000000000');
  if v_estado <> 'granted' then
    raise exception 'FAIL [2]: con concesión vigente el estado tenía que ser granted, dijo %', v_estado;
  end if;
  if not public.subscription_grants_access('e17a0000-0000-4000-8000-000000000000') then
    raise exception 'FAIL [2]: granted tiene que dar acceso. Falta en la lista de subscription_grants_access';
  end if;
end $$;

-- ── Se enciende el muro: sin encenderlo, has_paid_access() diría true siempre y el
--    careo de [3] no mediría nada.
insert into public.subscription_wall (id, enabled, enabled_at) values (true, true, now())
  on conflict (id) do update set enabled = true, enabled_at = now();

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] EL CAREO, y la decisión central: la app recibe `active`, no `granted`.
-- ─────────────────────────────────────────────────────────────────────────────
create temp table _e1(predicado boolean, has_access boolean, estado text, hasta timestamptz)
  on commit drop;
grant all on _e1 to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e17a0000-0000-4000-8000-000000000000","role":"authenticated"}';
insert into _e1
  select public.has_paid_access(), s.has_access, s.state, s.access_until
    from public.my_subscription_status() s;
reset role;

do $$
declare r record;
begin
  select * into r from _e1;

  if not r.predicado then
    raise exception 'FAIL [3]: con el muro encendido y concesión vigente, has_paid_access() tenía que dejar pasar';
  end if;
  if r.has_access is distinct from r.predicado then
    raise exception 'FAIL [3]: la base y la app no dicen lo mismo (predicado=%, has_access=%). Si divergen, o el muro sale con el producto abierto detrás, o la pantalla deja entrar y la base niega',
      r.predicado, r.has_access;
  end if;
  if r.estado <> 'active' then
    raise exception 'FAIL [3]: la app tenía que recibir `active` y recibió `%`. Un estado que el cliente no conoce lo convierte en `none` y FUERZA hasAccess=false (reads.ts): con un nombre nuevo, todo build ya publicado pondría el muro justo a quien tiene acceso concedido, y sin OTA no se arregla', r.estado;
  end if;
  if r.hasta is null then
    raise exception 'FAIL [3]: la app tenía que recibir la fecha de la concesión, y recibió NULL';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Una concesión CADUCADA no da nada. Es lo que hace que una lista olvidada se cierre
--     sola en vez de regalar el producto para siempre.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_estado text;
begin
  update public.subscription_grants set valid_until = now() - interval '1 day'
   where profile_id = 'e17a0000-0000-4000-8000-000000000000';

  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-000000000000');
  if v_estado <> 'none' then
    raise exception 'FAIL [4]: con la concesión caducada tenía que volver a none, dijo %', v_estado;
  end if;
  if public.subscription_grants_access('e17a0000-0000-4000-8000-000000000000') then
    raise exception 'FAIL [4]: una concesión caducada ha dado acceso';
  end if;

  update public.subscription_grants set valid_until = now() + interval '30 days'
   where profile_id = 'e17a0000-0000-4000-8000-000000000000';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] `unlinked` GANA a la concesión. Una cuenta desenganchada por borrado no se reabre
--     por nada (ADR-0022 §4), y una concesión no es una excepción a eso.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_estado text;
begin
  insert into public.subscription_grants (profile_id, motivo, valid_until) values
    ('e17a0000-0000-4000-8000-000000000004', 'no debería servir de nada',
     now() + interval '30 days');

  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-000000000004');
  if v_estado <> 'unlinked' then
    raise exception 'FAIL [5]: una cuenta desenganchada con concesión vigente dijo %. El borrado manda sobre todo lo demás', v_estado;
  end if;
  if public.subscription_grants_access('e17a0000-0000-4000-8000-000000000004') then
    raise exception 'FAIL [5]: una concesión ha resucitado una cuenta borrada';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] Quien PAGA sale `active`, no `granted`: la concesión es un respaldo y no puede
--     tapar la verdad de que hay una suscripción detrás.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_estado text;
begin
  insert into public.subscription_grants (profile_id, motivo, valid_until) values
    ('e17a0000-0000-4000-8000-000000000001', 'concedida además de pagar',
     now() + interval '30 days');

  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-000000000001');
  if v_estado <> 'active' then
    raise exception 'FAIL [6]: quien paga tenía que seguir siendo active y dijo %', v_estado;
  end if;

  -- Y la de gracia también conserva su nombre: es la que dice que hay un impago abierto.
  insert into public.subscription_grants (profile_id, motivo, valid_until) values
    ('e17a0000-0000-4000-8000-000000000002', 'concedida además de estar en gracia',
     now() + interval '30 days');
  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-000000000002');
  if v_estado <> 'grace' then
    raise exception 'FAIL [6]: la gracia tenía que conservar su nombre y dijo %. Con `granted` encima, nadie sabría que hay un impago abierto', v_estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] `staff_free` gana: a quien no le hace falta, no se le concede nada.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_estado text;
begin
  insert into public.subscription_grants (profile_id, motivo, valid_until) values
    ('e17a0000-0000-4000-8000-00000000000e', 'no hace falta', now() + interval '30 days');

  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-00000000000e');
  if v_estado <> 'staff_free' then
    raise exception 'FAIL [7]: el entrenador tenía que seguir siendo staff_free y dijo %', v_estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] El espejo dice la verdad: `granted`, no negado, y CON la fecha. Sin la fecha, quien
--     opera vería "no se le niega" sin ver cuándo se le cierra.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.subscription_wall_mirror()
   where profile_id = 'e17a0000-0000-4000-8000-000000000000';

  if r.state <> 'granted' then
    raise exception 'FAIL [8]: el espejo tenía que distinguir la concesión (granted) y dijo %. Es el único sitio donde se ve el porqué', r.state;
  end if;
  if r.would_be_denied then
    raise exception 'FAIL [8]: el espejo sigue negando a un perfil con concesión vigente';
  end if;
  if r.access_until is null then
    raise exception 'FAIL [8]: el espejo no trae la fecha de la concesión';
  end if;

  -- Y a quien paga le sigue trayendo la fecha de SU suscripción, no la de la concesión
  -- (es la más lejana: 200 días contra 30).
  select * into r from public.subscription_wall_mirror()
   where profile_id = 'e17a0000-0000-4000-8000-000000000001';
  if r.access_until < now() + interval '100 days' then
    raise exception 'FAIL [8]: con compra y concesión, la fecha tenía que ser la más lejana y trajo %', r.access_until;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] Candados. Con has_table_privilege / has_function_privilege, nunca provocando el
--     42501: un 42501 tumba la BD efímera del CI.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_rol text;
  v_priv text;
begin
  for v_rol in select unnest(array['anon', 'authenticated']) loop
    for v_priv in select unnest(array['select', 'insert', 'update', 'delete']) loop
      if has_table_privilege(v_rol, 'public.subscription_grants', v_priv) then
        raise exception 'FAIL [9]: % puede hacer % sobre subscription_grants. Los privilegios por defecto de Supabase la abren POR NOMBRE: hace falta el revoke explícito', v_rol, v_priv;
      end if;
    end loop;

    -- Las funciones del servidor siguen cerradas: nadie pregunta por el estado de un
    -- tercero, ni lista el de todo el mundo.
    if has_function_privilege(v_rol, 'public.subscription_access_state(uuid)', 'execute')
       or has_function_privilege(v_rol, 'public.subscription_grants_access(uuid)', 'execute')
       or has_function_privilege(v_rol, 'public.subscription_wall_mirror()', 'execute') then
      raise exception 'FAIL [9]: % ha ganado EXECUTE en una función del servidor. `create or replace` conserva la ACL: si esto salta, alguien la ha recreado con DROP', v_rol;
    end if;
  end loop;

  -- Y las dos que la app SÍ necesita siguen concedidas. De esto depende que las 18
  -- policies de M-3 funcionen: sin el EXECUTE, fallan con 42501 para todo el mundo.
  if not has_function_privilege('authenticated', 'public.has_paid_access()', 'execute') then
    raise exception 'FAIL [9]: authenticated ha perdido EXECUTE en has_paid_access(). Las 18 policies de M-3 fallarían con 42501';
  end if;
  if not has_function_privilege('authenticated', 'public.my_subscription_status()', 'execute') then
    raise exception 'FAIL [9]: authenticated ha perdido EXECUTE en my_subscription_status(): la app no podría leer su estado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [10] CONTROL NEGATIVO. Sin la fila de concesión, [2] y [3] se invierten. Si esto
--      fallara, el acceso de arriba lo estaría dando otra cosa y la concesión no estaría
--      probada. El rollback repone todo.
-- ─────────────────────────────────────────────────────────────────────────────
delete from public.subscription_grants
 where profile_id = 'e17a0000-0000-4000-8000-000000000000';

do $$
declare v_estado text;
begin
  v_estado := public.subscription_access_state('e17a0000-0000-4000-8000-000000000000');
  if v_estado <> 'none' then
    raise exception 'FAIL [10a]: sin concesión el estado tenía que volver a none y dijo %. El granted de [2] no lo daba la concesión', v_estado;
  end if;
  if public.subscription_grants_access('e17a0000-0000-4000-8000-000000000000') then
    raise exception 'FAIL [10b]: sin concesión sigue teniendo acceso. El sí de [3] no lo daba la concesión';
  end if;
end $$;

-- Y el careo, también al revés: sin concesión, la app y la base tienen que negar LAS DOS.
delete from _e1;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"e17a0000-0000-4000-8000-000000000000","role":"authenticated"}';
insert into _e1
  select public.has_paid_access(), s.has_access, s.state, s.access_until
    from public.my_subscription_status() s;
reset role;

do $$
declare r record;
begin
  select * into r from _e1;
  if r.predicado or r.has_access then
    raise exception 'FAIL [10c]: sin concesión y con el muro encendido tenían que negar las dos (predicado=%, has_access=%)',
      r.predicado, r.has_access;
  end if;
  if r.estado <> 'none' then
    raise exception 'FAIL [10d]: sin concesión la app tenía que recibir none y recibió %', r.estado;
  end if;
end $$;

rollback;
