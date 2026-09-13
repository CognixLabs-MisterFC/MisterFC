-- MN-1 — separar `self` de «tutor» (migracion 20261067000000). Cubre:
--   [1]  Los helpers sobre el TUTOR: es tutor, no es self, gestiona y gestiona lo sensible.
--   [2]  Los helpers sobre el MENOR self: NO es tutor, si es self, gestiona lo compartido
--        y NO gestiona lo sensible.
--   [3]  El ADULTO self conserva TODO lo que le dio la 20261038. Es la regresion que mas
--        importa: aquella migracion existe para que el jugador adulto gestione lo suyo.
--   [4]  player_is_minor y su BORDE: el dia del 18 cumpleanos ya no es menor.
--   [5]  Superficie RESERVADA: el menor self no puede medica, supresion ni export.
--   [6]  Superficie COMPARTIDA: el menor self si puede foto y seguidores.
--   [7]  Consentimientos: el menor SI firma los de su cuenta (player_id IS NULL) y NO los
--        que van sobre el jugador. La politica no se reserva entera.
--   [8]  Auditoria: el menor es FAMILIA, leyendo lo suyo no deja rastro en audit_log.
--   [9]  CENSO de los 18 objetos: cada uno apunta al helper que le toca y ninguno se
--        queda con el viejo. Es lo que caza al que se anada manana usando el equivocado.
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
  ('3e700000-0000-4000-8000-000000000001', 'Club MN1', 'club-mn1');

-- p1 tutor · p2 el MENOR (self) · p3 el ADULTO (self) · p4 staff del club
select pg_temp.new_test_user('3e7a0000-0000-4000-8000-000000000001', 'tutor@mn1.test', '{}'::jsonb);
select pg_temp.new_test_user('3e7a0000-0000-4000-8000-000000000002', 'menor@mn1.test', '{}'::jsonb);
select pg_temp.new_test_user('3e7a0000-0000-4000-8000-000000000003', 'adulto@mn1.test', '{}'::jsonb);
select pg_temp.new_test_user('3e7a0000-0000-4000-8000-000000000004', 'staff@mn1.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3e7a0000-0000-4000-8000-000000000001', '3e700000-0000-4000-8000-000000000001', 'jugador'),
  ('3e7a0000-0000-4000-8000-000000000002', '3e700000-0000-4000-8000-000000000001', 'jugador'),
  ('3e7a0000-0000-4000-8000-000000000003', '3e700000-0000-4000-8000-000000000001', 'jugador'),
  ('3e7a0000-0000-4000-8000-000000000004', '3e700000-0000-4000-8000-000000000001', 'admin_club');

-- j1 MENOR (11 anos) · j2 ADULTO (20) · j3 justo HOY cumple 18 (borde)
insert into public.players (id, club_id, first_name, last_name, date_of_birth, phone) values
  ('3e7b0000-0000-4000-8000-000000000001', '3e700000-0000-4000-8000-000000000001',
   'Menor', 'Mn1', (current_date - interval '11 years')::date, '600111222'),
  ('3e7b0000-0000-4000-8000-000000000002', '3e700000-0000-4000-8000-000000000001',
   'Adulto', 'Mn1', (current_date - interval '20 years')::date, '600333444'),
  ('3e7b0000-0000-4000-8000-000000000003', '3e700000-0000-4000-8000-000000000001',
   'Borde', 'Mn1', (current_date - interval '18 years')::date, '600555666');

-- consents exige season_id y legal_document_id NOT NULL: minimo para el bloque [7].
insert into public.seasons (id, club_id, label) values
  ('3e7c0000-0000-4000-8000-000000000001', '3e700000-0000-4000-8000-000000000001', '2026-27');

-- Los documentos legales del club los crea el propio alta del club: se usa el que hay.

