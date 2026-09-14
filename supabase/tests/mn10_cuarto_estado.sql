-- MN-10 — el cuarto estado: el boton no aparece si iba a fallar (migracion 20261073000000).
-- Cubre:
--   [1]  Sin decisiones de imagen en la temporada activa -> 'consents_required'.
--   [2]  En cuanto se responden, el mismo jugador pasa a 'none'.
--   [3]  Club sin temporada activa -> 'no_active_season'.
--   [4]  Jugador suprimido -> 'erased'.
--   [5]  PRECEDENCIA: 'linked' e 'invited' mandan SOBRE los motivos de bloqueo. A un
--        tutor cuyo hijo ya tiene cuenta no se le dice que falta abrir la temporada.
--   [6]  NO DIVERGE: para cada motivo que devuelve el estado, `invite_player_self`
--        levanta EXACTAMENTE ese mismo nombre. Es el bloque que hace que el predicado
--        compartido valga de algo: si alguien lo cambia en un sitio, esto se pone rojo.
--   [7]  El bloqueador es INTERNO: ni anon ni authenticated lo ejecutan. Lo que el
--        cliente llama es `player_self_account_status`, que si.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- Dos clubes: uno CON temporada activa y otro SIN ella, que es el unico modo de
-- medir 'no_active_season' sin tocar la temporada del primero a mitad de fichero.
insert into public.clubs (id, name, slug) values
  ('3ebd0000-0000-4000-8000-000000000001', 'Club MN10', 'club-mn10'),
  ('3ebd0000-0000-4000-8000-000000000002', 'Club MN10 sin temporada', 'club-mn10-b');

insert into public.seasons (id, club_id, label, status) values
  ('3ebe0000-0000-4000-8000-000000000001', '3ebd0000-0000-4000-8000-000000000001', '2026-27', 'active');

select pg_temp.new_test_user('3ebf0000-0000-4000-8000-000000000001', 't@mn10.test', '{}'::jsonb);
select pg_temp.new_test_user('3ebf0000-0000-4000-8000-000000000002', 'm@mn10.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3ebf0000-0000-4000-8000-000000000001', '3ebd0000-0000-4000-8000-000000000001', 'jugador'),
  ('3ebf0000-0000-4000-8000-000000000001', '3ebd0000-0000-4000-8000-000000000002', 'jugador'),
  ('3ebf0000-0000-4000-8000-000000000002', '3ebd0000-0000-4000-8000-000000000001', 'jugador');

-- j1 sin consentimientos · j2 en el club sin temporada · j3 suprimido · j4 ya enlazado
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('3ec00000-0000-4000-8000-000000000001', '3ebd0000-0000-4000-8000-000000000001', 'Uno',    'Mn10', (current_date - interval '12 years')::date),
  ('3ec00000-0000-4000-8000-000000000002', '3ebd0000-0000-4000-8000-000000000002', 'Dos',    'Mn10', (current_date - interval '12 years')::date),
  ('3ec00000-0000-4000-8000-000000000003', '3ebd0000-0000-4000-8000-000000000001', 'Tres',   'Mn10', (current_date - interval '12 years')::date),
  ('3ec00000-0000-4000-8000-000000000004', '3ebd0000-0000-4000-8000-000000000001', 'Cuatro', 'Mn10', (current_date - interval '12 years')::date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('3ec00000-0000-4000-8000-000000000001', '3ebf0000-0000-4000-8000-000000000001', 'parent'),
  ('3ec00000-0000-4000-8000-000000000002', '3ebf0000-0000-4000-8000-000000000001', 'parent'),
  ('3ec00000-0000-4000-8000-000000000003', '3ebf0000-0000-4000-8000-000000000001', 'parent'),
  ('3ec00000-0000-4000-8000-000000000004', '3ebf0000-0000-4000-8000-000000000001', 'parent'),
  ('3ec00000-0000-4000-8000-000000000004', '3ebf0000-0000-4000-8000-000000000002', 'self');

update public.players set erased_at = now()
 where id = '3ec00000-0000-4000-8000-000000000003';

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3ebf0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] Sin decisiones de imagen -> 'consents_required'
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.player_self_account_status('3ec00000-0000-4000-8000-000000000001');
  if v is distinct from 'consents_required' then
    raise exception 'FAIL [1]: esperaba consents_required, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6a] …y la RPC se niega con ESE MISMO nombre
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.invite_player_self('3ec00000-0000-4000-8000-000000000001', 'hijo@mn10.test');
  raise exception 'FAIL [6a]: la RPC tenia que negarse por consents_required';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%consents_required%' then
      raise exception 'FAIL [6a]: esperaba consents_required, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] Respondidas las dos -> 'none'
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3ebf0000-0000-4000-8000-000000000001', '3ec00000-0000-4000-8000-000000000001',
       ld.doc_type::text::public.consent_type, true, ld.id, ld.version,
       '3ebe0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3ebd0000-0000-4000-8000-000000000001'
   and ld.doc_type in ('image_internal', 'image_social');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3ebf0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v text;
