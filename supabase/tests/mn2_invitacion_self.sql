-- MN-2 — la invitacion del TUTOR a su hijo (migracion 20261069000000). Cubre:
--   [1]  El CHECK admite 'self' y sigue rechazando cualquier otra cosa.
--   [2]  El TUTOR invita: se crea la invitacion con role='jugador' y relation='self'.
--   [3]  LA PRECONDICION: sin las decisiones de imagen de la temporada activa, no se
--        invita. Es lo que evita que el menor acabe firmando lo que firma su tutor.
--   [4]  La precondicion es una DECISION, no un permiso: con granted=false tambien vale.
--   [5]  Quien NO puede invitar: el propio jugador (MN-1 saco 'self' del helper), el
--        staff del club, y un tutor de OTRO jugador.
--   [6]  Un jugador tiene UNA cuenta propia: con un 'self' ya vinculado, no se reinvita.
--   [7]  El correo de un TUTOR del jugador no puede recibir la invitacion de cuenta
--        propia — seria el tutor haciendose hijo de si mismo.
--   [8]  Reinvitable: la segunda invitacion al mismo (jugador, email) supersede la
--        pendiente en vez de acumular filas.
--   [9]  CANDADO de privilegios: la RPC cerrada a anon y a PUBLIC, como invite_spectator.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('3e800000-0000-4000-8000-000000000001', 'Club MN2', 'club-mn2');

insert into public.seasons (id, club_id, label, status) values
  ('3e8c0000-0000-4000-8000-000000000001', '3e800000-0000-4000-8000-000000000001', '2026-27', 'active');

-- t1 tutor de j1 · t2 tutor de j2 (otro jugador) · s1 staff · m1 el menor ya vinculado a j2
select pg_temp.new_test_user('3e8a0000-0000-4000-8000-000000000001', 't1@mn2.test', '{}'::jsonb);
select pg_temp.new_test_user('3e8a0000-0000-4000-8000-000000000002', 't2@mn2.test', '{}'::jsonb);
select pg_temp.new_test_user('3e8a0000-0000-4000-8000-000000000003', 's1@mn2.test', '{}'::jsonb);
select pg_temp.new_test_user('3e8a0000-0000-4000-8000-000000000004', 'm1@mn2.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3e8a0000-0000-4000-8000-000000000001', '3e800000-0000-4000-8000-000000000001', 'jugador'),
  ('3e8a0000-0000-4000-8000-000000000002', '3e800000-0000-4000-8000-000000000001', 'jugador'),
  ('3e8a0000-0000-4000-8000-000000000003', '3e800000-0000-4000-8000-000000000001', 'admin_club'),
  ('3e8a0000-0000-4000-8000-000000000004', '3e800000-0000-4000-8000-000000000001', 'jugador');

-- j1 el hijo de t1 (sin consentimientos todavia) · j2 el hijo de t2 (con self ya puesto)
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('3e8b0000-0000-4000-8000-000000000001', '3e800000-0000-4000-8000-000000000001',
   'Hijo', 'Mn2', (current_date - interval '12 years')::date),
  ('3e8b0000-0000-4000-8000-000000000002', '3e800000-0000-4000-8000-000000000001',
   'Otro', 'Mn2', (current_date - interval '13 years')::date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('3e8b0000-0000-4000-8000-000000000001', '3e8a0000-0000-4000-8000-000000000001', 'parent'),
  ('3e8b0000-0000-4000-8000-000000000002', '3e8a0000-0000-4000-8000-000000000002', 'parent'),
  ('3e8b0000-0000-4000-8000-000000000002', '3e8a0000-0000-4000-8000-000000000004', 'self');

-- j2 SI tiene sus decisiones de imagen: asi el bloque [6] solo puede fallar por el
-- candado de una sola cuenta propia, y no por la precondicion saltando antes.
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3e8a0000-0000-4000-8000-000000000002', '3e8b0000-0000-4000-8000-000000000002',
       ld.doc_type::text::public.consent_type, true, ld.id, ld.version,
       '3e8c0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3e800000-0000-4000-8000-000000000001'
   and ld.doc_type in ('image_internal', 'image_social');

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] El CHECK admite 'self' y nada mas
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('check@mn2.test', '3e800000-0000-4000-8000-000000000001', 'jugador',
          '3e8b0000-0000-4000-8000-000000000001', 'self');
exception when others then
  raise exception 'FAIL [1]: el CHECK debe admitir self: %', sqlerrm;
end $$;

do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('check2@mn2.test', '3e800000-0000-4000-8000-000000000001', 'jugador',
          '3e8b0000-0000-4000-8000-000000000001', 'primo');
  raise exception 'FAIL [1]: el CHECK NO debe admitir relaciones inventadas';
exception
  when check_violation then null;   -- correcto
  when sqlstate 'P0001' then raise;
end $$;

delete from public.invitations where email in ('check@mn2.test', 'check2@mn2.test');