-- El tutor lo es de j1 (el menor). El menor es `self` de j1. El adulto, `self` de j2.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('3e7b0000-0000-4000-8000-000000000001', '3e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('3e7b0000-0000-4000-8000-000000000001', '3e7a0000-0000-4000-8000-000000000002', 'self'),
  ('3e7b0000-0000-4000-8000-000000000002', '3e7a0000-0000-4000-8000-000000000003', 'self');

set local role authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] El TUTOR
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare j uuid := '3e7b0000-0000-4000-8000-000000000001';
begin
  if not public.user_is_tutor_of_player(j) then
    raise exception 'FAIL [1]: el tutor deberia ser tutor';
  end if;
  if public.user_is_player_self(j) then
    raise exception 'FAIL [1]: el tutor NO es el jugador';
  end if;
  if not public.user_manages_player(j) then
    raise exception 'FAIL [1]: el tutor gestiona la superficie compartida';
  end if;
  if not public.user_manages_player_sensitive(j) then
    raise exception 'FAIL [1]: el tutor gestiona la superficie reservada';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] El MENOR self — el corazon de MN-1
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e7a0000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare j uuid := '3e7b0000-0000-4000-8000-000000000001';
begin
  if public.user_is_tutor_of_player(j) then
    raise exception 'FAIL [2]: el menor NO es tutor — el helper volvia a mentir';
  end if;
  if not public.user_is_player_self(j) then
    raise exception 'FAIL [2]: el menor ES el jugador';
  end if;
  if not public.user_manages_player(j) then
    raise exception 'FAIL [2]: el menor gestiona la superficie COMPARTIDA';
  end if;
  if public.user_manages_player_sensitive(j) then
    raise exception 'FAIL [2]: el menor NO gestiona la superficie RESERVADA';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] El ADULTO self conserva lo de la 20261038 (regresion que mas importa)
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e7a0000-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
declare j uuid := '3e7b0000-0000-4000-8000-000000000002';
begin
  if not public.user_manages_player(j) then
    raise exception 'FAIL [3]: el jugador adulto gestiona lo suyo (compartida)';
  end if;
  if not public.user_manages_player_sensitive(j) then
    raise exception 'FAIL [3]: el jugador adulto gestiona lo suyo (reservada) — se perdio la 20261038';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] player_is_minor y el BORDE del 18 cumpleanos
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not public.player_is_minor('3e7b0000-0000-4000-8000-000000000001') then
    raise exception 'FAIL [4]: 11 anos es menor';
  end if;
  if public.player_is_minor('3e7b0000-0000-4000-8000-000000000002') then
    raise exception 'FAIL [4]: 20 anos NO es menor';
  end if;
  -- Nacido hace exactamente 18 anos: HOY cumple, ya no es menor. Esto es lo que hace
  -- que el acceso se abra solo, sin trigger ni cron.
  if public.player_is_minor('3e7b0000-0000-4000-8000-000000000003') then
    raise exception 'FAIL [4]: el dia del 18 cumpleanos ya NO es menor';
  end if;
  -- Jugador inexistente: false, no nulo (nada de NULL-bypass).
  if public.player_is_minor('3e7b0000-0000-4000-8000-0000000000ff') is not false then
    raise exception 'FAIL [4]: un jugador inexistente debe dar false, no nulo';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Superficie RESERVADA: el menor self NO llega
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"3e7a0000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare j uuid := '3e7b0000-0000-4000-8000-000000000001';
begin
  begin
    perform public.set_player_medical(j, 'polen', null, null, null);
    raise exception 'FAIL [5]: el menor NO puede escribir su medica';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAIL %' then raise; end if;   -- era nuestra propia asercion
      if sqlerrm not like '%forbidden%' then
        raise exception 'FAIL [5]: medica debia dar forbidden, dio: %', sqlerrm;
      end if;
  end;

  begin
    perform public.request_player_erasure(j, null);
    raise exception 'FAIL [5]: el menor NO puede pedir su supresion';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAIL %' then raise; end if;
      if sqlerrm not like '%forbidden%' then
        raise exception 'FAIL [5]: supresion debia dar forbidden, dio: %', sqlerrm;
      end if;
  end;

  begin
    perform public.record_data_export(j, null, null);
    raise exception 'FAIL [5]: el menor NO puede registrar un export RGPD';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAIL %' then raise; end if;
      if sqlerrm not like '%forbidden%' then
        raise exception 'FAIL [5]: export debia dar forbidden, dio: %', sqlerrm;
      end if;
  end;

  -- La puerta de LECTURA de la medica tambien se cierra (get_player_medical se gatea ahi).
  if public.user_can_access_player_medical(j) then
    raise exception 'FAIL [5]: el menor NO puede leer su medica';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] Superficie COMPARTIDA: el menor self SI llega
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  j uuid := '3e7b0000-0000-4000-8000-000000000001';
  v_n integer;
