-- F14 — DESEMPATE del ledger de consentimientos (RGPD).
--
-- POR QUÉ EXISTE: `consents.accepted_at` es `now()`, que es CONSTANTE dentro de una
-- transacción. Dos filas de la misma clave selladas en la misma transacción empatan
-- SIEMPRE, y sin desempate la respuesta la decide el orden físico de la tabla, no el
-- ledger. Reproducido contra producción (BEGIN...ROLLBACK) antes del arreglo: una
-- CONCESIÓN seguida de una REVOCACIÓN en la misma transacción dejaba
-- `player_photo_visible` = true, es decir, la foto seguía visible después de revocar.
--
-- REGLA QUE SE PRUEBA (decisión Jose): manda SIEMPRE la ÚLTIMA fila insertada, sea
-- concesión o revocación. No es "gana la restrictiva": una revocación insertada ANTES
-- NO puede ganar a una concesión posterior de la misma transacción.
--
-- Invariantes:
--   T0. La columna de desempate `seq` existe (si no, la migración está sin aplicar).
--   T1. Foto: concesión → revocación, misma marca ⇒ NO visible (gana la revocación).
--   T2. Foto: revocación → concesión, misma marca ⇒ visible (gana la concesión).
--   T3. Médica: concesión → revocación, misma marca ⇒ lectura DENEGADA.
--   T4. Médica (escritura, anclada a temporada): misma regla.
--   T5. `seq` es estrictamente creciente dentro de la MISMA transacción.
--   T6. El append-only sigue vivo: UPDATE y DELETE bloqueados.
\ir helpers/auth_users.sql

begin;

-- ── T0: sin la columna, el resto no tiene sentido. Mensaje explícito. ──
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'consents' and column_name = 'seq'
  ) then
    raise exception 'FAIL [T0]: falta consents.seq — la migración del desempate no está aplicada en esta BD';
  end if;
end $$;

-- ── Scaffold: club (auto-siembra legal_documents v1), temporada activa, menor y tutor. ──
insert into public.clubs (id, name, slug) values
  ('f1450000-cccc-0000-0000-000000000001', 'Club Seq', 'seq-desempate-consents');

insert into public.seasons (id, club_id, label, status) values
  ('f1450000-5ea5-0000-0000-000000000001', 'f1450000-cccc-0000-0000-000000000001', '2025-26', 'active');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f1450000-0000-aaaa-0000-000000000001', 'f1450000-cccc-0000-0000-000000000001', 'Menor', 'Seq', '2015-04-12');

select pg_temp.new_test_user('f1450000-1111-1111-1111-111111111111', 'tutor-seq@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1450000-115e-0000-0000-000000000001', 'f1450000-1111-1111-1111-111111111111', 'f1450000-cccc-0000-0000-000000000001', 'jugador');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('f1450000-0000-aaaa-0000-000000000001', 'f1450000-1111-1111-1111-111111111111', 'parent');

-- Todas las filas de este bloque comparten `accepted_at` a propósito: es
-- EXACTAMENTE lo que hace now() dentro de una transacción.
do $$
declare
  v_player   uuid := 'f1450000-0000-aaaa-0000-000000000001';
  v_tutor    uuid := 'f1450000-1111-1111-1111-111111111111';
  v_season   uuid := 'f1450000-5ea5-0000-0000-000000000001';
  v_doc_img  uuid;
  v_doc_med  uuid;
  v_ts       timestamptz := now();
  v_resp     boolean;
  v_a bigint; v_b bigint; v_c bigint;
begin
  select id into v_doc_img from public.legal_documents
   where club_id = 'f1450000-cccc-0000-0000-000000000001' and doc_type = 'image_internal';
  select id into v_doc_med from public.legal_documents
   where club_id = 'f1450000-cccc-0000-0000-000000000001' and doc_type = 'medical_informed_consent';
  if v_doc_img is null or v_doc_med is null then
    raise exception 'FAIL: el club no sembró legal_documents (scaffold roto)';
  end if;

  -- ── T1: concesión y DESPUÉS revocación, misma marca ⇒ gana la revocación. ──
  insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                               legal_document_id, legal_document_version, season_id, accepted_at)
  values (v_tutor, v_player, 'image_internal', true, v_doc_img, 1, v_season, v_ts)
  returning seq into v_a;

  insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                               legal_document_id, legal_document_version, season_id, accepted_at)
  values (v_tutor, v_player, 'image_internal', false, v_doc_img, 1, v_season, v_ts)
  returning seq into v_b;

  select public.player_photo_visible(v_player) into v_resp;
  if v_resp is not false then
    raise exception 'FAIL [T1]: la foto sigue VISIBLE tras revocar (empate resuelto por orden físico)';
  end if;

  -- ── T2: y ahora una concesión posterior, mismo empate ⇒ vuelve a verse. ──
  insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                               legal_document_id, legal_document_version, season_id, accepted_at)
  values (v_tutor, v_player, 'image_internal', true, v_doc_img, 1, v_season, v_ts)
  returning seq into v_c;

  select public.player_photo_visible(v_player) into v_resp;
  if v_resp is not true then
    raise exception 'FAIL [T2]: no gana la ÚLTIMA fila; esto sería "gana la restrictiva", que NO es la regla';
  end if;

  -- ── T5: seq estrictamente creciente dentro de la misma transacción. ──
  if not (v_a < v_b and v_b < v_c) then
    raise exception 'FAIL [T5]: seq no crece dentro de la transacción (% , % , %)', v_a, v_b, v_c;
  end if;

  -- ── T3/T4: la médica, categoría especial: concesión → revocación. ──
  insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                               legal_document_id, legal_document_version, season_id, accepted_at)
  values (v_tutor, v_player, 'medical_data_processing', true, v_doc_med, 1, v_season, v_ts);

  insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                               legal_document_id, legal_document_version, season_id, accepted_at)
  values (v_tutor, v_player, 'medical_data_processing', false, v_doc_med, 1, v_season, v_ts);

  select public.user_has_medical_consent_read(v_player) into v_resp;
  if v_resp is not false then
    raise exception 'FAIL [T3]: la médica se lee como consentida tras una revocación empatada';
  end if;

  select public.user_has_medical_consent_write(v_player) into v_resp;
  if v_resp is not false then
    raise exception 'FAIL [T4]: la médica se deja ESCRIBIR tras una revocación empatada';
  end if;
end $$;

-- ── T6: el append-only sigue vivo (el ALTER de la migración no lo tocó). ──
do $$
declare v_id uuid;
begin
  select id into v_id from public.consents
   where player_id = 'f1450000-0000-aaaa-0000-000000000001' limit 1;
  begin
    update public.consents set granted = not granted where id = v_id;
    raise exception 'FAIL [T6]: el UPDATE ha pasado; el append-only está roto';
  exception when restrict_violation then null;
  end;
  begin
    delete from public.consents where id = v_id;
    raise exception 'FAIL [T6]: el DELETE ha pasado; el append-only está roto';
  exception when restrict_violation then null;
  end;
end $$;

rollback;
