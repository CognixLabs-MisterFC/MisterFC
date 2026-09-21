-- Correo-B · recuperacion — limite de envios del correo de restablecer contrasena
-- (migracion 20261092000000).
--
-- Cubre:
--   [1]  Por correo: diez pasan, el once no. Con llamadas REALES, no con filas plantadas.
--   [2]  La ventana RUEDA: lo de hace veinte minutos no cuenta.
--   [3]  Por IP, ventana corta: 20 / 15 min, medida con correos CON CUENTA para que no
--        la dispare de rebote la regla de enumeracion.
--   [4]  Por IP, ventana de dia: 60 / 24 h.
--   [5]  Enumeracion: 5 correos SIN CUENTA por IP en una hora.
--   [6]  NO DISTINGUE: por debajo del limite, correo con cuenta y sin cuenta devuelven
--        lo mismo. Si divergieran, el limitador seria el oraculo que /forgot-password
--        evita contestando siempre igual.
--   [7]  Normaliza: mayusculas y espacios son el MISMO correo (si no, el limite por
--        correo se saltaria tecleando "Ana@..." en vez de "ana@..."). Y el correo
--        vacio no deja fila ni consume hueco.
--   [8]  IP nula: las reglas de IP no aplican, la del correo si.
--   [9]  Privilegios: ni anon ni authenticated ejecutan ni leen la tabla. service_role si.
--   [10] La purga borra a las 25 h y CONSERVA lo de 24, que es lo que necesita la
--        ventana de dia para no quedarse floja por detras.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_function_privilege / has_table_privilege, NUNCA
-- provocando el 42501 (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on

\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- 30 cuentas reales en auth.users. Hacen falta muchas porque las reglas de IP se
-- miden en decenas y, con correos inventados, saltaria antes la regla 4.
do $$
declare
  g integer;
begin
  for g in 1..30 loop
    perform pg_temp.new_test_user(
      ('5c000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
      'rec-' || g || '@test.local',
      '{}'::jsonb
    );
  end loop;
end $$;

-- ── [1] Por correo: diez pasan, el once no ───────────────────────────────────
do $$
declare
  v_dec text;
  v_ret integer;
  i integer;
begin
  for i in 1..10 loop
    select decision, retry_after_seconds into v_dec, v_ret
      from public.register_password_recovery_attempt('rec-1@test.local', '203.0.113.1'::inet);
    if v_dec <> 'ok' then
      raise exception '[1] el intento % del correo debia pasar y devolvio %', i, v_dec;
    end if;
    if v_ret <> 0 then
      raise exception '[1] un ok no lleva espera y llevo %', v_ret;
    end if;
  end loop;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_password_recovery_attempt('rec-1@test.local', '203.0.113.1'::inet);
  if v_dec <> 'rate_limited' then
    raise exception '[1] el intento 11 del mismo correo debia frenarse y devolvio %', v_dec;
  end if;
  if v_ret <= 0 or v_ret > 900 then
    raise exception '[1] la espera debe caer dentro de la ventana de 15 min y vale %', v_ret;
  end if;
end $$;

-- ── [2] La ventana rueda ─────────────────────────────────────────────────────
-- Mismo correo del [1], pero envejeciendo sus intentos: si la ventana es deslizante
-- de verdad, vuelve a atender.
do $$
declare
  v_dec text;
begin
  update public.password_recovery_attempts
     set created_at = now() - interval '20 minutes'
   where email = 'rec-1@test.local';

  select decision into v_dec
    from public.register_password_recovery_attempt('rec-1@test.local', '203.0.113.1'::inet);
  if v_dec <> 'ok' then
    raise exception '[2] pasados 20 min la ventana debia estar vacia y devolvio %', v_dec;
  end if;
end $$;

-- ── [3] Por IP, ventana corta ────────────────────────────────────────────────
-- 20 intentos de la misma IP hace un minuto (mas viejos que nada, mas nuevos que la
-- ventana). Correos CON CUENTA, para medir la regla 2 y no la 4.
do $$
declare
  v_dec text;
  v_ret integer;
begin
  insert into public.password_recovery_attempts (email, ip, account_known, allowed, created_at)
  select 'rec-' || g || '@test.local', '203.0.113.20'::inet, true, true, now() - interval '1 minute'
  from generate_series(1, 20) g;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_password_recovery_attempt('rec-21@test.local', '203.0.113.20'::inet);

  if v_dec <> 'rate_limited' then
    raise exception '[3] la IP llevaba 20 intentos en 15 min y el 21 paso: %', v_dec;
  end if;
  if v_ret <= 0 or v_ret > 900 then
    raise exception '[3] espera fuera de la ventana corta: %', v_ret;
  end if;
end $$;

-- ── [4] Por IP, ventana de dia ───────────────────────────────────────────────
-- 60 intentos repartidos en el dia, todos FUERA de la ventana corta (mas de 15 min)
-- para que quien frene sea la regla 3 y no la 2.
do $$
declare
  v_dec text;
  v_ret integer;
begin
  insert into public.password_recovery_attempts (email, ip, account_known, allowed, created_at)
  select
    'rec-' || ((g % 30) + 1) || '@test.local',
    '203.0.113.40'::inet,
    true,
    true,
    now() - interval '20 minutes' - (g * interval '10 minutes')
  from generate_series(1, 60) g;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_password_recovery_attempt('rec-22@test.local', '203.0.113.40'::inet);

  if v_dec <> 'rate_limited' then
    raise exception '[4] la IP llevaba 60 intentos en 24 h y el 61 paso: %', v_dec;
  end if;
  if v_ret <= 0 or v_ret > 86400 then
    raise exception '[4] espera fuera de la ventana de dia: %', v_ret;
  end if;
end $$;

-- ── [5] Enumeracion: correos sin cuenta ──────────────────────────────────────
-- Cinco correos que NO existen desde la misma IP. El sexto no pasa, aunque la IP
-- este lejisimos del limite de 20/15 min.
do $$
declare
  v_dec text;
  v_ret integer;
  i integer;
begin
  for i in 1..5 loop
    select decision into v_dec
      from public.register_password_recovery_attempt(
        'nadie-' || i || '@test.local', '203.0.113.50'::inet);
    if v_dec <> 'ok' then
      raise exception '[5] el barrido % debia pasar todavia y devolvio %', i, v_dec;
    end if;
  end loop;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_password_recovery_attempt('nadie-6@test.local', '203.0.113.50'::inet);
  if v_dec <> 'rate_limited' then
    raise exception '[5] el sexto correo sin cuenta desde la misma IP paso: %', v_dec;
  end if;
  if v_ret <= 0 or v_ret > 3600 then
    raise exception '[5] espera fuera de la ventana de enumeracion: %', v_ret;
  end if;

  -- Y la regla 4 NO frena a quien presenta correos que SI existen: una familia en
  -- el wifi del club no es un barrido.
  select decision into v_dec
    from public.register_password_recovery_attempt('rec-23@test.local', '203.0.113.50'::inet);
  if v_dec <> 'ok' then
    raise exception '[5] la regla de enumeracion freno a un correo CON cuenta: %', v_dec;
  end if;
end $$;

-- ── [6] No distingue cuenta conocida de desconocida ──────────────────────────
-- IP limpia, los dos primeros intentos: por debajo de todos los limites la respuesta
-- tiene que ser identica. Si no, el limitador filtra quien esta registrado.
do $$
declare
  v_dec_si text; v_ret_si integer;
  v_dec_no text; v_ret_no integer;
begin
  select decision, retry_after_seconds into v_dec_si, v_ret_si
    from public.register_password_recovery_attempt('rec-24@test.local', '203.0.113.60'::inet);
  select decision, retry_after_seconds into v_dec_no, v_ret_no
    from public.register_password_recovery_attempt('fantasma@test.local', '203.0.113.60'::inet);

  if v_dec_si <> v_dec_no or v_ret_si <> v_ret_no then
    raise exception '[6] la respuesta delata si el correo tiene cuenta: (%, %) vs (%, %)',
      v_dec_si, v_ret_si, v_dec_no, v_ret_no;
  end if;

  -- Y la tabla SI lo distingue: es lo que alimenta la regla 4.
  if not exists (
    select 1 from public.password_recovery_attempts
     where email = 'rec-24@test.local' and account_known
  ) then
    raise exception '[6] un correo con cuenta se registro como desconocido';
  end if;
  if not exists (
    select 1 from public.password_recovery_attempts
     where email = 'fantasma@test.local' and not account_known
  ) then
    raise exception '[6] un correo sin cuenta se registro como conocido';
  end if;
end $$;

-- ── [7] Normalizacion y correo vacio ─────────────────────────────────────────
do $$
declare
  v_dec   text;
  v_antes integer;
  v_desp  integer;
begin
  -- Mayusculas y espacios cuentan en el MISMO cubo que la forma normalizada.
  delete from public.password_recovery_attempts where email = 'rec-25@test.local';
  perform public.register_password_recovery_attempt('  REC-25@Test.Local  ', '203.0.113.70'::inet);

  if not exists (
    select 1 from public.password_recovery_attempts where email = 'rec-25@test.local'
  ) then
    raise exception '[7] el correo no se normalizo: el limite se saltaria con mayusculas';
  end if;

  -- Correo vacio: ni fila ni hueco gastado.
  select count(*) into v_antes from public.password_recovery_attempts;
  select decision into v_dec
    from public.register_password_recovery_attempt('   ', '203.0.113.70'::inet);
  select count(*) into v_desp from public.password_recovery_attempts;

  if v_dec <> 'ok' then
    raise exception '[7] el correo vacio devolvio %, y no hay nada que frenar', v_dec;
  end if;
  if v_desp <> v_antes then
    raise exception '[7] el correo vacio dejo fila: % -> %', v_antes, v_desp;
  end if;
end $$;

-- ── [8] IP nula ──────────────────────────────────────────────────────────────
-- Sin IP las reglas 2, 3 y 4 no aplican; la del correo sigue aplicando.
do $$
declare
  v_dec text;
  i integer;
begin
  for i in 1..10 loop
    perform public.register_password_recovery_attempt('rec-27@test.local', null);
  end loop;

  select decision into v_dec
    from public.register_password_recovery_attempt('rec-27@test.local', null);
  if v_dec <> 'rate_limited' then
    raise exception '[8] sin IP la regla del correo debe seguir aplicando y devolvio %', v_dec;
  end if;

  -- Y otro correo distinto, tambien sin IP, no arrastra el bloqueo del anterior.
  select decision into v_dec
    from public.register_password_recovery_attempt('rec-28@test.local', null);
  if v_dec <> 'ok' then
    raise exception '[8] sin IP el bloqueo de un correo contagio a otro: %', v_dec;
  end if;
end $$;

-- ── [9] Privilegios ──────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.register_password_recovery_attempt(text, inet)', 'execute') then
    raise exception '[9] anon puede ejecutar el contador';
  end if;
  if has_function_privilege('authenticated', 'public.register_password_recovery_attempt(text, inet)', 'execute') then
    raise exception '[9] authenticated puede ejecutar el contador';
  end if;
  if not has_function_privilege('service_role', 'public.register_password_recovery_attempt(text, inet)', 'execute') then
    raise exception '[9] service_role NO puede ejecutar el contador, y es quien lo llama';
  end if;

  if has_function_privilege('anon', 'public.purge_password_recovery_attempts()', 'execute') then
    raise exception '[9] anon puede ejecutar la purga';
  end if;
  if has_function_privilege('authenticated', 'public.purge_password_recovery_attempts()', 'execute') then
    raise exception '[9] authenticated puede ejecutar la purga';
  end if;
  if not has_function_privilege('service_role', 'public.purge_password_recovery_attempts()', 'execute') then
    raise exception '[9] service_role NO puede ejecutar la purga, y la llama el cron';
  end if;

  -- La tabla no se lee desde fuera: guarda correos e IPs.
  if has_table_privilege('anon', 'public.password_recovery_attempts', 'select') then
    raise exception '[9] anon lee la tabla de intentos';
  end if;
  if has_table_privilege('authenticated', 'public.password_recovery_attempts', 'select') then
    raise exception '[9] authenticated lee la tabla de intentos';
  end if;
end $$;

-- ── [10] La purga respeta la ventana de dia ──────────────────────────────────
do $$
declare
  v_borradas  integer;
  v_quedan_24 integer;
  v_quedan_26 integer;
begin
  delete from public.password_recovery_attempts;

  insert into public.password_recovery_attempts (email, ip, account_known, allowed, created_at)
  values
    ('rec-29@test.local', '203.0.113.80'::inet, true, true, now() - interval '24 hours'),
    ('rec-29@test.local', '203.0.113.80'::inet, true, true, now() - interval '26 hours');

  select public.purge_password_recovery_attempts() into v_borradas;
  if v_borradas <> 1 then
    raise exception '[10] la purga debia borrar 1 fila y borro %', v_borradas;
  end if;

  select count(*) into v_quedan_24
    from public.password_recovery_attempts
   where created_at > now() - interval '25 hours';
  select count(*) into v_quedan_26
    from public.password_recovery_attempts
   where created_at < now() - interval '25 hours';

  if v_quedan_24 <> 1 then
    raise exception '[10] la purga se llevo por delante la fila de 24 h, que la ventana de dia necesita';
  end if;
  if v_quedan_26 <> 0 then
    raise exception '[10] la purga dejo una fila de 26 h';
  end if;
end $$;

rollback;
