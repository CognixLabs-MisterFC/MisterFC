-- O2-4 PR-1 — Tests RLS + alta idempotente de `expo_push_tokens`.
--
-- Cobertura:
--   E1. user inserta su propio token (policy insert own) → OK.
--   E2. user inserta con user_id ajeno → ❌.
--   E3. user SELECT solo ve sus filas.
--   E4. user DELETE solo sus filas (otro user no borra la mía).
--   E5. register_expo_push_token idempotente: 2º registro del mismo token NO
--       duplica y refresca last_seen_at.
--   E6. reasignación: si B registra un token de A, la fila pasa a B (1 sola fila).
--   E7. service_role ve todas + puede borrar (limpieza de token muerto).
--   E8. register sin sesión (auth.uid() null) → ❌.
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('e0e0e0e0-0000-4000-8000-0000000000a1', 'a@expo.test', '{}'::jsonb);
select pg_temp.new_test_user('e0e0e0e0-0000-4000-8000-0000000000b2', 'b@expo.test', '{}'::jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- E1: insert propio (policy insert own)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000a1","role":"authenticated"}';
  insert into public.expo_push_tokens (user_id, token, platform, device_info) values
    ('e0e0e0e0-0000-4000-8000-0000000000a1', 'ExponentPushToken[AAA]', 'android', 'Pixel 7')
  returning id into v_id;
  reset role;
  if v_id is null then
    raise exception 'FAIL [E1]: usuario no pudo insertar su propio token';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E2: insert con user_id ajeno → ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000a1","role":"authenticated"}';
  begin
    insert into public.expo_push_tokens (user_id, token) values
      ('e0e0e0e0-0000-4000-8000-0000000000b2', 'ExponentPushToken[CROSS]');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [E2]: user A pudo crear token para user B';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E3: SELECT solo propias filas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_b_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000b2","role":"authenticated"}';
  select count(*) into v_b_count from public.expo_push_tokens
   where token = 'ExponentPushToken[AAA]';
  reset role;
  if v_b_count <> 0 then
    raise exception 'FAIL [E3]: user B ve token de A (count=%)', v_b_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E4: DELETE solo propias filas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000b2","role":"authenticated"}';
  delete from public.expo_push_tokens where token = 'ExponentPushToken[AAA]';
  reset role;
  select count(*) into v_count from public.expo_push_tokens
   where token = 'ExponentPushToken[AAA]';
  if v_count <> 1 then
    raise exception 'FAIL [E4]: user B pudo borrar token de A (rest count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E5: register_expo_push_token idempotente (no duplica + refresca last_seen_at)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int; v_before timestamptz; v_after timestamptz;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000a1","role":"authenticated"}';
  perform public.register_expo_push_token('ExponentPushToken[IDEM]', 'android', 'Pixel');
  reset role;

  -- Backdate manual (service_role) para comprobar el refresh de last_seen_at.
  set local role service_role;
  update public.expo_push_tokens set last_seen_at = now() - interval '1 day'
   where token = 'ExponentPushToken[IDEM]';
  select last_seen_at into v_before from public.expo_push_tokens
   where token = 'ExponentPushToken[IDEM]';
  reset role;

  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000a1","role":"authenticated"}';
  perform public.register_expo_push_token('ExponentPushToken[IDEM]', 'android', 'Pixel 7 Pro');
  reset role;

  set local role service_role;
  select count(*), max(last_seen_at) into v_count, v_after from public.expo_push_tokens
   where token = 'ExponentPushToken[IDEM]';
  reset role;

  if v_count <> 1 then
    raise exception 'FAIL [E5]: register duplicó el token (count=%)', v_count;
  end if;
  if v_after <= v_before then
    raise exception 'FAIL [E5]: register no refrescó last_seen_at (before=% after=%)', v_before, v_after;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E6: reasignación — B registra un token que era de A → pasa a B, 1 sola fila
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_owner uuid; v_count int;
begin
  -- A registra el token.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000a1","role":"authenticated"}';
  perform public.register_expo_push_token('ExponentPushToken[SHARED]', 'android', null);
  reset role;

  -- El mismo dispositivo cambia de cuenta: B registra el MISMO token.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"e0e0e0e0-0000-4000-8000-0000000000b2","role":"authenticated"}';
  perform public.register_expo_push_token('ExponentPushToken[SHARED]', 'android', null);
  reset role;

  set local role service_role;
  select user_id, count(*) over () into v_owner, v_count from public.expo_push_tokens
   where token = 'ExponentPushToken[SHARED]';
  reset role;

  if v_count <> 1 then
    raise exception 'FAIL [E6]: reasignación duplicó el token (count=%)', v_count;
  end if;
  if v_owner <> 'e0e0e0e0-0000-4000-8000-0000000000b2' then
    raise exception 'FAIL [E6]: el token no se reasignó a B (owner=%)', v_owner;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E7: service_role ve todas + puede borrar (limpieza de token muerto)
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_all int; v_rest int;
begin
  set local role service_role;
  select count(*) into v_all from public.expo_push_tokens;
  if v_all < 2 then
    raise exception 'FAIL [E7]: service_role no ve todas las filas (count=%)', v_all;
  end if;
  -- Borrar un token "muerto" (DeviceNotRegistered) como hace el emisor.
  delete from public.expo_push_tokens where token = 'ExponentPushToken[SHARED]';
  select count(*) into v_rest from public.expo_push_tokens
   where token = 'ExponentPushToken[SHARED]';
  reset role;
  if v_rest <> 0 then
    raise exception 'FAIL [E7]: service_role no pudo borrar el token muerto (rest=%)', v_rest;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- E8: register sin sesión (auth.uid() null) → ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"role":"authenticated"}';  -- sin "sub"
  begin
    perform public.register_expo_push_token('ExponentPushToken[ANON]', 'android', null);
  exception when others then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [E8]: register sin sesión no falló';
  end if;
end $$;

rollback;

select 'OK rls_expo_push_tokens' as result;
