-- MN-3 — el ALTA de la cuenta propia del menor (migracion 20261068000000). Cubre:
--   [1]  reserved_for_tutor: una aceptacion `self` que traiga decisiones de imagen FALLA,
--        no las ignora en silencio. Y no deja NADA escrito.
--   [2]  reserved_for_tutor: lo mismo con la ficha medica.
--   [3]  Los T&C y la privacidad SIGUEN siendo obligatorios para el menor. Lo que se
--        salta es el bloque del JUGADOR, no el de la cuenta.
--   [4]  CASO FELIZ: el menor entra sin aportar decisiones de imagen. Se crea su
--        player_accounts 'self', su membership y sus DOS consents de cuenta — y ni uno
--        solo con player_id. Las decisiones de imagen del jugador siguen siendo las que
--        sello su TUTOR (decision 4 de Jose).
--   [5]  REGRESION de la rama del tutor: sin decisiones de imagen sigue saliendo
--        image_decision_required. El bloque no se ha desarmado para todos.
--   [6]  REGRESION: player_not_in_batch sigue vivo.
--   [7]  REGRESION: el tutor sella imagen, foto y medica exactamente como antes.
--   [8]  CANDADO de privilegios: el CREATE OR REPLACE no ensancha el ACL, y sin sesion
--        se sigue saliendo por no_session.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
--
-- ESTE TEST VIVE EN EL FUTURO, A PROPOSITO. MN-3 se aplica ANTES que MN-2 (68 < 69),
-- y hasta que MN-2 entre el CHECK `invitations_player_relation_check` sigue cerrado a
-- parent/guardian: no se puede ni crear la invitacion `self` que esta rama atiende.
-- Eso es justo lo que hace inocua a MN-3 hoy. Para poder MEDIRLA, el fixture monta
-- aqui el CHECK que abre MN-2 — literalmente su definicion — y lo deshace el rollback.
-- Cuando MN-2 este dentro, estas dos sentencias recrean el constraint identico.
alter table public.invitations
  drop constraint if exists invitations_player_relation_check;
alter table public.invitations
  add constraint invitations_player_relation_check
  check (
    player_relation is null
    or player_relation = any (array['parent'::text, 'guardian'::text, 'self'::text])
  );

insert into public.clubs (id, name, slug) values
  ('3e900000-0000-4000-8000-000000000001', 'Club MN3', 'club-mn3');

insert into public.seasons (id, club_id, label, status) values
  ('3e9c0000-0000-4000-8000-000000000001', '3e900000-0000-4000-8000-000000000001', '2026-27', 'active');

-- t1 tutor de j1 · m1 el MENOR de j1 (el que estrena cuenta) · t3 tutor entrante de j2
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000001', 't1@mn3.test', '{}'::jsonb);
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000002', 'm1@mn3.test', '{}'::jsonb);
select pg_temp.new_test_user('3e9a0000-0000-4000-8000-000000000003', 't3@mn3.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3e9a0000-0000-4000-8000-000000000001', '3e900000-0000-4000-8000-000000000001', 'jugador');