set local role authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] LA PRECONDICION — va antes que el caso feliz porque j1 aun no tiene consentimientos
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e8a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000001', 'hijo@mn2.test');
  raise exception 'FAIL [3]: sin decisiones de imagen NO se puede invitar';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%consents_required%' then
      raise exception 'FAIL [3]: esperaba consents_required, dio: %', sqlerrm;
    end if;
end $$;

-- Solo una de las dos decisiones: sigue sin bastar.
reset role;
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3e8a0000-0000-4000-8000-000000000001', '3e8b0000-0000-4000-8000-000000000001',
       'image_internal', true, ld.id, ld.version, '3e8c0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3e800000-0000-4000-8000-000000000001'
   and ld.doc_type = 'image_internal' order by ld.version desc limit 1;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3e8a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000001', 'hijo@mn2.test');
  raise exception 'FAIL [3]: con UNA sola decision tampoco se puede invitar';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%consents_required%' then
      raise exception 'FAIL [3]: esperaba consents_required, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] La precondicion es una DECISION: granted=false tambien vale
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3e8a0000-0000-4000-8000-000000000001', '3e8b0000-0000-4000-8000-000000000001',
       'image_social', false, ld.id, ld.version, '3e8c0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3e800000-0000-4000-8000-000000000001'
   and ld.doc_type = 'image_social' order by ld.version desc limit 1;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3e8a0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] El caso feliz: el tutor invita
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid; v_n integer;
begin
  select i.id into v_id from public.invite_player_self(
    '3e8b0000-0000-4000-8000-000000000001', 'hijo@mn2.test') i;
  if v_id is null then
    raise exception 'FAIL [2]: la RPC debe devolver la invitacion creada';
  end if;

  select count(*) into v_n from public.invitations
   where id = v_id and role = 'jugador' and player_relation = 'self'
     and player_id = '3e8b0000-0000-4000-8000-000000000001'
     and created_by = auth.uid();
  if v_n <> 1 then
    raise exception 'FAIL [2]: la invitacion no tiene la forma esperada';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] Reinvitable: supersede la pendiente, no acumula
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n integer;
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000001', 'hijo@mn2.test');
  select count(*) into v_n from public.invitations
   where player_id = '3e8b0000-0000-4000-8000-000000000001'
     and player_relation = 'self' and accepted_at is null;
  if v_n <> 1 then
    raise exception 'FAIL [8]: la reinvitacion debe superseder, hay % filas pendientes', v_n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] El correo de un TUTOR del jugador no vale
--
-- Desde MN-4 el predicado no vive aqui: `invite_player_self` llama a
-- `player_email_relation_conflict`, que es tambien lo que aplica el trigger de
-- `invitations`, y el error pasa a llamarse `email_relation_conflict`.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000001', 't1@mn2.test');
  raise exception 'FAIL [7]: el tutor NO puede invitarse como hijo de si mismo';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%email_relation_conflict%' then
      raise exception 'FAIL [7]: esperaba email_relation_conflict, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Quien NO puede invitar
-- ─────────────────────────────────────────────────────────────────────────────

-- 5a · el propio jugador. MN-1 saco 'self' del helper, asi que un menor no se
--      invita a si mismo ni invita a nadie.
set local "request.jwt.claims" = '{"sub":"3e8a0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000002', 'x@mn2.test');
  raise exception 'FAIL [5a]: el propio jugador NO invita';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [5a]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- 5b · el staff del club. Esta invitacion es de la familia, no del club.
set local "request.jwt.claims" = '{"sub":"3e8a0000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000001', 'x@mn2.test');
  raise exception 'FAIL [5b]: el staff NO invita a la cuenta propia';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [5b]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- 5c · un tutor, pero de OTRO jugador.
set local "request.jwt.claims" = '{"sub":"3e8a0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000001', 'x@mn2.test');
  raise exception 'FAIL [5c]: un tutor ajeno NO invita';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [5c]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] UNA cuenta propia por jugador. t2 es tutor de j2, que ya tiene su 'self'.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.invite_player_self('3e8b0000-0000-4000-8000-000000000002', 'otro@mn2.test');
  raise exception 'FAIL [6]: con un self ya vinculado NO se reinvita';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%already_linked%' then
      raise exception 'FAIL [6]: esperaba already_linked, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] CANDADO de privilegios
-- ─────────────────────────────────────────────────────────────────────────────
reset role;

do $$
begin
  if has_function_privilege('anon', 'public.invite_player_self(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL [9]: anon NO puede ejecutar invite_player_self';
  end if;
  if not has_function_privilege('authenticated', 'public.invite_player_self(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL [9]: authenticated necesita EXECUTE';
  end if;
  if not has_function_privilege('service_role', 'public.invite_player_self(uuid, text)', 'EXECUTE') then
    raise exception 'FAIL [9]: service_role necesita EXECUTE';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ MN-2: invitacion self, precondicion y gates.'
\echo '──────────────────────────────────────────────'