begin
  v := public.player_self_account_status('3ec00000-0000-4000-8000-000000000001');
  if v is distinct from 'none' then
    raise exception 'FAIL [2]: con las dos decisiones tomadas esperaba none, dio: %', v;
  end if;
end $$;

-- Una decision `granted = false` TAMBIEN vale: es una decision, no un permiso. Se
-- mide con el otro jugador del mismo club para no deshacer lo de arriba.
reset role;
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3ebf0000-0000-4000-8000-000000000001', '3ec00000-0000-4000-8000-000000000004',
       ld.doc_type::text::public.consent_type, false, ld.id, ld.version,
       '3ebe0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3ebd0000-0000-4000-8000-000000000001'
   and ld.doc_type in ('image_internal', 'image_social');
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3ebf0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] Club sin temporada activa -> 'no_active_season'
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.player_self_account_status('3ec00000-0000-4000-8000-000000000002');
  if v is distinct from 'no_active_season' then
    raise exception 'FAIL [3]: esperaba no_active_season, dio: %', v;
  end if;
end $$;

do $$
begin
  perform public.invite_player_self('3ec00000-0000-4000-8000-000000000002', 'hijo2@mn10.test');
  raise exception 'FAIL [6b]: la RPC tenia que negarse por no_active_season';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%no_active_season%' then
      raise exception 'FAIL [6b]: esperaba no_active_season, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Jugador suprimido -> 'erased'
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.player_self_account_status('3ec00000-0000-4000-8000-000000000003');
  if v is distinct from 'erased' then
    raise exception 'FAIL [4]: esperaba erased, dio: %', v;
  end if;
end $$;

do $$
begin
  perform public.invite_player_self('3ec00000-0000-4000-8000-000000000003', 'hijo3@mn10.test');
  raise exception 'FAIL [6c]: la RPC tenia que negarse por erased';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%erased%' then
      raise exception 'FAIL [6c]: esperaba erased, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] PRECEDENCIA: 'linked' manda sobre los motivos de bloqueo
--     j4 tiene cuenta propia Y sus decisiones estan en 'false' (que valen), asi que
--     para medir la precedencia de verdad le quitamos la temporada al club entero.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
update public.seasons set status = 'finalized'
 where id = '3ebe0000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3ebf0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v text;
begin
  v := public.player_self_account_status('3ec00000-0000-4000-8000-000000000004');
  if v is distinct from 'linked' then
    raise exception 'FAIL [5]: la cuenta ya creada manda sobre el bloqueo, dio: %', v;
  end if;
end $$;

-- Y el que no tiene cuenta, en ese mismo club sin temporada, si reporta el bloqueo:
-- asi se comprueba que [5] no salio 'linked' por casualidad.
do $$
declare v text;
begin
  v := public.player_self_account_status('3ec00000-0000-4000-8000-000000000001');
  if v is distinct from 'no_active_season' then
    raise exception 'FAIL [5]: el control esperaba no_active_season, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] CANDADO ACL — el bloqueador es interno; el estado, no
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.player_self_invite_blocker(uuid)', 'execute') then
    raise exception 'FAIL [7]: anon NO puede ejecutar el bloqueador';
  end if;
  if has_function_privilege('authenticated', 'public.player_self_invite_blocker(uuid)', 'execute') then
    raise exception 'FAIL [7]: authenticated tampoco: es interno, se llega por el estado';
  end if;
  if not has_function_privilege('authenticated', 'public.player_self_account_status(uuid)', 'execute') then
    raise exception 'FAIL [7]: authenticated si ejecuta el estado';
  end if;
end $$;

rollback;