-- j1 el hijo de t1 (con sus decisiones de imagen YA selladas por el tutor, que es la
-- precondicion que impone MN-2 al invitar) · j2 el de la rama de control del tutor
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('3e9b0000-0000-4000-8000-000000000001', '3e900000-0000-4000-8000-000000000001',
   'Menor', 'Mn3', (current_date - interval '12 years')::date),
  ('3e9b0000-0000-4000-8000-000000000002', '3e900000-0000-4000-8000-000000000001',
   'Otro', 'Mn3', (current_date - interval '13 years')::date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('3e9b0000-0000-4000-8000-000000000001', '3e9a0000-0000-4000-8000-000000000001', 'parent');

insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3e9a0000-0000-4000-8000-000000000001', '3e9b0000-0000-4000-8000-000000000001',
       ld.doc_type::text::public.consent_type, true, ld.id, ld.version,
       '3e9c0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3e900000-0000-4000-8000-000000000001'
   and ld.doc_type in ('image_internal', 'image_social');

-- La invitacion `self` que cursaria el tutor (MN-2) y la 'parent' de control.
insert into public.invitations (id, token, email, club_id, role, player_id, player_relation, created_by) values
  ('3e9d0000-0000-4000-8000-000000000001', '3e9e0000-0000-4000-8000-000000000001',
   'm1@mn3.test', '3e900000-0000-4000-8000-000000000001', 'jugador',
   '3e9b0000-0000-4000-8000-000000000001', 'self', '3e9a0000-0000-4000-8000-000000000001'),
  ('3e9d0000-0000-4000-8000-000000000002', '3e9e0000-0000-4000-8000-000000000002',
   't3@mn3.test', '3e900000-0000-4000-8000-000000000001', 'jugador',
   '3e9b0000-0000-4000-8000-000000000002', 'parent', '3e9a0000-0000-4000-8000-000000000001');

set local role authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] El menor NO puede colar decisiones de imagen. Y falla RUIDOSAMENTE.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
begin
  perform public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000001'::uuid, true, true, null, null,
    '{"3e9b0000-0000-4000-8000-000000000001": {"internal": true, "social": true}}'::jsonb,
    '{}'::jsonb);
  raise exception 'FAIL [1]: una aceptacion self con decisiones de imagen debe fallar';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%reserved_for_tutor%' then
      raise exception 'FAIL [1]: esperaba reserved_for_tutor, dio: %', sqlerrm;
    end if;
end $$;

-- Las comprobaciones se miden SIN rol: RLS esconderia del propio menor los consents
-- del jugador, y un 0 por politica seria indistinguible de un 0 por comportamiento.
reset role;
do $$
declare v_n int;
begin
  select count(*) into v_n from public.player_accounts
   where player_id = '3e9b0000-0000-4000-8000-000000000001'
     and profile_id = '3e9a0000-0000-4000-8000-000000000002';
  if v_n <> 0 then
    raise exception 'FAIL [1]: el intento fallido NO debe dejar vinculo (hay %)', v_n;
  end if;
  select count(*) into v_n from public.consents
   where tutor_profile_id = '3e9a0000-0000-4000-8000-000000000002';
  if v_n <> 0 then
    raise exception 'FAIL [1]: el intento fallido NO debe dejar consents (hay %)', v_n;
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000002","role":"authenticated"}';


-- ─────────────────────────────────────────────────────────────────────────────
-- [2] Tampoco la ficha medica, que MN-1 dejo RESERVADA al tutor.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000001'::uuid, true, true, null, null, '{}'::jsonb,
    '{"3e9b0000-0000-4000-8000-000000000001": {"consent": true, "allergies": "polen"}}'::jsonb);
  raise exception 'FAIL [2]: una aceptacion self con ficha medica debe fallar';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%reserved_for_tutor%' then
      raise exception 'FAIL [2]: esperaba reserved_for_tutor, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] Lo que se salta es el bloque del JUGADOR, no el de la CUENTA: el menor sigue
--     teniendo que aceptar los terminos de su propia cuenta.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000001'::uuid, false, false, null, null, '{}'::jsonb, '{}'::jsonb);
  raise exception 'FAIL [3]: sin aceptar T&C no se entra, tambien siendo menor';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%consent_required%' then
      raise exception 'FAIL [3]: esperaba consent_required, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] CASO FELIZ — el menor entra SIN aportar nada del jugador.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000001'::uuid, true, true, '10.0.0.1', 'test', '{}'::jsonb, '{}'::jsonb)
    into v_n;
  if v_n <> 1 then
    raise exception 'FAIL [4]: la aceptacion self debe procesar 1 invitacion (dio %)', v_n;
  end if;
end $$;

reset role;

