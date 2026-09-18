-- Conceder un consentimiento fuera del alta (mig 20261084000000).
-- Cubre:
--   [1] EL MAPA. consent_type y legal_document_type no coinciden por nombre en el
--       quinto valor: medical_data_processing se documenta con
--       medical_informed_consent. Un mapa por identidad habria compilado y habria
--       fallado SOLO en el de salud, que es el unico de los tres del art. 9.
--   [2] JAMAS FIRMADO -> concedido. El caso que motiva la migracion: sin ninguna fila
--       previa, la foto no se ve (#622) y no habia forma de arreglarlo.
--   [3] SE FIRMA LO QUE SE LEYO. Con la v2 publicada, la v1 se rechaza
--       (document_changed) y NO escribe nada; la v2 se sella apuntando a la v2.
--   [4] El efecto que no buscaba: con las dos decisiones de imagen en la temporada
--       activa, player_self_invite_blocker deja de bloquear la cuenta propia del hijo.
--   [5] RETIRADO -> concedido otra vez. RV-1 y RV-3 conviven sobre el mismo tipo y el
--       ledger queda con las tres filas; el permiso medico vuelve, lectura Y escritura
--       (la escritura es la que filtra por temporada).
--   [6] Idempotente: conceder dos veces deja UNA sola fila.
--   [7] Lo que no se concede aqui: los obligatorios (not_grantable) y un club sin ese
--       texto (no_document) — probado con el documento de OTRO club, que tampoco vale.
--   [8] La puerta: sin sesion, un EX-tutor con filas en el ledger, y un MENOR con
--       cuenta propia (el gate dice que un menor no maneja sus datos sensibles).
--   [9] LA INVARIANTE: la rejilla sale del gate. Lo listado es exactamente aquello de
--       lo que user_manages_player_sensitive dice que si, sujeto por sujeto — incluido
--       el jugador MAYOR con cuenta propia, que si recibe opciones.
--  [10] Los tres estados (never/granted/revoked) y los dos documentos: el firmado
--       (null si nunca se decidio) y el vigente (null si el club no tiene el texto, que
--       es lo que la pantalla usa para no ofrecer el boton).
--  [11] CANDADO de privilegios: las tres funciones cerradas a anon y a PUBLIC.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
-- Los privilegios se comprueban con has_function_privilege, NUNCA provocando el 42501
-- (leccion de BC-1: eso tumbaba el backend del CI).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
-- Club 1: el normal. Club 2: al que le falta un texto, para [7].
insert into public.clubs (id, name, slug) values
  ('bb000000-0000-4000-8000-000000000001', 'Club RV3', 'club-rv3'),
  ('bb000000-0000-4000-8000-000000000002', 'Club Sin Texto', 'club-rv3-sin-texto');

-- Los dos clubes tienen temporada activa. El 2 la necesita A PROPOSITO: asi el unico
-- motivo por el que puede fallar es no_document, y no un no_active_season que lo
-- taparia si alguien reordenara las comprobaciones.
insert into public.seasons (id, club_id, label, status) values
  ('bb0c0000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', '2026-27', 'active'),
  ('bb0c0000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', '2025-26', 'finalized'),
  ('bb0c0000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000002', '2026-27', 'active');

--  tutor    = padre de Hijo (club 1)
--  otro     = padre de Ajeno (club 1) — para la invariante
--  extutor  = conserva filas en el ledger sobre Hijo, pero ya no es su tutor
--  menor    = cuenta propia de un jugador MENOR
--  adulto   = cuenta propia de un jugador MAYOR de edad
--  cotutor  = el OTRO tutor de Hijo (mismo jugador, otra persona)
--  tutor2   = padre de Hijo Dos (club 2, el club sin texto)
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000001', 'tutor@rv3.test',   '{"full_name": "Tutor"}'::jsonb);
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000002', 'otro@rv3.test',    '{"full_name": "Otro"}'::jsonb);
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000003', 'extutor@rv3.test', '{"full_name": "ExTutor"}'::jsonb);
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000004', 'menor@rv3.test',   '{"full_name": "Menor"}'::jsonb);
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000005', 'adulto@rv3.test',  '{"full_name": "Adulto"}'::jsonb);
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000006', 'tutor2@rv3.test',  '{"full_name": "Tutor Dos"}'::jsonb);
select pg_temp.new_test_user('bb0a0000-0000-4000-8000-000000000007', 'cotutor@rv3.test', '{"full_name": "CoTutor"}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('bb0a0000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'jugador'),
  ('bb0a0000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'jugador'),
  ('bb0a0000-0000-4000-8000-000000000004', 'bb000000-0000-4000-8000-000000000001', 'jugador'),
  ('bb0a0000-0000-4000-8000-000000000005', 'bb000000-0000-4000-8000-000000000001', 'jugador'),
  ('bb0a0000-0000-4000-8000-000000000006', 'bb000000-0000-4000-8000-000000000002', 'jugador'),
  ('bb0a0000-0000-4000-8000-000000000007', 'bb000000-0000-4000-8000-000000000001', 'jugador');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('bb0b0000-0000-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'Hijo',   'Rv3', (current_date - interval '12 years')::date),
  ('bb0b0000-0000-4000-8000-000000000002', 'bb000000-0000-4000-8000-000000000001', 'Ajeno',  'Rv3', (current_date - interval '12 years')::date),
  ('bb0b0000-0000-4000-8000-000000000003', 'bb000000-0000-4000-8000-000000000001', 'Menor',  'Rv3', (current_date - interval '12 years')::date),
  ('bb0b0000-0000-4000-8000-000000000004', 'bb000000-0000-4000-8000-000000000001', 'Adulto', 'Rv3', (current_date - interval '20 years')::date),
  ('bb0b0000-0000-4000-8000-000000000005', 'bb000000-0000-4000-8000-000000000002', 'Hijo',   'Dos',  (current_date - interval '12 years')::date);

insert into public.player_accounts (player_id, profile_id, relation) values
  ('bb0b0000-0000-4000-8000-000000000001', 'bb0a0000-0000-4000-8000-000000000001', 'parent'),
  ('bb0b0000-0000-4000-8000-000000000002', 'bb0a0000-0000-4000-8000-000000000002', 'parent'),
  ('bb0b0000-0000-4000-8000-000000000003', 'bb0a0000-0000-4000-8000-000000000004', 'self'),
  ('bb0b0000-0000-4000-8000-000000000004', 'bb0a0000-0000-4000-8000-000000000005', 'self'),
  ('bb0b0000-0000-4000-8000-000000000005', 'bb0a0000-0000-4000-8000-000000000006', 'parent'),
  ('bb0b0000-0000-4000-8000-000000000001', 'bb0a0000-0000-4000-8000-000000000007', 'parent');

-- Los textos NO se insertan: el trigger `clubs_seed_legal_documents` siembra los CINCO
-- doc_type en la version 1 al crear el club, y hay un unique (club_id, doc_type,
-- version). Se usan los sembrados, que ademas es lo que pasa en produccion.
create or replace function pg_temp.doc(p_club uuid, p_type public.legal_document_type, p_ver int default 1)
returns uuid language sql stable as $$
  select id from public.legal_documents
   where club_id = p_club and doc_type = p_type and version = p_ver
$$;

-- [7] — al club 2 le falta el texto de imagen en redes. Es el unico camino a
-- no_document: el trigger los siembra todos.
delete from public.legal_documents
 where club_id = 'bb000000-0000-4000-8000-000000000002' and doc_type = 'image_social';

-- [5] — el permiso medico CONCEDIDO en la temporada activa, para poder retirarlo y
-- volver a concederlo.
insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('bb0a0000-0000-4000-8000-000000000001', 'bb0b0000-0000-4000-8000-000000000001', 'medical_data_processing', true,
   pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'medical_informed_consent'), 1,
   'bb0c0000-0000-4000-8000-000000000001');

-- El ex-tutor conserva su fila sobre Hijo. NO esta en player_accounts: es el caso que
-- aisla el GATE, porque con fila previa una busqueda sin portero le encontraria estado.
-- Su fila es del permiso MEDICO a proposito: `player_photo_visible` resuelve
-- latest-wins sin mirar de quien es la fila, asi que una fila suya de image_internal
-- haria visible la foto y el ancla de [2] se caeria por el fixture, no por el codigo.
insert into public.consents
  (tutor_profile_id, player_id, consent_type, granted, legal_document_id, legal_document_version, season_id) values
  ('bb0a0000-0000-4000-8000-000000000003', 'bb0b0000-0000-4000-8000-000000000001', 'medical_data_processing', true,
   pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'medical_informed_consent'), 1,
   'bb0c0000-0000-4000-8000-000000000001');

create or replace function pg_temp.como(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- `reset role` NO limpia request.jwt.claims (es transaccional y sobrevive), asi que
-- «sin sesion» necesita su propio ayudante o se mide con el sub del bloque anterior.
create or replace function pg_temp.sin_sesion() returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
end $$;

-- ── [1] El mapa, valor por valor ─────────────────────────────────────────────
do $$
declare v_t public.consent_type; v_d public.legal_document_type; v_n int;
begin
  if public.consent_document_type('medical_data_processing') <> 'medical_informed_consent' then
    raise exception '[1] medical_data_processing NO apunta a medical_informed_consent: %',
      public.consent_document_type('medical_data_processing');
  end if;
  if public.consent_document_type('image_internal') <> 'image_internal'
     or public.consent_document_type('image_social') <> 'image_social'
     or public.consent_document_type('terms_conditions') <> 'terms_conditions'
     or public.consent_document_type('privacy_policy') <> 'privacy_policy' then
    raise exception '[1] el mapa cambio en alguno de los cuatro que si coinciden por nombre';
  end if;

  -- Ningun valor del enum se queda sin mapa: un CASE sin ELSE devuelve NULL, y eso
  -- terminaria en no_document en vez de en un error que se vea.
  for v_t in select unnest(enum_range(null::public.consent_type)) loop
    v_d := public.consent_document_type(v_t);
    if v_d is null then raise exception '[1] % no tiene documento asignado', v_t; end if;
  end loop;

  -- Y el mapa RESUELVE: los tres opcionales tienen texto sembrado en el club.
  select count(*) into v_n from public.legal_documents ld
   where ld.club_id = 'bb000000-0000-4000-8000-000000000001'
     and ld.doc_type in (
       public.consent_document_type('image_internal'),
       public.consent_document_type('image_social'),
       public.consent_document_type('medical_data_processing'));
  if v_n <> 3 then raise exception '[1] el mapa no resuelve a 3 textos del club, resuelve a %', v_n; end if;
end $$;

-- ── [2] Jamas firmado -> concedido ───────────────────────────────────────────
do $$
declare v_n int; v_granted boolean; v_doc uuid; v_ver int; v_season uuid;
begin
  -- ANCLA: sin ninguna fila, la foto no se ve. Es lo que dejo #622, y sin esta
  -- asercion el «true» de despues no significaria nada.
  if public.player_photo_visible('bb0b0000-0000-4000-8000-000000000001') is not false then
    raise exception '[2] la foto se veia ANTES de conceder nada';
  end if;
  select count(*) into v_n from public.consents
   where tutor_profile_id = 'bb0a0000-0000-4000-8000-000000000001'
     and player_id = 'bb0b0000-0000-4000-8000-000000000001'
     and consent_type = 'image_internal';
  if v_n <> 0 then raise exception '[2] el fixture ya traia % filas de image_internal', v_n; end if;

  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  perform public.grant_player_consent(
    'bb0b0000-0000-4000-8000-000000000001', 'image_internal',
    pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_internal'), '10.0.0.1', 'pgTAP');
  reset role;

  select count(*) into v_n from public.consents
   where tutor_profile_id = 'bb0a0000-0000-4000-8000-000000000001'
     and player_id = 'bb0b0000-0000-4000-8000-000000000001'
     and consent_type = 'image_internal';
  if v_n <> 1 then raise exception '[2] esperaba 1 fila, hay %', v_n; end if;

  select c.granted, c.legal_document_id, c.legal_document_version, c.season_id
    into v_granted, v_doc, v_ver, v_season
  from public.consents c
   where c.tutor_profile_id = 'bb0a0000-0000-4000-8000-000000000001'
     and c.player_id = 'bb0b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'image_internal'
   order by c.accepted_at desc, c.seq desc limit 1;

  if v_granted is not true then raise exception '[2] la fila no es una concesion'; end if;
  if v_doc is distinct from pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_internal') then
    raise exception '[2] apunta a otro documento: %', v_doc;
  end if;
  if v_ver <> 1 then raise exception '[2] version equivocada: %', v_ver; end if;
  if v_season is distinct from 'bb0c0000-0000-4000-8000-000000000001' then
    raise exception '[2] NO se sello en la temporada activa: %', v_season;
  end if;

  -- Y el efecto: la funcion que gatea la RLS de storage cambia de opinion.
  if public.player_photo_visible('bb0b0000-0000-4000-8000-000000000001') is not true then
    raise exception '[2] la foto SIGUE sin verse despues de conceder image_internal';
  end if;
end $$;

-- ── [3] Se firma lo que se leyo ──────────────────────────────────────────────
do $$
declare v_msg text; v_n int; v_ver int; v_v2 uuid;
begin
  -- El club publica la v2 de imagen en redes.
  insert into public.legal_documents (club_id, doc_type, version, title, body)
  values ('bb000000-0000-4000-8000-000000000001', 'image_social', 2, 'Imagen en redes v2', 'Texto nuevo.')
  returning id into v_v2;

  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  begin
    -- La pantalla venia con la v1 en la mano.
    perform public.grant_player_consent(
      'bb0b0000-0000-4000-8000-000000000001', 'image_social',
      pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_social', 1));
    reset role;
    raise exception '[3] se sello una aceptacion del texto viejo';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[3]%' then raise; end if;
  end;
  if v_msg is distinct from 'document_changed' then
    raise exception '[3] error inesperado con la version vieja: %', v_msg;
  end if;

  select count(*) into v_n from public.consents
   where player_id = 'bb0b0000-0000-4000-8000-000000000001' and consent_type = 'image_social';
  if v_n <> 0 then raise exception '[3] el rechazo dejo % filas escritas', v_n; end if;

  -- Con el vigente en la mano, adelante, y se sella la v2.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  perform public.grant_player_consent(
    'bb0b0000-0000-4000-8000-000000000001', 'image_social', v_v2);
  reset role;

  select c.legal_document_version into v_ver from public.consents c
   where c.player_id = 'bb0b0000-0000-4000-8000-000000000001' and c.consent_type = 'image_social'
   order by c.accepted_at desc, c.seq desc limit 1;
  if v_ver <> 2 then raise exception '[3] se sello la version % en vez de la vigente (2)', v_ver; end if;
end $$;

-- ── [4] Y la cuenta propia del hijo se desbloquea ────────────────────────────
-- player_self_invite_blocker exige que EXISTA decision de imagen (las dos) en la
-- temporada activa. Con el hueco de RV-2 no habia forma de darlas: 2 de 7 hijos de
-- produccion estan hoy bloqueados por esto.
do $$
declare v_blk text;
begin
  v_blk := public.player_self_invite_blocker('bb0b0000-0000-4000-8000-000000000001');
  if v_blk is not null then
    raise exception '[4] la cuenta propia sigue bloqueada por: %', v_blk;
  end if;
  -- Control negativo: el hijo del OTRO tutor, sin decisiones, sigue bloqueado. Si el
  -- desbloqueo de arriba viniera de otra cosa, esto lo delataria.
  if public.player_self_invite_blocker('bb0b0000-0000-4000-8000-000000000002') is distinct from 'consents_required' then
    raise exception '[4] el jugador SIN decisiones no esta bloqueado: el bloqueo no depende de los consentimientos';
  end if;
end $$;

-- ── [5] Retirado -> concedido otra vez ───────────────────────────────────────
do $$
declare v_n int; v_granted boolean; v_read boolean; v_write boolean;
begin
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent('bb0b0000-0000-4000-8000-000000000001', 'medical_data_processing');
  reset role;

  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  select public.user_has_medical_consent_write('bb0b0000-0000-4000-8000-000000000001') into v_write;
  reset role;
  if v_write is not false then raise exception '[5] ANCLA: la retirada de RV-1 no surtio efecto'; end if;

  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  perform public.grant_player_consent(
    'bb0b0000-0000-4000-8000-000000000001', 'medical_data_processing',
    pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'medical_informed_consent'));
  select public.user_has_medical_consent_read('bb0b0000-0000-4000-8000-000000000001') into v_read;
  select public.user_has_medical_consent_write('bb0b0000-0000-4000-8000-000000000001') into v_write;
  reset role;

  select c.granted into v_granted from public.consents c
   where c.tutor_profile_id = 'bb0a0000-0000-4000-8000-000000000001'
     and c.player_id = 'bb0b0000-0000-4000-8000-000000000001'
     and c.consent_type = 'medical_data_processing'
   order by c.accepted_at desc, c.seq desc limit 1;
  if v_granted is not true then raise exception '[5] la decision vigente no es la concesion'; end if;

  -- El ledger conserva las TRES: concesion del alta, retirada, concesion nueva.
  select count(*) into v_n from public.consents
   where tutor_profile_id = 'bb0a0000-0000-4000-8000-000000000001'
     and player_id = 'bb0b0000-0000-4000-8000-000000000001'
     and consent_type = 'medical_data_processing';
  if v_n <> 3 then raise exception '[5] el ledger tiene % filas, esperaba 3', v_n; end if;

  -- Vuelve el permiso, y la que importa es la de ESCRITURA: es la que filtra por
  -- temporada, asi que solo sube si la concesion se sello en la activa.
  if v_read is not true then raise exception '[5] user_has_medical_consent_read sigue en false'; end if;
  if v_write is not true then raise exception '[5] user_has_medical_consent_WRITE sigue en false: se sello fuera de la temporada activa'; end if;
end $$;

-- ── [6] Idempotente ─────────────────────────────────────────────────────────
do $$
declare v_n int;
begin
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  perform public.grant_player_consent(
    'bb0b0000-0000-4000-8000-000000000001', 'image_internal',
    pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_internal'));
  perform public.grant_player_consent(
    'bb0b0000-0000-4000-8000-000000000001', 'image_internal',
    pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_internal'));
  reset role;
  select count(*) into v_n from public.consents
   where tutor_profile_id = 'bb0a0000-0000-4000-8000-000000000001'
     and player_id = 'bb0b0000-0000-4000-8000-000000000001'
     and consent_type = 'image_internal' and granted;
  if v_n <> 1 then raise exception '[6] hay % concesiones de image_internal, esperaba 1', v_n; end if;
end $$;

-- ── [7] Lo que no se concede aqui ───────────────────────────────────────────
do $$
declare v_msg text; v_n int;
begin
  -- Los obligatorios.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  begin
    perform public.grant_player_consent(
      'bb0b0000-0000-4000-8000-000000000001', 'privacy_policy',
      pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'privacy_policy'));
    reset role;
    raise exception '[7] privacy_policy se pudo conceder desde aqui';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[7]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'not_grantable' then raise exception '[7] error inesperado: %', v_msg; end if;

  -- Un club sin ese texto. Y se le pasa el documento del OTRO club, que existe: si la
  -- funcion se fiara del parametro en vez de buscar el vigente DEL CLUB DEL JUGADOR,
  -- esto pasaria.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000006');
  begin
    perform public.grant_player_consent(
      'bb0b0000-0000-4000-8000-000000000005', 'image_social',
      pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_social', 1));
    reset role;
    raise exception '[7] se concedio con el documento de otro club';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[7]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'no_document' then raise exception '[7] club sin texto: error inesperado %', v_msg; end if;

  select count(*) into v_n from public.consents
   where player_id = 'bb0b0000-0000-4000-8000-000000000005';
  if v_n <> 0 then raise exception '[7] se escribio una fila en el club sin texto'; end if;
end $$;

-- ── [8] La puerta ───────────────────────────────────────────────────────────
do $$
declare v_msg text; v_n int;
begin
  -- Sin sesion. (Y se comprueba que el ayudante de verdad la quita: `reset role` no
  -- limpia las claims, asi que sin esto el bloque pasaria con el sub del anterior.)
  perform pg_temp.sin_sesion();
  if (select auth.uid()) is not null then
    reset role;
    raise exception '[8] el fixture sin sesion SI tiene sesion: el bloque no probaria nada';
  end if;
  begin
    perform public.grant_player_consent(
      'bb0b0000-0000-4000-8000-000000000001', 'image_internal',
      pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_internal'));
    reset role;
    raise exception '[8] sin sesion se pudo conceder';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[8]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'no_session' then raise exception '[8] sin sesion: error inesperado %', v_msg; end if;

  -- Y la rejilla tampoco se lee sin sesion.
  perform pg_temp.sin_sesion();
  begin
    perform count(*) from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001');
    reset role;
    raise exception '[8] la rejilla se leyo sin sesion';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[8]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'no_session' then raise exception '[8] rejilla sin sesion: error inesperado %', v_msg; end if;

  -- El EX-TUTOR: tiene fila en el ledger sobre Hijo, pero ya no lo maneja.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000003');
  begin
    perform public.grant_player_consent(
      'bb0b0000-0000-4000-8000-000000000001', 'image_social',
      pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_social', 2));
    reset role;
    raise exception '[8] un EX-tutor pudo conceder';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[8]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'forbidden' then raise exception '[8] ex-tutor: error inesperado %', v_msg; end if;

  -- El MENOR con cuenta propia: el gate dice que un menor no maneja sus datos
  -- sensibles, ni siquiera los suyos. La decision es de su familia.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000004');
  begin
    perform public.grant_player_consent(
      'bb0b0000-0000-4000-8000-000000000003', 'image_internal',
      pg_temp.doc('bb000000-0000-4000-8000-000000000001', 'image_internal'));
    reset role;
    raise exception '[8] un MENOR pudo conceder sobre si mismo';
  exception when others then
    v_msg := sqlerrm;
    if v_msg like '%[8]%' then raise; end if;
  end;
  reset role;
  if v_msg is distinct from 'forbidden' then raise exception '[8] menor: error inesperado %', v_msg; end if;

  select count(*) into v_n from public.consents where player_id = 'bb0b0000-0000-4000-8000-000000000003';
  if v_n <> 0 then raise exception '[8] se escribio una fila del menor'; end if;
end $$;

-- ── [9] LA INVARIANTE: la rejilla sale del gate ─────────────────────────────
-- Sujeto por sujeto: los jugadores del club que la rejilla lista son EXACTAMENTE
-- aquellos de los que user_manages_player_sensitive dice que si. Sin copiar el
-- interior del gate: se le pregunta a el.
do $$
declare
  v_sub        text;
  v_listados   uuid[];
  v_del_gate   uuid[];
  v_filas      int;
  v_sin_texto  int;
begin
  foreach v_sub in array array[
    'bb0a0000-0000-4000-8000-000000000001',  -- tutor: 1 hijo
    'bb0a0000-0000-4000-8000-000000000002',  -- otro tutor: 1 hijo (distinto)
    'bb0a0000-0000-4000-8000-000000000003',  -- ex-tutor: ninguno, aunque tenga ledger
    'bb0a0000-0000-4000-8000-000000000004',  -- menor con cuenta propia: ninguno
    'bb0a0000-0000-4000-8000-000000000005',  -- MAYOR con cuenta propia: el suyo
    'bb0a0000-0000-4000-8000-000000000007'   -- co-tutor del mismo hijo: ese hijo
  ] loop
    perform pg_temp.como(v_sub);

    select coalesce(array_agg(distinct o.player_id order by o.player_id), '{}')
      into v_listados
    from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001') o;

    -- Tres filas por jugador listado: los tres opcionales, siempre, decididos o no.
    select count(*), count(*) filter (where o.current_document_id is null)
      into v_filas, v_sin_texto
    from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001') o;

    reset role;

    -- Las claims NO se van con `reset role` (set_config transaccional), y aqui eso es
    -- la herramienta: hay que preguntarle al gate por TODOS los jugadores del club, y
    -- desde `authenticated` la RLS de players recorta la lista. Se vuelve a postgres
    -- conservando el sujeto.
    --
    -- Y se COMPRUEBA que sobrevivio, porque si no el gate diria «no» a todo, las dos
    -- listas saldrian vacias y el bloque pasaria sin probar nada precisamente para el
    -- ex-tutor y el menor, que son los dos que esperan lista vacia.
    if (select auth.uid())::text is distinct from v_sub then
      raise exception '[9] % : las claims no sobrevivieron al reset role', v_sub;
    end if;

    select coalesce(array_agg(pl.id order by pl.id), '{}')
      into v_del_gate
    from public.players pl
    where pl.club_id = 'bb000000-0000-4000-8000-000000000001'
      and public.user_manages_player_sensitive(pl.id);

    if v_listados is distinct from v_del_gate then
      raise exception '[9] % : la rejilla lista % y el gate dice %', v_sub, v_listados, v_del_gate;
    end if;
    if v_filas <> cardinality(v_listados) * 3 then
      raise exception '[9] % : % filas para % jugadores (esperaba 3 por jugador)',
        v_sub, v_filas, cardinality(v_listados);
    end if;
    -- En este club estan los tres textos, asi que todo lo listado se puede conceder.
    if v_sin_texto <> 0 then
      raise exception '[9] % : % filas sin documento vigente en un club que tiene los tres', v_sub, v_sin_texto;
    end if;
  end loop;

  -- Y el mayor de edad recibe opciones de verdad, no una lista vacia: sin esto, un gate
  -- que dijera «no» a todo pasaria las seis comprobaciones de arriba.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000005');
  select count(*) into v_filas
  from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001');
  reset role;
  if v_filas <> 3 then raise exception '[9] el jugador MAYOR con cuenta propia recibio % filas, esperaba 3', v_filas; end if;
end $$;

-- ── [10] Los tres estados y los dos documentos ──────────────────────────────
do $$
declare
  v_never    int;
  v_estado   text;
  v_firmado  uuid;
  v_vigente  uuid;
  v_tit_firm text;
  v_tit_vig  text;
  v_decidido timestamptz;
  v_n        int;
begin
  -- granted: image_internal, concedido en [2].
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  select o.state, o.signed_document_id, o.signed_document_title
    into v_estado, v_firmado, v_tit_firm
  from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001') o
  where o.player_id = 'bb0b0000-0000-4000-8000-000000000001' and o.consent_type = 'image_internal';
  reset role;
  if v_estado <> 'granted' then raise exception '[10] image_internal sale como %', v_estado; end if;
  if v_firmado is null then raise exception '[10] un concedido sin documento firmado'; end if;
  if v_tit_firm is null then raise exception '[10] el documento firmado viene sin titulo'; end if;

  -- never: el jugador MAYOR, que no tiene ninguna fila.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000005');
  select o.state, o.signed_document_id, o.decided_at, o.current_document_id, o.current_document_title
    into v_estado, v_firmado, v_decidido, v_vigente, v_tit_vig
  from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001') o
  where o.player_id = 'bb0b0000-0000-4000-8000-000000000004' and o.consent_type = 'image_internal';
  reset role;
  if v_estado <> 'never' then raise exception '[10] sin ninguna fila el estado es %', v_estado; end if;
  if v_firmado is not null then raise exception '[10] un never con documento firmado'; end if;
  if v_decidido is not null then raise exception '[10] un never con fecha de decision'; end if;
  if v_vigente is null then raise exception '[10] un never SIN documento vigente: no habria nada que ofrecer'; end if;
  if v_tit_vig is null then raise exception '[10] el documento vigente viene sin titulo'; end if;

  -- revoked: se retira el medico y se comprueba el tercer estado.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000001');
  perform public.revoke_player_consent('bb0b0000-0000-4000-8000-000000000001', 'medical_data_processing');
  select o.state, o.signed_document_id into v_estado, v_firmado
  from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001') o
  where o.player_id = 'bb0b0000-0000-4000-8000-000000000001' and o.consent_type = 'medical_data_processing';
  reset role;
  if v_estado <> 'revoked' then raise exception '[10] tras retirar el estado es %', v_estado; end if;
  if v_firmado is null then raise exception '[10] un revoked sin documento: no se podria ver que se retiro'; end if;

  -- AISLAMIENTO POR TUTOR. El co-tutor es tutor DEL MISMO hijo, sobre el que el otro
  -- ya decidio las tres cosas. Su rejilla tiene que salir virgen: lo que se ofrece es
  -- lo que ESTA PERSONA puede decidir, igual que en get_tutor_consents y en las dos
  -- escrituras.
  --
  -- Esto documenta una asimetria conocida y deliberada: el EFECTO (foto, ficha medica)
  -- es latest-wins sin mirar de quien es la fila, asi que el co-tutor vera «sin
  -- decidir» sobre algo que ya surte efecto. Viene de RV-1, no de aqui, y hoy no hay
  -- ningun jugador de produccion con dos tutores.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000007');
  select count(*), count(*) filter (where o.state = 'never')
    into v_n, v_never
  from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000001') o
  where o.player_id = 'bb0b0000-0000-4000-8000-000000000001';
  reset role;
  if v_n <> 3 then raise exception '[10] el co-tutor ve % filas de su hijo, esperaba 3', v_n; end if;
  if v_never <> 3 then
    raise exception '[10] el co-tutor ve % filas sin decidir de 3: se le estan ensenando las decisiones del otro tutor', v_never;
  end if;

  -- Y el club al que le falta un texto: la fila sale, pero SIN documento vigente. Es
  -- lo que la pantalla usa para no ofrecer un boton que la base va a rechazar.
  perform pg_temp.como('bb0a0000-0000-4000-8000-000000000006');
  select count(*) filter (where o.current_document_id is null)
    into v_n
  from public.get_tutor_consent_options('bb000000-0000-4000-8000-000000000002') o;
  reset role;
  if v_n <> 1 then raise exception '[10] el club sin un texto tiene % filas sin documento vigente, esperaba 1', v_n; end if;
end $$;

-- ── [11] Candado de privilegios ─────────────────────────────────────────────
do $$
declare
  v_sigs text[] := array[
    'public.consent_document_type(public.consent_type)',
    'public.grant_player_consent(uuid, public.consent_type, uuid, text, text)',
    'public.get_tutor_consent_options(uuid)'
  ];
  v_sig text;
  v_pub int;
begin
  foreach v_sig in array v_sigs loop
    if has_function_privilege('anon', v_sig, 'EXECUTE') then
      raise exception '[11] anon puede ejecutar %', v_sig;
    end if;
    if not has_function_privilege('authenticated', v_sig, 'EXECUTE') then
      raise exception '[11] authenticated NO puede ejecutar %', v_sig;
    end if;
    if not has_function_privilege('service_role', v_sig, 'EXECUTE') then
      raise exception '[11] service_role NO puede ejecutar %', v_sig;
    end if;
  end loop;

  select count(*) into v_pub
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(p.proacl) a
  where n.nspname = 'public'
    and p.proname in ('consent_document_type', 'grant_player_consent', 'get_tutor_consent_options')
    and a.grantee = 0;
  if v_pub > 0 then raise exception '[11] la ACL sigue concediendo a PUBLIC (% entradas)', v_pub; end if;
end $$;

rollback;
