-- R-2 — limite de intentos del endpoint publico de aceptacion (migracion 20261074000000).
-- Cubre:
--   [1]  Por token: diez pasan, el once no. Con llamadas REALES, no con filas plantadas.
--   [2]  La ventana RUEDA: lo de hace veinte minutos no cuenta.
--   [3]  Por IP, ventana corta: 20 / 15 min, medida con tokens CONOCIDOS para que no la
--        dispare de rebote la regla de enumeracion.
--   [4]  Por IP, ventana de dia: 60 / 24 h.
--   [5]  Enumeracion: 5 tokens DESCONOCIDOS por IP en una hora.
--   [6]  NO DISTINGUE: por debajo del limite, token conocido y desconocido devuelven lo
--        mismo. Si divergieran, el limitador seria el oraculo que viene a evitar.
--   [7]  EL TOKEN NO SE QUEMA: tras el rate_limited la invitacion sigue viva e intacta.
--   [8]  IP nula: las reglas de IP no aplican, la de token si.
--   [9]  Privilegios: ni anon ni authenticated ejecutan ni leen la tabla. service_role si.
--   [10] La purga borra a las 25 h y CONSERVA lo de 24, que es lo que necesita la
--        ventana de dia para no quedarse floja por detras.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_function_privilege / has_table_privilege, NUNCA
-- provocando el 42501 (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('4a000000-0000-4000-8000-000000000001', 'Club R2', 'club-r2');

-- 30 invitaciones vivas con token conocido. Hacen falta muchas porque las reglas de IP
-- se miden en decenas y, si se usaran tokens inventados, saltaria antes la regla 4.
insert into public.invitations (id, token, email, club_id, role)
select
  ('4a100000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  ('4a200000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
  'r2-' || g || '@test.test',
  '4a000000-0000-4000-8000-000000000001',
  'jugador'
from generate_series(1, 30) g;

-- Atajos legibles para los tokens conocidos.
create temp table t_known (n int primary key, token uuid);
insert into t_known
select g, ('4a200000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid
from generate_series(1, 30) g;

create temp table res (decision text, retry integer);

-- ── [1] Por token: diez pasan, el once no ────────────────────────────────────
do $$
declare
  v_tok uuid := (select token from t_known where n = 1);
  v_dec text;
  v_ret integer;
  i integer;
begin
  for i in 1..10 loop
    select decision, retry_after_seconds into v_dec, v_ret
      from public.register_invite_accept_attempt(v_tok, '203.0.113.1'::inet);
    if v_dec <> 'ok' then
      raise exception '[1] el intento % del token debia pasar y devolvio %', i, v_dec;
    end if;
    if v_ret <> 0 then
      raise exception '[1] un ok no lleva espera y llevo %', v_ret;
    end if;
  end loop;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_invite_accept_attempt(v_tok, '203.0.113.1'::inet);
  if v_dec <> 'rate_limited' then
    raise exception '[1] el intento 11 del mismo token debia frenarse y devolvio %', v_dec;
  end if;
  if v_ret <= 0 or v_ret > 900 then
    raise exception '[1] la espera debe caer dentro de la ventana de 15 min y vale %', v_ret;
  end if;
end $$;

-- ── [2] La ventana rueda ─────────────────────────────────────────────────────
-- Mismo token del [1], pero envejeciendo sus intentos: si la ventana es deslizante de
-- verdad, vuelve a atender.
do $$
declare
  v_tok uuid := (select token from t_known where n = 1);
  v_dec text;
begin
  update public.invite_accept_attempts
     set created_at = now() - interval '20 minutes'
   where token = v_tok;

  select decision into v_dec
    from public.register_invite_accept_attempt(v_tok, '203.0.113.1'::inet);
  if v_dec <> 'ok' then
    raise exception '[2] pasados 20 min la ventana debia estar vacia y devolvio %', v_dec;
  end if;
end $$;

-- ── [3] Por IP, ventana corta ────────────────────────────────────────────────
-- 20 intentos de la misma IP hace un minuto (mas viejos que nada, mas nuevos que la
-- ventana). Tokens CONOCIDOS, para medir la regla 2 y no la 4.
do $$
declare
  v_dec text;
  v_ret integer;
begin
  insert into public.invite_accept_attempts (token, ip, token_known, allowed, created_at)
  select token, '203.0.113.20'::inet, true, true, now() - interval '1 minute'
  from t_known where n between 1 and 20;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_invite_accept_attempt(
      (select token from t_known where n = 21), '203.0.113.20'::inet);

  if v_dec <> 'rate_limited' then
    raise exception '[3] la IP llevaba 20 intentos en 15 min y el 21 paso: %', v_dec;
  end if;
  if v_ret <= 0 or v_ret > 900 then
    raise exception '[3] espera fuera de la ventana corta: %', v_ret;
  end if;
end $$;

-- ── [4] Por IP, ventana de dia ───────────────────────────────────────────────
-- 60 intentos repartidos en el dia pero TODOS fuera de los 15 min, para que quien
-- frene sea la regla de dia y no la corta.
do $$
declare
  v_dec text;
  v_ret integer;
begin
  insert into public.invite_accept_attempts (token, ip, token_known, allowed, created_at)
  select
    (select token from t_known where n = 1),
    '203.0.113.40'::inet,
    true,
    true,
    now() - interval '20 minutes' - (g * interval '10 minutes')
  from generate_series(1, 60) g;

  select decision, retry_after_seconds into v_dec, v_ret
    from public.register_invite_accept_attempt(
      (select token from t_known where n = 22), '203.0.113.40'::inet);

  if v_dec <> 'rate_limited' then
    raise exception '[4] la IP llevaba 60 intentos en 24 h y el 61 paso: %', v_dec;
  end if;
  if v_ret <= 0 then
    raise exception '[4] la espera de la ventana de dia debe ser positiva y vale %', v_ret;
  end if;
end $$;

-- ── [5] Enumeracion: cinco tokens desconocidos por IP y hora ─────────────────
do $$
declare
  v_dec text;
  i integer;
begin
  for i in 1..5 loop
    select decision into v_dec
      from public.register_invite_accept_attempt(gen_random_uuid(), '203.0.113.50'::inet);
    if v_dec <> 'ok' then
      raise exception '[5] el barrido % debia pasar todavia y devolvio %', i, v_dec;
    end if;
  end loop;

  select decision into v_dec
    from public.register_invite_accept_attempt(gen_random_uuid(), '203.0.113.50'::inet);
  if v_dec <> 'rate_limited' then
    raise exception '[5] el sexto token desconocido de la misma IP debia frenarse: %', v_dec;
  end if;
end $$;

-- ── [6] No distingue conocido de desconocido ─────────────────────────────────
-- Misma IP limpia, un token que existe y otro que no. Por debajo del limite, la
-- respuesta tiene que ser identica: mismo veredicto y misma espera.
do $$
declare
  v_dec_known   text;
  v_ret_known   integer;
  v_dec_unknown text;
  v_ret_unknown integer;
begin
  select decision, retry_after_seconds into v_dec_known, v_ret_known
    from public.register_invite_accept_attempt(
      (select token from t_known where n = 25), '203.0.113.60'::inet);

  select decision, retry_after_seconds into v_dec_unknown, v_ret_unknown
    from public.register_invite_accept_attempt(gen_random_uuid(), '203.0.113.61'::inet);

  if v_dec_known <> v_dec_unknown or v_ret_known <> v_ret_unknown then
    raise exception '[6] la respuesta delata si el token existe: conocido=(%,%) desconocido=(%,%)',
      v_dec_known, v_ret_known, v_dec_unknown, v_ret_unknown;
  end if;
end $$;

-- ── [7] El token no se quema ─────────────────────────────────────────────────
do $$
declare
  v_tok      uuid := (select token from t_known where n = 30);
  v_expires  timestamptz;
  v_after    timestamptz;
  v_accepted timestamptz;
  v_dec      text;
  i integer;
begin
  select expires_at into v_expires from public.invitations where token = v_tok;

  for i in 1..11 loop
    select decision into v_dec
      from public.register_invite_accept_attempt(v_tok, '203.0.113.70'::inet);
  end loop;
  if v_dec <> 'rate_limited' then
    raise exception '[7] hacia falta llegar al freno para medir esto y no se llego: %', v_dec;
  end if;

  select accepted_at, expires_at into v_accepted, v_after
    from public.invitations where token = v_tok;

  if v_accepted is not null then
    raise exception '[7] el freno marco la invitacion como aceptada';
  end if;
  if v_after <> v_expires then
    raise exception '[7] el freno movio la caducidad de la invitacion';
  end if;
end $$;

-- ── [8] IP nula: reglas de IP fuera, regla de token dentro ───────────────────
do $$
declare
  v_dec text;
  i integer;
begin
  -- La IP nula no hereda el bloqueo de una IP saturada: son cubos distintos.
  select decision into v_dec
    from public.register_invite_accept_attempt(
      (select token from t_known where n = 26), null);
  if v_dec <> 'ok' then
    raise exception '[8] sin IP y con token limpio debia pasar y devolvio %', v_dec;
  end if;

  -- Pero el token sigue contando.
  for i in 1..10 loop
    perform public.register_invite_accept_attempt(
      (select token from t_known where n = 27), null);
  end loop;
  select decision into v_dec
    from public.register_invite_accept_attempt(
      (select token from t_known where n = 27), null);
  if v_dec <> 'rate_limited' then
    raise exception '[8] sin IP la regla de token debe seguir aplicando y devolvio %', v_dec;
  end if;
end $$;

-- ── [9] Privilegios ──────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.register_invite_accept_attempt(uuid, inet)', 'execute') then
    raise exception '[9] anon puede ejecutar el contador';
  end if;
  if has_function_privilege('authenticated', 'public.register_invite_accept_attempt(uuid, inet)', 'execute') then
    raise exception '[9] authenticated puede ejecutar el contador';
  end if;
  if not has_function_privilege('service_role', 'public.register_invite_accept_attempt(uuid, inet)', 'execute') then
    raise exception '[9] service_role NO puede ejecutar el contador, y es quien lo llama';
  end if;

  if has_function_privilege('anon', 'public.purge_invite_accept_attempts()', 'execute') then
    raise exception '[9] anon puede ejecutar la purga';
  end if;
  if has_function_privilege('authenticated', 'public.purge_invite_accept_attempts()', 'execute') then
    raise exception '[9] authenticated puede ejecutar la purga';
  end if;
  if not has_function_privilege('service_role', 'public.purge_invite_accept_attempts()', 'execute') then
    raise exception '[9] service_role NO puede ejecutar la purga, y la llama el cron';
  end if;

  -- La tabla no se lee desde fuera: guarda IPs.
  if has_table_privilege('anon', 'public.invite_accept_attempts', 'select') then
    raise exception '[9] anon lee la tabla de intentos';
  end if;
  if has_table_privilege('authenticated', 'public.invite_accept_attempts', 'select') then
    raise exception '[9] authenticated lee la tabla de intentos';
  end if;
end $$;

-- ── [10] La purga respeta la ventana de dia ──────────────────────────────────
do $$
declare
  v_tok       uuid := (select token from t_known where n = 28);
  v_borradas  integer;
  v_quedan_24 integer;
  v_quedan_26 integer;
begin
  delete from public.invite_accept_attempts;

  insert into public.invite_accept_attempts (token, ip, token_known, allowed, created_at)
  values
    (v_tok, '203.0.113.80'::inet, true, true, now() - interval '24 hours'),
    (v_tok, '203.0.113.80'::inet, true, true, now() - interval '26 hours');

  select public.purge_invite_accept_attempts() into v_borradas;
  if v_borradas <> 1 then
    raise exception '[10] la purga debia borrar 1 fila y borro %', v_borradas;
  end if;

  select count(*) into v_quedan_24
    from public.invite_accept_attempts
   where created_at > now() - interval '25 hours';
  select count(*) into v_quedan_26
    from public.invite_accept_attempts
   where created_at < now() - interval '25 hours';

  if v_quedan_24 <> 1 then
    raise exception '[10] la purga se llevo por delante la fila de 24 h, que la ventana de dia necesita';
  end if;
  if v_quedan_26 <> 0 then
    raise exception '[10] la purga dejo una fila de 26 h';
  end if;
end $$;

rollback;
