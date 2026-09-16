-- Retirar un consentimiento (mig 20261077000000).
-- Cubre:
--   [1] La retirada inserta UNA fila granted=false, apuntando AL MISMO documento.
--   [2] EL FALLO SILENCIOSO: la fila se sella con la temporada ACTIVA. El que tiene
--       dientes aqui es user_has_medical_consent_WRITE, que SI filtra por temporada
--       (el _read es latest-wins global y baja igual). Sellar con otra temporada deja
--       la retirada a medias: el dato se esconde y el club PUEDE SEGUIR
--       ESCRIBIENDOLO. Medido contra produccion por inyeccion.
--   [3] image_internal apaga player_photo_visible, que es quien gatea la RLS de
--       storage. La foto deja de poder leerse.
--   [4] El ledger NO se toca: la fila concedida sigue ahí, y el append-only aguanta.
--   [5] Idempotente: retirar dos veces deja UNA sola fila de retirada.
--   [6] Se puede retirar lo concedido en una temporada ANTERIOR, y la retirada se
--       sella en la ACTIVA (la lectura es sin temporada; la escritura, con ella).
--   [7] Lo que NO se retira: terms_conditions y privacy_policy → not_revocable.
--   [8] La puerta: sin sesion, y un EX-tutor que conserva su fila en el ledger
--       pero ya no maneja al jugador (el unico caso que aisla el gate).
--   [9] Sin fila previa → nothing_to_revoke (no se inventa una retirada).
--  [10] CANDADO de privilegios: cerrada a anon y a PUBLIC.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (lección de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('ba000000-0000-4000-8000-000000000001', 'Club RV', 'club-rv');

-- DOS temporadas: la activa y una cerrada. [6] necesita las dos.
insert into public.seasons (id, club_id, label, status) values
  ('ba0c0000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', '2026-27', 'active'),
  ('ba0c0000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001', '2025-26', 'finalized');

insert into public.categories (id, club_id, name) values
  ('ba0d0000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'Cadete');

insert into public.teams (id, club_id, category_id, name, format, season) values
  ('ba0e0000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001',
   'ba0d0000-0000-4000-8000-000000000001', 'Cadete A', 'F11', '2026-27');

--  tutor    = el padre del jugador
--  ajeno    = tutor de OTRO jugador
--  extutor  = YA NO es tutor del jugador 1 (se le quito el vinculo), pero SUS FILAS
--             del ledger siguen ahi, porque el ledger no se borra nunca. Es el unico
--             caso que aisla el GATE: sin el, la busqueda del estado vigente
--             encontraria fila y la retirada saldria adelante.
select pg_temp.new_test_user('ba0a0000-0000-4000-8000-000000000001', 'tutor@rv.test', '{"full_name": "Tutor"}'::jsonb);
select pg_temp.new_test_user('ba0a0000-0000-4000-8000-000000000002', 'ajeno@rv.test', '{"full_name": "Ajeno"}'::jsonb);
select pg_temp.new_test_user('ba0a0000-0000-4000-8000-000000000003', 'extutor@rv.test', '{"full_name": "ExTutor"}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('ba0f0000-0000-4000-8000-000000000001', 'ba0a0000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'jugador', null),
  ('ba0f0000-0000-4000-8000-000000000002', 'ba0a0000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001', 'jugador', null),
  ('ba0f0000-0000-4000-8000-000000000003', 'ba0a0000-0000-4000-8000-000000000003', 'ba000000-0000-4000-8000-000000000001', 'jugador', null);

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('ba0b0000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-000000000001', 'Hijo', 'Rv', (current_date - interval '12 years')::date),
  ('ba0b0000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-000000000001', 'Otro', 'Rv', (current_date - interval '12 years')::date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('ba0b0000-0000-4000-8000-000000000001', 'ba0a0000-0000-4000-8000-000000000001', 'parent'),
  ('ba0b0000-0000-4000-8000-000000000002', 'ba0a0000-0000-4000-8000-000000000002', 'parent');

insert into public.team_members (player_id, team_id) values
  ('ba0b0000-0000-4000-8000-000000000001', 'ba0e0000-0000-4000-8000-000000000001');

-- Los textos que se consintieron. NO se insertan: el trigger `clubs_seed_legal_documents`
-- ya siembra los CINCO doc_type en la version 1 al crear el club, y hay un unique
-- (club_id, doc_type, version). Se usan los sembrados, que ademas es lo que pasa de
-- verdad en produccion.
create or replace function pg_temp.doc(p_type public.legal_document_type) returns uuid
language sql stable as $$
  select id from public.legal_documents
   where club_id = 'ba000000-0000-4000-8000-000000000001' and doc_type = p_type and version = 1
$$;

-- Concesiones VIGENTES del tutor sobre su hijo, en la temporada ACTIVA.
insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('ba0a0000-0000-4000-8000-000000000001', 'ba0b0000-0000-4000-8000-000000000001', 'medical_data_processing', true,
   pg_temp.doc('medical_informed_consent'), 1, 'ba0c0000-0000-4000-8000-000000000001'),
  ('ba0a0000-0000-4000-8000-000000000001', 'ba0b0000-0000-4000-8000-000000000001', 'image_internal', true,
   pg_temp.doc('image_internal'), 1, 'ba0c0000-0000-4000-8000-000000000001'),
  ('ba0a0000-0000-4000-8000-000000000001', 'ba0b0000-0000-4000-8000-000000000001', 'privacy_policy', true,
   pg_temp.doc('privacy_policy'), 1, 'ba0c0000-0000-4000-8000-000000000001');

-- El ex-tutor conserva su fila sobre el jugador 1. NO esta en player_accounts: por eso
-- `user_manages_player_sensitive` le dice que no, aunque el ledger le recuerde.
insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('ba0a0000-0000-4000-8000-000000000003', 'ba0b0000-0000-4000-8000-000000000001', 'image_internal', true,
   pg_temp.doc('image_internal'), 1, 'ba0c0000-0000-4000-8000-000000000001');

-- [6] — concedido en la temporada FINALIZADA y nunca renovado.
insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('ba0a0000-0000-4000-8000-000000000001', 'ba0b0000-0000-4000-8000-000000000001', 'image_social', true,
   pg_temp.doc('image_social'), 1, 'ba0c0000-0000-4000-8000-000000000002');

create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- ── [1] La retirada: una fila, al mismo documento ────────────────────────────
do $$
declare v_n int; v_doc uuid; v_ver int; v_granted boolean;
begin
  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent(
    'ba0b0000-0000-4000-8000-000000000001', 'medical_data_processing', '10.0.0.1', 'pgTAP');
  reset role;

  select count(*) into v_n from public.consents
   where player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and consent_type = 'medical_data_processing';
  if v_n <> 2 then raise exception '[1] esperaba 2 filas (concesion + retirada), hay %', v_n; end if;

  select c.granted, c.legal_document_id, c.legal_document_version
    into v_granted, v_doc, v_ver
  from public.consents c
   where c.player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'medical_data_processing'
   order by c.accepted_at desc, c.seq desc limit 1;

  if v_granted is not false then raise exception '[1] la fila vigente no es una retirada'; end if;
  if v_doc is distinct from pg_temp.doc('medical_informed_consent') then
    raise exception '[1] la retirada apunta a otro documento: %', v_doc;
  end if;
  if v_ver <> 1 then raise exception '[1] version equivocada: %', v_ver; end if;
end $$;

-- ── [2] EL FALLO SILENCIOSO: la temporada del sellado ───────────────────────
-- Las dos funciones se comprueban, pero NO valen lo mismo:
--   · _read  es latest-wins GLOBAL: baja a false se selle donde se selle. No prueba
--     nada sobre la temporada, y por eso no puede ser la unica asercion.
--   · _write filtra por `season_id = active_season_id(club)`: si la retirada se
--     sella en otra temporada se queda en TRUE. Medido en produccion con la funcion
--     inyectada: read=false, write=true. Es decir, el dato se esconde y el club
--     todavia puede escribir la ficha medica de un menor cuya familia acaba de
--     retirar el consentimiento. Sin error, sin aviso.
do $$
declare v_season uuid; v_read boolean; v_write boolean;
begin
  select c.season_id into v_season from public.consents c
   where c.player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'medical_data_processing'
   order by c.accepted_at desc, c.seq desc limit 1;
  if v_season is distinct from 'ba0c0000-0000-4000-8000-000000000001' then
    raise exception '[2] la retirada NO se sello en la temporada activa: %', v_season;
  end if;

  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000001');
  select public.user_has_medical_consent_read('ba0b0000-0000-4000-8000-000000000001') into v_read;
  select public.user_has_medical_consent_write('ba0b0000-0000-4000-8000-000000000001') into v_write;
  reset role;
  if v_read is not false then raise exception '[2] user_has_medical_consent_read sigue en true'; end if;
  -- ESTA es la que caza el sellado en la temporada equivocada.
  if v_write is not false then raise exception '[2] user_has_medical_consent_WRITE sigue en true: la retirada se sello fuera de la temporada activa'; end if;
end $$;

-- ── [3] image_internal apaga la visibilidad de la foto ───────────────────────
do $$
declare v_antes boolean; v_despues boolean;
begin
  select public.player_photo_visible('ba0b0000-0000-4000-8000-000000000001') into v_antes;
  if v_antes is not true then raise exception '[3] la foto no se veia ANTES de retirar'; end if;

  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000001', 'image_internal');
  reset role;

  select public.player_photo_visible('ba0b0000-0000-4000-8000-000000000001') into v_despues;
  if v_despues is not false then raise exception '[3] la foto SIGUE visible tras retirar image_internal'; end if;
end $$;

-- ── [4] El ledger no se toca ────────────────────────────────────────────────
do $$
declare v_conc int;
begin
  select count(*) into v_conc from public.consents
   where player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and consent_type = 'medical_data_processing' and granted;
  if v_conc <> 1 then raise exception '[4] la concesion original desaparecio (quedan %)', v_conc; end if;

  -- Y el append-only sigue en pie: el trigger tiene que rechazar el UPDATE.
  begin
    update public.consents set granted = true
     where player_id = 'ba0b0000-0000-4000-8000-000000000001'
       and consent_type = 'medical_data_processing' and not granted;
    raise exception '[4] el UPDATE sobre consents NO fue rechazado';
  exception
    when others then
      if sqlerrm like '%[4]%' then raise; end if;
  end;
end $$;

-- ── [5] Idempotente ─────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000001', 'medical_data_processing');
  perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000001', 'medical_data_processing');
  reset role;
  select count(*) into v_n from public.consents
   where player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and consent_type = 'medical_data_processing' and not granted;
  if v_n <> 1 then raise exception '[5] hay % filas de retirada, esperaba 1', v_n; end if;
end $$;

-- ── [6] Concedido en temporada finalizada: se puede retirar, y se sella en la activa ──
do $$
declare v_season uuid; v_granted boolean;
begin
  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000001', 'image_social');
  reset role;

  select c.granted, c.season_id into v_granted, v_season from public.consents c
   where c.player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'image_social'
   order by c.accepted_at desc, c.seq desc limit 1;

  if v_granted is not false then raise exception '[6] no se retiro el de la temporada finalizada'; end if;
  if v_season is distinct from 'ba0c0000-0000-4000-8000-000000000001' then
    raise exception '[6] se sello en la temporada equivocada: %', v_season;
  end if;
end $$;

-- ── [7] Los obligatorios no se retiran aqui ─────────────────────────────────
do $$
declare v_msg text; v_n int;
begin
  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000001');
  begin
    perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000001', 'privacy_policy');
    reset role;
    raise exception '[7] privacy_policy se pudo retirar';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[7]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'not_revocable' then
    raise exception '[7] error inesperado: %', v_msg;
  end if;
  -- Y no ha quedado ninguna fila suelta.
  select count(*) into v_n from public.consents
   where player_id = 'ba0b0000-0000-4000-8000-000000000001'
     and consent_type = 'privacy_policy' and not granted;
  if v_n <> 0 then raise exception '[7] se escribio una retirada de privacy_policy'; end if;
end $$;

-- ── [8] La puerta ───────────────────────────────────────────────────────────
do $$
declare v_msg text;
begin
  -- Sin sesion.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
  begin
    perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000002', 'image_internal');
    reset role;
    raise exception '[8] sin sesion se pudo retirar';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[8]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'no_session' then raise exception '[8] sin sesion: error inesperado %', v_msg; end if;

  -- El EX-TUTOR: conserva su fila en el ledger, pero ya no maneja al jugador. Es el
  -- caso que aisla el gate — con fila previa, quitar el gate deja pasar la retirada.
  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000003');
  begin
    perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000001', 'image_internal');
    reset role;
    raise exception '[8] un EX-tutor pudo retirar';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[8]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'forbidden' then raise exception '[8] ex-tutor: error inesperado %', v_msg; end if;
end $$;

-- ── [9] Sin fila previa no se inventa una retirada ──────────────────────────
do $$
declare v_msg text; v_n int;
begin
  perform pg_temp.como('ba0a0000-0000-4000-8000-000000000002');
  begin
    -- Su hijo existe, pero no tiene ningun consentimiento registrado.
    perform public.revoke_player_consent('ba0b0000-0000-4000-8000-000000000002', 'image_internal');
    reset role;
    raise exception '[9] se retiro algo que no existia';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[9]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'nothing_to_revoke' then raise exception '[9] error inesperado: %', v_msg; end if;
  select count(*) into v_n from public.consents where player_id = 'ba0b0000-0000-4000-8000-000000000002';
  if v_n <> 0 then raise exception '[9] se escribio una fila de la nada'; end if;
end $$;

-- ── [10] Candado de privilegios ─────────────────────────────────────────────
do $$
declare v_sig text := 'public.revoke_player_consent(uuid, public.consent_type, text, text)';
begin
  if has_function_privilege('anon', v_sig, 'EXECUTE') then
    raise exception '[10] anon puede ejecutar la retirada';
  end if;
  if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
    raise exception '[10] authenticated NO puede ejecutar la retirada';
  end if;
  if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
    raise exception '[10] service_role NO puede ejecutar la retirada';
  end if;
  -- Y PUBLIC tampoco por la via de la ACL.
  if (select count(*) from aclexplode(
        (select proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname='public' and p.proname='revoke_player_consent'))
      where grantee = 0) > 0 then
    raise exception '[10] la ACL sigue concediendo a PUBLIC';
  end if;
end $$;

rollback;
