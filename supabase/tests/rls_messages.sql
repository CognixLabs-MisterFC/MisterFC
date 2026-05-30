-- F5 Lote A — Tests RLS de `messages`.
--
-- Cobertura:
--   M1. Participant SELECT mensajes del hilo → OK.
--   M2. No-participant SELECT → 0 rows.
--   M3. INSERT con sender = auth.uid() → OK.
--   M4. INSERT con sender ≠ auth.uid() (spoof) → trigger rechaza.
--   M5. UPDATE read_at por receptor → OK. Re-abrir read_at (NOT NULL → NULL)
--       → trigger rechaza.
--   M6. audit_get_conversation: admin con razón válida → ve mensajes +
--       deja entry en audit_log. Sin razón / < 5 chars → rechaza.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup (similar a rls_conversations pero con conversation + mensajes ya
-- pre-existentes para los tests de SELECT/UPDATE).
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('11111111-1111-4111-8111-1111111100a1', 'Club M', 'club-m-msg');

insert into public.categories (id, club_id, name, season) values
  ('22222222-2222-4222-8222-2222222200a1', '11111111-1111-4111-8111-1111111100a1', 'Cat M', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('33333333-3333-4333-8333-3333333300a1', '22222222-2222-4222-8222-2222222200a1', 'Team M', 'F7', '#10B981');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44444444-4444-4444-8444-4444444400a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'adm-m@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400a2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cch-m@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400a3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tut-m@msg.test', now(), '{}'::jsonb, now(), now()),
  ('44444444-4444-4444-8444-4444444400a4', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'oth-m@msg.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55555555-5555-4555-8555-5555555500a1', '44444444-4444-4444-8444-4444444400a1', '11111111-1111-4111-8111-1111111100a1', 'admin_club'),
  ('55555555-5555-4555-8555-5555555500a2', '44444444-4444-4444-8444-4444444400a2', '11111111-1111-4111-8111-1111111100a1', 'entrenador_principal'),
  ('55555555-5555-4555-8555-5555555500a3', '44444444-4444-4444-8444-4444444400a3', '11111111-1111-4111-8111-1111111100a1', 'jugador'),
  ('55555555-5555-4555-8555-5555555500a4', '44444444-4444-4444-8444-4444444400a4', '11111111-1111-4111-8111-1111111100a1', 'entrenador_principal');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66666666-6666-4666-8666-6666666600a1', '11111111-1111-4111-8111-1111111100a1', 'Mario', 'Test', '2012-03-20');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('66666666-6666-4666-8666-6666666600a1', '44444444-4444-4444-8444-4444444400a3', 'parent');

insert into public.conversations (id, club_id, player_id, coach_profile_id) values
  ('88888888-8888-4888-8888-8888888800a1', '11111111-1111-4111-8111-1111111100a1',
   '66666666-6666-4666-8666-6666666600a1', '44444444-4444-4444-8444-4444444400a2');

-- Pre-creamos 1 mensaje del coach (auth.uid bypass: usamos service_role
-- mientras estamos como postgres normal aquí; los triggers messages_*
-- corren igual pero auth.uid() es NULL, así que el trigger force_sender
-- saltará. Para sembrar, suplantamos JWT con sub = coach).
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a2","role":"authenticated"}';
  insert into public.messages (conversation_id, sender_profile_id, body) values
    ('88888888-8888-4888-8888-8888888800a1', '44444444-4444-4444-8444-4444444400a2', 'Hola, ¿qué tal?');
  reset role;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M1: tutor (participant) SELECT → 1 row
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a3","role":"authenticated"}';
  select count(*) into v_count from public.messages
   where conversation_id = '88888888-8888-4888-8888-8888888800a1';
  reset role;
  if v_count <> 1 then
    raise exception 'FAIL [M1]: tutor no ve mensajes del hilo (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2: no-participant (otro principal del club) SELECT → 0 rows
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_count int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a4","role":"authenticated"}';
  select count(*) into v_count from public.messages
   where conversation_id = '88888888-8888-4888-8888-8888888800a1';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL [M2]: no-participant ve mensajes (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M3: INSERT con sender = auth.uid() (tutor responde) → OK
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_msg_id uuid;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a3","role":"authenticated"}';
  insert into public.messages (conversation_id, sender_profile_id, body) values
    ('88888888-8888-4888-8888-8888888800a1', '44444444-4444-4444-8444-4444444400a3', 'Todo bien, gracias.')
  returning id into v_msg_id;
  reset role;
  if v_msg_id is null then
    raise exception 'FAIL [M3]: tutor no pudo insertar mensaje propio';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M4: INSERT con sender ≠ auth.uid() (tutor intenta spoofear al coach) → ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a3","role":"authenticated"}';
  begin
    insert into public.messages (conversation_id, sender_profile_id, body) values
      ('88888888-8888-4888-8888-8888888800a1', '44444444-4444-4444-8444-4444444400a2', 'soy el coach (spoof)');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [M4]: spoof de sender_profile_id no fue bloqueado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M5: UPDATE read_at por receptor → OK; reabrir read_at → ❌
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  -- Tutor cierra read_at del mensaje del coach.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a3","role":"authenticated"}';
  update public.messages set read_at = now()
   where conversation_id = '88888888-8888-4888-8888-8888888800a1'
     and sender_profile_id = '44444444-4444-4444-8444-4444444400a2';

  -- Intentar reabrir (NOT NULL → NULL).
  begin
    update public.messages set read_at = null
     where conversation_id = '88888888-8888-4888-8888-8888888800a1'
       and sender_profile_id = '44444444-4444-4444-8444-4444444400a2';
  exception when check_violation then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [M5]: re-abrir read_at no fue bloqueado por trigger';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M6: audit_get_conversation
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_rows int; v_audits int; ok boolean;
begin
  -- Admin con razón válida → recibe filas y deja entry en audit_log.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a1","role":"authenticated"}';
  select count(*) into v_rows
    from public.audit_get_conversation(
      '88888888-8888-4888-8888-8888888800a1',
      'queja formal de la familia');
  if v_rows = 0 then
    raise exception 'FAIL [M6a]: audit_get_conversation no devolvió mensajes para admin con razón válida';
  end if;
  select count(*) into v_audits from public.audit_log
   where target_id = '88888888-8888-4888-8888-8888888800a1';
  if v_audits <> 1 then
    raise exception 'FAIL [M6a]: audit_log no registró el acceso (audits=%)', v_audits;
  end if;

  -- Razón demasiado corta → check_violation
  ok := false;
  begin
    perform public.audit_get_conversation(
      '88888888-8888-4888-8888-8888888800a1',
      'no');
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [M6b]: razón < 5 chars no fue rechazada';
  end if;

  reset role;

  -- Jugador NO puede invocar (insufficient_privilege)
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"44444444-4444-4444-8444-4444444400a3","role":"authenticated"}';
  ok := false;
  begin
    perform public.audit_get_conversation(
      '88888888-8888-4888-8888-8888888800a1',
      'curiosidad de un padre');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [M6c]: jugador pudo invocar audit_get_conversation';
  end if;
end $$;

rollback;

select 'OK rls_messages' as result;