begin
  -- Foto.
  begin
    perform public.set_player_photo(j, j::text || '/mia.webp');
  exception when others then
    raise exception 'FAIL [6]: el menor no pudo poner su foto: %', sqlerrm;
  end;

  -- Contacto: la puerta se abre (decision 3 de Jose).
  if not public.user_can_access_player_contact(j) then
    raise exception 'FAIL [6]: el menor ve el contacto de los suyos';
  end if;

  -- Seguidores: invitar, listar y revocar (decision 1 de Jose).
  begin
    perform public.invite_spectator(j, 'abuela@mn1.test');
  exception when others then
    raise exception 'FAIL [6]: el menor no pudo invitar a un seguidor: %', sqlerrm;
  end;

  begin
    select count(*) into v_n from public.list_player_spectators(j);
  exception when others then
    raise exception 'FAIL [6]: el menor no pudo listar sus seguidores: %', sqlerrm;
  end;

  begin
    perform public.remove_spectator(j, '3e7a0000-0000-4000-8000-000000000004');
  exception when others then
    raise exception 'FAIL [6]: el menor no pudo revocar un seguidor: %', sqlerrm;
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] Consentimientos: la politica NO se reserva entera
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare j uuid := '3e7b0000-0000-4000-8000-000000000001';
begin
  -- Los de LA CUENTA (player_id IS NULL) el menor SI los firma: sin esto no podria
  -- aceptar los terminos de su propia cuenta y no podria darse de alta.
  begin
    insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                                 legal_document_id, legal_document_version, season_id)
    values (auth.uid(), null, 'terms_conditions', true,
            (select id from public.legal_documents
              where club_id = '3e700000-0000-4000-8000-000000000001'
                and doc_type = 'terms_conditions' order by version desc limit 1),
            (select version from public.legal_documents
              where club_id = '3e700000-0000-4000-8000-000000000001'
                and doc_type = 'terms_conditions' order by version desc limit 1),
            '3e7c0000-0000-4000-8000-000000000001');
  exception when others then
    raise exception 'FAIL [7]: el menor debe poder firmar los terminos de SU cuenta: %', sqlerrm;
  end;

  -- Los que van SOBRE el jugador, no.
  begin
    insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                                 legal_document_id, legal_document_version, season_id)
    values (auth.uid(), j, 'image_internal', true,
            (select id from public.legal_documents
              where club_id = '3e700000-0000-4000-8000-000000000001'
                and doc_type = 'terms_conditions' order by version desc limit 1),
            (select version from public.legal_documents
              where club_id = '3e700000-0000-4000-8000-000000000001'
                and doc_type = 'terms_conditions' order by version desc limit 1),
            '3e7c0000-0000-4000-8000-000000000001');
    raise exception 'FAIL [7]: el menor NO firma consentimientos sobre el jugador';
  exception
    when sqlstate 'P0001' then
      if sqlerrm like 'FAIL %' then raise; end if;
    when insufficient_privilege then null;   -- 42501: la policy lo rechaza, correcto
  end;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] Auditoria: el menor es FAMILIA y no deja rastro
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  j     uuid := '3e7b0000-0000-4000-8000-000000000001';
  v_ant integer;
  v_des integer;
begin
  select count(*) into v_ant from public.audit_log
   where target_id = j and action in ('contact.read', 'contact.read.platform');

  perform public.get_player_phone(j, null, null);

  select count(*) into v_des from public.audit_log
   where target_id = j and action in ('contact.read', 'contact.read.platform');

  if v_des <> v_ant then
    raise exception 'FAIL [8]: el menor leyendo su telefono NO debe dejar rastro (familia), se anadieron %', v_des - v_ant;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] CENSO de los 18 objetos
--
-- La matriz de arriba caza la semantica; esto caza las OMISIONES. Estrechar el
-- significado de un nombre que ya existia es silencioso: SQL no falla, simplemente
-- deniega. Si manana alguien anade un objeto y llama al helper equivocado, o si
-- cualquiera de los 18 se quedara sin re-apuntar, aqui salta.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;

do $$
declare
  r          record;
  v_esperado text;
  v_real     text;
  v_malos    text := '';
  v_total    integer := 0;
