-- F5B-5 — Tests de no-leídos por grupo (team_conversation_reads + RPC).
--
-- Cobertura:
--   R1. RLS: un usuario solo VE y ESCRIBE sus propias filas de lectura; no puede
--       insertar una fila con profile_id ajeno.
--   R2. Contador sin leer: incluye solo los chats donde el user participa; cuenta
--       mensajes no propios; NO incluye grupos ajenos.
--   R3. Contador tras marcar leído: solo cuenta los posteriores a last_read_at.
--   R4. Director observer NO acumula no-leídos de chats que solo vigila; director
--       active SÍ.
--
-- Timestamps EXPLÍCITOS: dentro de una transacción now() es constante, así que se
-- fijan created_at/last_read_at a horas concretas para un orden determinista.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('a1110000-1111-4111-8111-000000000001', 'Club R', 'club-r-reads');

insert into public.categories (id, club_id, name) values
  ('b1110000-1111-4111-8111-000000000001', 'a1110000-1111-4111-8111-000000000001', 'Cat R');

insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('ca110000-1111-4111-8111-00000000000a', 'b1110000-1111-4111-8111-000000000001', 'Team RA', 'F7', '#10B981', '2025-26', 'a1110000-1111-4111-8111-000000000001'),
  ('cb110000-1111-4111-8111-00000000000b', 'b1110000-1111-4111-8111-000000000001', 'Team RB', 'F7', '#10B981', '2025-26', 'a1110000-1111-4111-8111-000000000001');