do $$
declare v_n int; v_rel text; v_role text; v_photo text;
begin
  select relation into v_rel from public.player_accounts
   where player_id = '3e9b0000-0000-4000-8000-000000000001'
     and profile_id = '3e9a0000-0000-4000-8000-000000000002';
  if v_rel is distinct from 'self' then
    raise exception 'FAIL [4]: el menor debe quedar vinculado como self (quedo %)', coalesce(v_rel, 'NADA');
  end if;

  select role::text into v_role from public.memberships
   where profile_id = '3e9a0000-0000-4000-8000-000000000002'
     and club_id = '3e900000-0000-4000-8000-000000000001';
  if v_role is distinct from 'jugador' then
    raise exception 'FAIL [4]: el menor debe entrar como jugador (quedo %)', coalesce(v_role, 'NADA');
  end if;

  select count(*) into v_n from public.invitations
   where id = '3e9d0000-0000-4000-8000-000000000001' and accepted_at is not null;
  if v_n <> 1 then
    raise exception 'FAIL [4]: la invitacion debe quedar aceptada';
  end if;

  -- Los DOS de cuenta, y solo esos.
  select count(*) into v_n from public.consents
   where tutor_profile_id = '3e9a0000-0000-4000-8000-000000000002' and player_id is null;
  if v_n <> 2 then
    raise exception 'FAIL [4]: el menor debe firmar T&C y privacidad de SU cuenta (hay %)', v_n;
  end if;

  -- LA DECISION 4 DE JOSE, medida: ni un solo consent del JUGADOR a nombre del menor.
  select count(*) into v_n from public.consents
   where tutor_profile_id = '3e9a0000-0000-4000-8000-000000000002' and player_id is not null;
  if v_n <> 0 then
    raise exception 'FAIL [4]: NINGUN consent del jugador puede ir a nombre del menor (hay %)', v_n;
  end if;

  -- Y las que habia siguen siendo del tutor, sin duplicar.
  select count(*) into v_n from public.consents
   where player_id = '3e9b0000-0000-4000-8000-000000000001'
     and consent_type in ('image_internal', 'image_social');
  if v_n <> 2 then
    raise exception 'FAIL [4]: las decisiones de imagen deben seguir siendo 2 (hay %)', v_n;
  end if;
  select count(*) into v_n from public.consents
   where player_id = '3e9b0000-0000-4000-8000-000000000001'
     and tutor_profile_id <> '3e9a0000-0000-4000-8000-000000000001';
  if v_n <> 0 then
    raise exception 'FAIL [4]: las decisiones de imagen deben seguir selladas por el TUTOR';
  end if;

  select photo_url into v_photo from public.players
   where id = '3e9b0000-0000-4000-8000-000000000001';
  if v_photo is not null then
    raise exception 'FAIL [4]: la rama self no escribe foto (quedo %)', v_photo;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] REGRESION — el bloque sigue EXIGIENDO las decisiones al TUTOR.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3e9a0000-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
begin
  perform public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000002'::uuid, true, true, null, null, '{}'::jsonb, '{}'::jsonb);
  raise exception 'FAIL [5]: al TUTOR se le siguen exigiendo las decisiones de imagen';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%image_decision_required%' then
      raise exception 'FAIL [5]: esperaba image_decision_required, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] REGRESION — player_not_in_batch sigue cazando datos de un jugador ajeno.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000002'::uuid, true, true, null, null,
    ('{"3e9b0000-0000-4000-8000-000000000002": {"internal": true, "social": true},'
     || '"3e9b0000-0000-4000-8000-000000000001": {"internal": true, "social": true}}')::jsonb,
    '{}'::jsonb);
  raise exception 'FAIL [6]: datos de un jugador fuera del lote deben rechazarse';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%player_not_in_batch%' then
      raise exception 'FAIL [6]: esperaba player_not_in_batch, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] REGRESION — el tutor sella imagen, foto y medica igual que antes de MN-3.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  select public.accept_pending_invitations(
    '3e9e0000-0000-4000-8000-000000000002'::uuid, true, true, null, null,
    ('{"3e9b0000-0000-4000-8000-000000000002": {"internal": true, "social": false,'
     || '"path": "3e9b0000-0000-4000-8000-000000000002/foto.jpg"}}')::jsonb,
    '{"3e9b0000-0000-4000-8000-000000000002": {"consent": true, "allergies": "polen"}}'::jsonb)
    into v_n;
  if v_n <> 1 then
    raise exception 'FAIL [7]: la aceptacion del tutor debe procesar 1 invitacion (dio %)', v_n;
  end if;
