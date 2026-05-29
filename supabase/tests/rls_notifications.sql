-- Tests F4.7 — RLS y constraints de notifications.
--
-- Casos:
--   N1. INSERT via service_role → OK.
--   N2. INSERT via authenticated → 42501 (no policy INSERT).
--   N3. UNIQUE dedupe_key — segundo INSERT con misma clave → 23505.
--   N4. SELECT propio funciona; SELECT de otro user → 0 filas (RLS).
--   N5. UPDATE propio: pending → sent OK. setea sent_at automáticamente.
--   N6. UPDATE intentando cambiar payload → payload_immutable.

begin;

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44dd1000-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-a@ts.test', now(), '{}'::jsonb, now(), now()),
  ('44dd1000-aaaa-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-b@ts.test', now(), '{}'::jsonb, now(), now());

-- ─────────────────────────────────────────────────────────────────────────────
-- N1: INSERT como service_role
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  insert into public.notifications (user_id, type, channel, dedupe_key, payload) values
    ('44dd1000-aaaa-1111-1111-111111111111',
     'match_callup_reminder',
     'in_app',
     'match_callup_reminder:in_app:dummy:2026-05-30:user-a',
     '{"deep_link":"/convocatorias/x"}'::jsonb)
    returning id into v_id;

  if (select status from public.notifications where id = v_id) <> 'pending' then
    raise exception 'FAIL [N1]: status inicial debería ser pending';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N2: authenticated NO puede insertar
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd1000-aaaa-1111-1111-111111111111';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.notifications (user_id, type, channel, dedupe_key) values
      ('44dd1000-aaaa-1111-1111-111111111111',
       'match_callup_reminder',
       'in_app',
       'match_callup_reminder:in_app:dummy:2026-05-31:user-a');
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [N2]: authenticated no debería poder INSERT';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- N3: UNIQUE dedupe_key
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.notifications (user_id, type, channel, dedupe_key) values
      ('44dd1000-aaaa-2222-2222-222222222222',
       'match_callup_reminder',
       'in_app',
       'match_callup_reminder:in_app:dummy:2026-05-30:user-a');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [N3]: dedupe_key debería ser UNIQUE';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N4: RLS SELECT — otro user no ve las filas ajenas
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd1000-aaaa-2222-2222-222222222222';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.notifications
   where user_id = '44dd1000-aaaa-1111-1111-111111111111';
  if cnt <> 0 then
    raise exception 'FAIL [N4]: usuario B no debería ver filas de A (cnt=%)', cnt;
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- N5: UPDATE propio pending → sent, sent_at autoseteado
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44dd1000-aaaa-1111-1111-111111111111';

do $$
declare v_sent timestamptz;
begin
  update public.notifications
     set status = 'sent'
   where user_id = '44dd1000-aaaa-1111-1111-111111111111';

  select sent_at into v_sent from public.notifications
   where user_id = '44dd1000-aaaa-1111-1111-111111111111'
   limit 1;
  if v_sent is null then
    raise exception 'FAIL [N5]: sent_at debería autosetearse al pasar a sent';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- N6: UPDATE intentando cambiar payload → payload_immutable
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    update public.notifications
       set payload = '{"hacked":true}'::jsonb
     where user_id = '44dd1000-aaaa-1111-1111-111111111111';
  exception when others then
    if sqlerrm like '%payload_immutable%' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [N6]: payload debería ser inmutable en UPDATE';
  end if;
end $$;

reset role;

rollback;