-- D director; SA staff de A; SB staff de B; PL familia de A.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('dd110000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dir-r@reads.test', now(), '{}'::jsonb, now(), now()),
  ('dd110000-0000-4000-8000-00000000005a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sa-r@reads.test',  now(), '{}'::jsonb, now(), now()),
  ('dd110000-0000-4000-8000-00000000005b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sb-r@reads.test',  now(), '{}'::jsonb, now(), now()),
  ('dd110000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pl-r@reads.test',  now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55110000-0000-4000-8000-0000000000d1', 'dd110000-0000-4000-8000-0000000000d1', 'a1110000-1111-4111-8111-000000000001', 'director'),
  ('55110000-0000-4000-8000-00000000005a', 'dd110000-0000-4000-8000-00000000005a', 'a1110000-1111-4111-8111-000000000001', 'entrenador_principal'),
  ('55110000-0000-4000-8000-00000000005b', 'dd110000-0000-4000-8000-00000000005b', 'a1110000-1111-4111-8111-000000000001', 'entrenador_principal'),
  ('55110000-0000-4000-8000-0000000000f1', 'dd110000-0000-4000-8000-0000000000f1', 'a1110000-1111-4111-8111-000000000001', 'jugador');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('ca110000-1111-4111-8111-00000000000a', '55110000-0000-4000-8000-00000000005a', 'entrenador_principal'),
  ('cb110000-1111-4111-8111-00000000000b', '55110000-0000-4000-8000-00000000005b', 'entrenador_principal');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('ee110000-0000-4000-8000-0000000000a1', 'a1110000-1111-4111-8111-000000000001', 'Roi', 'Test', '2013-05-10');

insert into public.team_members (player_id, team_id) values
  ('ee110000-0000-4000-8000-0000000000a1', 'ca110000-1111-4111-8111-00000000000a');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('ee110000-0000-4000-8000-0000000000a1', 'dd110000-0000-4000-8000-0000000000f1', 'parent');

insert into public.team_conversations (id, club_id, team_id) values
  ('99110000-0000-4000-8000-0000000000aa', 'a1110000-1111-4111-8111-000000000001', 'ca110000-1111-4111-8111-00000000000a'),
  ('99110000-0000-4000-8000-0000000000bb', 'a1110000-1111-4111-8111-000000000001', 'cb110000-1111-4111-8111-00000000000b');

-- D ACTIVE en A (observer en B por ausencia de fila).
insert into public.team_chat_participation (profile_id, team_id, mode) values
  ('dd110000-0000-4000-8000-0000000000d1', 'ca110000-1111-4111-8111-00000000000a', 'active');

-- Mensajes en A por SA (m1 10:00, m2 10:01, m3 11:00) + uno propio de PL (12:00);
-- y uno en B por SB (10:00). Timestamps explícitos.
do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-00000000005a","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body, created_at) values
    ('99110000-0000-4000-8000-0000000000aa', 'dd110000-0000-4000-8000-00000000005a', 'A m1', '2026-01-01T10:00:00Z'),
    ('99110000-0000-4000-8000-0000000000aa', 'dd110000-0000-4000-8000-00000000005a', 'A m2', '2026-01-01T10:01:00Z'),
    ('99110000-0000-4000-8000-0000000000aa', 'dd110000-0000-4000-8000-00000000005a', 'A m3', '2026-01-01T11:00:00Z');
  reset role;

  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000f1","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body, created_at) values
    ('99110000-0000-4000-8000-0000000000aa', 'dd110000-0000-4000-8000-0000000000f1', 'A propio PL', '2026-01-01T12:00:00Z');
  reset role;

  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-00000000005b","role":"authenticated"}';
  insert into public.team_messages (team_conversation_id, sender_profile_id, body, created_at) values
    ('99110000-0000-4000-8000-0000000000bb', 'dd110000-0000-4000-8000-00000000005b', 'B b1', '2026-01-01T10:00:00Z');
  reset role;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R1: RLS de team_conversation_reads — solo filas propias
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false; v_count int;
begin
  -- SA inserta su propia marca en A → OK.
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-00000000005a","role":"authenticated"}';
  insert into public.team_conversation_reads (profile_id, team_conversation_id, last_read_at) values
    ('dd110000-0000-4000-8000-00000000005a', '99110000-0000-4000-8000-0000000000aa', '2026-01-01T10:30:00Z');

  -- SA intenta insertar una marca con profile_id ajeno (PL) → ❌.
  begin
    insert into public.team_conversation_reads (profile_id, team_conversation_id, last_read_at) values
      ('dd110000-0000-4000-8000-0000000000f1', '99110000-0000-4000-8000-0000000000aa', '2026-01-01T10:30:00Z');
  exception when insufficient_privilege then
    ok := true;
  end;
  reset role;
  if not ok then
    raise exception 'FAIL [R1a]: SA pudo escribir una marca de lectura ajena';
  end if;

  -- PL siembra su propia marca (para R1b/R3).
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000f1","role":"authenticated"}';
  insert into public.team_conversation_reads (profile_id, team_conversation_id, last_read_at) values
    ('dd110000-0000-4000-8000-0000000000f1', '99110000-0000-4000-8000-0000000000aa', '2026-01-01T10:30:00Z');
  reset role;

  -- SA SELECT: no ve la fila de PL (solo la suya).
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-00000000005a","role":"authenticated"}';
  select count(*) into v_count from public.team_conversation_reads
   where profile_id = 'dd110000-0000-4000-8000-0000000000f1';
  reset role;
  if v_count <> 0 then
    raise exception 'FAIL [R1b]: SA ve marcas de lectura ajenas (count=%)', v_count;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R2/R3: contador para PL (miembro de A). Antes de la marca (implícito: la marca
--        de PL es 10:30) → cuenta solo m3 (11:00). Grupo B ajeno → ausente.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_a int; v_b_present boolean;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000f1","role":"authenticated"}';

  select unread into v_a from public.team_chat_unread_counts()
   where team_conversation_id = '99110000-0000-4000-8000-0000000000aa';
  select exists(select 1 from public.team_chat_unread_counts()
   where team_conversation_id = '99110000-0000-4000-8000-0000000000bb') into v_b_present;
  reset role;

  -- Tras leer a las 10:30: solo m3 (11:00) es no-leído; el propio de PL (12:00)
  -- no cuenta. Esperado = 1.
  if coalesce(v_a, 0) <> 1 then
    raise exception 'FAIL [R3]: no-leídos de PL en A tras marca = % (esperado 1)', coalesce(v_a, 0);
  end if;
  -- PL no es miembro de B → B no aparece.
  if v_b_present then
    raise exception 'FAIL [R2]: PL ve no-leídos de un grupo ajeno (B)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R2-bis: contador SIN marca — SA (staff de A) no tiene marca en... sí la tiene
--        (la puso en R1 a 10:30). Comprobamos el caso "sin marca" con D.
-- R4: director active en A cuenta; observer en B NO aparece.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_a int; v_b_present boolean;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"dd110000-0000-4000-8000-0000000000d1","role":"authenticated"}';

  select unread into v_a from public.team_chat_unread_counts()
   where team_conversation_id = '99110000-0000-4000-8000-0000000000aa';
  select exists(select 1 from public.team_chat_unread_counts()
   where team_conversation_id = '99110000-0000-4000-8000-0000000000bb') into v_b_present;
  reset role;

  -- D sin marca en A: todos los no-propios cuentan (m1,m2,m3,PL) = 4.
  if coalesce(v_a, 0) <> 4 then
    raise exception 'FAIL [R4a]: no-leídos del director active en A = % (esperado 4)', coalesce(v_a, 0);
  end if;
  -- D solo observa B (sin fila active) → B NO aparece, aunque tenga mensajes.
  if v_b_present then
    raise exception 'FAIL [R4b]: director observer acumula no-leídos de un chat que solo vigila (B)';
  end if;
end $$;

rollback;

select 'OK rls_team_chat_reads' as result;
