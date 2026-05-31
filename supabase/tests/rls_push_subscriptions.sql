-- F5 Lote B — Tests RLS de `push_subscriptions`.
--
-- Cobertura:
--   P1. user inserta su propia suscripción → OK.
--   P2. user intenta insertar con user_id ajeno → ❌.
--   P3. user SELECT solo ve sus filas.
--   P4. user DELETE solo sus filas (otro user no puede borrar la mía).

begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44444444-4444-4444-8444-44444444d001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'a@push.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-44444444d002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'b@push.test', now(), '{}'::jsonb, now(), now());

-- ─────────────────────────────────────────────────────────────────────────────
-- P1: insert propio
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444d001","role":"authenticated"}';
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values
    ('44444444-4444-4444-8444-44444444d001',
     'https://push.test/endpoint-a',
     'p256dh-aaaa', 'auth-aaaa', 'Chrome/Linux')
  returning id into v_id;
  reset role;
  if v_id is null then
    raise exception 'FAIL [P1]: usuario no pudo insertar su propia subscription';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- P2: insert con user_id ajeno → ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444d001","role":"authenticated"}';
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
      ('44444444-4444-4444-8444-44444444d002',
       'https://push.test/cross', 'p', 'a');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [P2]: user A pudo crear subscription para user B';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- P3: SELECT solo propias filas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_b_count int;
begin
  -- B no debe ver la subscription de A.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444d002","role":"authenticated"}';
  select count(*) into v_b_count from public.push_subscriptions
   where endpoint = 'https://push.test/endpoint-a';
  reset role;
  if v_b_count <> 0 then
    raise exception 'FAIL [P3]: user B ve subscription de A (count=%)', v_b_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- P4: DELETE solo propias filas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-44444444d002","role":"authenticated"}';
  delete from public.push_subscriptions where endpoint = 'https://push.test/endpoint-a';
  reset role;
  select count(*) into v_count from public.push_subscriptions
   where endpoint = 'https://push.test/endpoint-a';
  if v_count <> 1 then
    raise exception 'FAIL [P4]: user B pudo borrar subscription de A (rest count=%)', v_count;
  end if;
end $$;

rollback;

select 'OK rls_push_subscriptions' as result;