begin
  for r in
    select 'FUNCION' as tipo, p.proname as objeto, pg_get_functiondef(p.oid) as cuerpo
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('get_player_medical','get_player_phone','get_player_tutors_contact',
                         'invite_spectator','list_player_spectators','remove_spectator',
                         'players_guard_photo_url','record_data_export','request_player_erasure',
                         'set_player_medical','set_player_photo','user_can_access_player_contact',
                         'user_can_access_player_medical')
    union all
    select 'POLITICA', policyname, coalesce(qual,'') || ' ' || coalesce(with_check,'')
      from pg_policies
     where policyname in ('consents_insert_own','player_spectators_select',
                          'player_photos_insert_tutor','player_photos_update_tutor',
                          'player_photos_delete_tutor')
  loop
    v_total := v_total + 1;

    v_esperado := case r.objeto
      when 'set_player_medical'              then 'RESERVADA'
      when 'user_can_access_player_medical'  then 'RESERVADA'
      when 'request_player_erasure'          then 'RESERVADA'
      when 'record_data_export'              then 'RESERVADA'
      when 'consents_insert_own'             then 'RESERVADA'
      else 'COMPARTIDA'
    end;

    v_real := case
      when r.cuerpo like '%user_manages_player_sensitive%' then 'RESERVADA'
      when r.cuerpo like '%user_manages_player(%'          then 'COMPARTIDA'
      when r.cuerpo like '%user_is_tutor_of_player%'       then 'TUTOR-SOLO'
      else '(ninguno)'
    end;

    if v_real is distinct from v_esperado then
      v_malos := v_malos || format(' %s %s: esperaba %s, usa %s;', r.tipo, r.objeto, v_esperado, v_real);
    end if;
  end loop;

  if v_total <> 18 then
    raise exception 'FAIL [9]: el censo esperaba 18 objetos y encontro %. Si se anadio o quito uno, la lista de arriba tambien se actualiza', v_total;
  end if;

  if v_malos <> '' then
    raise exception 'FAIL [9]: objetos apuntando al helper equivocado →%', v_malos;
  end if;
end $$;

-- Ninguno de los 18 puede quedarse llamando al helper viejo: si alguno lo hiciera,
-- para el menor significaria o bien una puerta abierta que Jose reservo, o bien una
-- cerrada que decidio compartir.
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('get_player_medical','get_player_phone','get_player_tutors_contact',
                       'invite_spectator','list_player_spectators','remove_spectator',
                       'players_guard_photo_url','record_data_export','request_player_erasure',
                       'set_player_medical','set_player_photo','user_can_access_player_contact',
                       'user_can_access_player_medical')
     and pg_get_functiondef(p.oid) like '%user_is_tutor_of_player%';
  if v_n <> 0 then
    raise exception 'FAIL [9]: % funciones siguen llamando a user_is_tutor_of_player directamente', v_n;
  end if;
end $$;

-- Los cuatro de seguidores llevaban el `relation=''self''` escrito a mano. La logica vive
-- ahora en el helper (leccion de BC-3), asi que no debe quedar ni una copia.
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('invite_spectator','list_player_spectators','remove_spectator')
     and pg_get_functiondef(p.oid) like '%relation = ''self''%';
  if v_n <> 0 then
    raise exception 'FAIL [9]: quedan % copias del predicado self escritas a mano', v_n;
  end if;

  if exists (
    select 1 from pg_policies
     where policyname = 'player_spectators_select'
       and coalesce(qual,'') like '%relation = ''self''%'
  ) then
    raise exception 'FAIL [9]: player_spectators_select conserva el predicado self a mano';
  end if;
end $$;

-- CANDADO de privilegios de los helpers nuevos: los default privileges de Supabase
-- conceden POR NOMBRE, asi que se afirma el ACL en vez de darlo por hecho.
do $$
declare f text;
begin
  foreach f in array array['user_is_player_self(uuid)','player_is_minor(uuid)',
                           'user_manages_player(uuid)','user_manages_player_sensitive(uuid)']
  loop
    if not has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') then
      raise exception 'FAIL [9]: authenticated necesita EXECUTE sobre %', f;
    end if;
  end loop;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ MN-1: helpers, matriz de 18 y censo pasaron.'
\echo '──────────────────────────────────────────────'
