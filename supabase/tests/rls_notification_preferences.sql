-- F5 Lote B — Tests RLS de `notification_preferences` + helper SQL.
--
-- Cobertura:
--   N1. user upsert su propia preferencia → OK.
--   N2. user intenta upsert con user_id ajeno → ❌.
--   N3. SELECT solo ve sus filas.
--   N4. helper user_wants_notification: default true cuando NO hay fila.
--   N5. helper user_wants_notification: respeta enabled=false explícito.
\ir helpers/auth_users.sql

begin;

select pg_temp.new_test_user('44444444-4444-4444-8444-44444444e001', 'a@pref.test', '{}'::jsonb);
select pg_temp.new_test_user('44444444-4444-4444-8444-44444444e002', 'b@pref.test', '{}'::jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- N1: insert propio
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444e001","role":"authenticated"}';
  insert into public.notification_preferences (user_id, type, channel, enabled) values
    ('44444444-4444-4444-8444-44444444e001', 'new_message', 'push', false);
  reset role;
  select count(*) into v_count from public.notification_preferences
   where user_id = '44444444-4444-4444-8444-44444444e001';
  if v_count <> 1 then
    raise exception 'FAIL [N1]: usuario no pudo guardar su preferencia';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N2: insert con user_id ajeno → ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444e001","role":"authenticated"}';
  begin
    insert into public.notification_preferences (user_id, type, channel, enabled) values
      ('44444444-4444-4444-8444-44444444e002', 'new_message', 'push', false);
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [N2]: user A pudo guardar preferencia para user B';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N3: SELECT solo propias filas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_b_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444e002","role":"authenticated"}';
  select count(*) into v_b_count from public.notification_preferences
   where user_id = '44444444-4444-4444-8444-44444444e001';
  reset role;
  if v_b_count <> 0 then
    raise exception 'FAIL [N3]: user B ve preferencia de A (count=%)', v_b_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N4: helper user_wants_notification default true sin fila
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_wants boolean;
begin
  select public.user_wants_notification(
    '44444444-4444-4444-8444-44444444e002',
    'new_announcement',
    'push'
  ) into v_wants;
  if v_wants is not true then
    raise exception 'FAIL [N4]: default LEFT JOIN no devuelve true (got %)', v_wants;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N5: helper respeta enabled=false
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_wants boolean;
begin
  select public.user_wants_notification(
    '44444444-4444-4444-8444-44444444e001',
    'new_message',
    'push'
  ) into v_wants;
  if v_wants is not false then
    raise exception 'FAIL [N5]: helper no respeta enabled=false (got %)', v_wants;
  end if;
end $$;

rollback;

select 'OK rls_notification_preferences' as result;