end $$;

reset role;

do $$
declare v_n int; v_photo text;
begin
  select count(*) into v_n from public.consents
   where player_id = '3e9b0000-0000-4000-8000-000000000002'
     and tutor_profile_id = '3e9a0000-0000-4000-8000-000000000003'
     and consent_type in ('image_internal', 'image_social');
  if v_n <> 2 then
    raise exception 'FAIL [7]: el tutor debe sellar las 2 decisiones de imagen (hay %)', v_n;
  end if;

  select count(*) into v_n from public.consents
   where player_id = '3e9b0000-0000-4000-8000-000000000002'
     and tutor_profile_id = '3e9a0000-0000-4000-8000-000000000003'
     and consent_type = 'medical_data_processing';
  if v_n <> 1 then
    raise exception 'FAIL [7]: el tutor debe sellar el consent medico (hay %)', v_n;
  end if;

  select count(*) into v_n from public.player_medical
   where player_id = '3e9b0000-0000-4000-8000-000000000002' and allergies = 'polen';
  if v_n <> 1 then
    raise exception 'FAIL [7]: la ficha medica del tutor debe guardarse (hay %)', v_n;
  end if;

  select photo_url into v_photo from public.players
   where id = '3e9b0000-0000-4000-8000-000000000002';
  if v_photo is distinct from '3e9b0000-0000-4000-8000-000000000002/foto.jpg' then
    raise exception 'FAIL [7]: la foto del tutor debe guardarse (quedo %)', coalesce(v_photo, 'NADA');
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] CANDADO — el CREATE OR REPLACE no ensancha el ACL y sin sesion no se entra.
--     `anon` tiene EXECUTE desde F14 y MN-3 no se lo quita: la puerta de esta RPC
--     es el `no_session` de su primera linea, no el privilegio. Este bloque fija
--     por escrito las dos cosas, para que cambiar cualquiera de ellas se note.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_acl text;
begin
  select p.proacl::text into v_acl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'accept_pending_invitations';
  if v_acl is null then
    raise exception 'FAIL [8]: accept_pending_invitations no deberia tener el ACL por defecto';
  end if;
  if position('=X/' in v_acl) = 0 then
    raise exception 'FAIL [8]: ACL inesperado: %', v_acl;
  end if;
  if not has_function_privilege('authenticated',
       'public.accept_pending_invitations(uuid,boolean,boolean,text,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'FAIL [8]: authenticated debe conservar EXECUTE';
  end if;
  if not has_function_privilege('service_role',
       'public.accept_pending_invitations(uuid,boolean,boolean,text,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'FAIL [8]: service_role debe conservar EXECUTE';
  end if;
end $$;

-- El rol es `authenticated` SIN claims, no `anon`, y el cambio tiene motivo.
--
-- Desde la migracion 20261075000000, `anon` ya no tiene EXECUTE sobre las funciones de
-- `public`: la llamada ni siquiera entra, muere en un 42501. Eso es MEJOR —hay dos
-- cerraduras en vez de una— pero deja este bloque sin poder medir lo que vino a medir,
-- que es la de DENTRO: que la funcion se niega cuando no hay sesion.
--
-- Y no vale afirmarlo provocando el 42501: en esta suite eso TUMBA el backend del CI
-- (leccion de BC-1), que es exactamente como se descubrio este acoplamiento.
--
-- `authenticated` con claims vacias deja `auth.uid()` en null igual que anon, asi que
-- el gate interno se mide intacto. La cerradura de fuera —que anon no llegue— la fija
-- el test anon_execute_cerrado.
set local role authenticated;
set local "request.jwt.claims" = '{}';
do $$
begin
  perform public.accept_pending_invitations('3e9e0000-0000-4000-8000-000000000001'::uuid);
  raise exception 'FAIL [8]: sin sesion no se acepta nada';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%no_session%' then
      raise exception 'FAIL [8]: esperaba no_session, dio: %', sqlerrm;
    end if;
end $$;
reset role;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ MN-3: alta self sin sellar lo del tutor, y las regresiones del tutor.'
\echo '──────────────────────────────────────────────'
