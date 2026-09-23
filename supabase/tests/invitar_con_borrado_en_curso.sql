-- RC-A — el tutor con un borrado de cuenta EN CURSO no puede crear la cuenta propia
-- de su hijo (migracion 20261103000000).
--
-- LA VENTANA QUE CIERRA, medida entera contra produccion antes de escribir nada: el
-- tutor pide el borrado cuando su hijo aun no tiene cuenta —la 20261101000000 le deja,
-- y hace bien—, y durante los 30 dias de plazo le invita. Medido: la tarjeta decia
-- 'none' y `invite_player_self` devolvia la invitacion CREADA. El hijo aceptaba (el
-- candado de BC-6 frena a quien acepta, y quien se borra es el padre) y al vencer el
-- plazo el crio se quedaba dentro de la app sin nadie.
--
-- La 20261102000000 (RC-B) cierra la salida: el remate le retira la cuenta. Esto cierra
-- la ENTRADA. Las dos hacen falta y no se solapan: RC-B cubre ademas las cuentas que ya
-- existian antes de pedir el borrado.
--
-- El candado vive en `player_self_invite_blocker`, el predicado que YA comparten la RPC
-- y la tarjeta, asi que ni `invite_player_self` ni `player_self_account_status` se
-- tocan. Eso hace que un solo sitio conteste las dos preguntas; [2] y [3] comprueban
-- justamente que contestan lo mismo.
--
-- Cubre:
--   [1] ANCLA POSITIVA. Antes del borrado, el MISMO tutor: la tarjeta dice 'none' y
--       la invitacion se crea. Sin esto, lo de abajo no afirma nada: una negativa
--       puede venir de que el fixture este roto.
--   [2] Con el borrado en curso, la TARJETA dice 'account_deletion_pending'.
--   [3] Con el borrado en curso, la RPC se niega con ese mismo codigo y NO deja
--       invitacion detras.
--   [4] ORDEN: si ademas faltan los consentimientos de imagen, gana el borrado. Es el
--       unico motivo que no se arregla arreglando al jugador; mandar al tutor a firmar
--       para desbloquear un boton que su propio borrado tiene cerrado seria mentirle.
--   [5] EL CANDADO ES DE QUIEN LLAMA, no del jugador: el OTRO tutor del mismo crio,
--       que no se esta borrando, invita sin problema.
--   [6] Se desbloquea solo: cancelado el borrado, vuelve a 'none' y vuelve a invitar.
--       No hay estado propio que limpiar.
--   [7] CANDADO ACL: el blocker sigue cerrado a anon y a authenticated.
--   [8] LA PREMISA DEL DISENO: al blocker solo llega un TUTOR. El propio jugador sale
--       antes por la rama 'linked' —si no tuviera cuenta propia no seria 'self' y no
--       pasaria el gate—. Si esto dejara de ser cierto, el blocker estaria midiendo al
--       llamante para alguien que no es el tutor.
--
-- El control negativo (quitar el bloque y ver [2] y [3] en rojo) se corrio aparte
-- contra produccion, igual que en RC-B: no cabe dentro del fichero porque la funcion
-- ya viene reemplazada por la migracion.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Las aserciones LEEN con el rol de la sesion: las comprobaciones de estado
-- van como postgres.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('fa700000-0000-4000-8000-000000000001', 'Club RCA', 'club-rca');

insert into public.seasons (id, club_id, label, status) values
  ('fa7c0000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000001', '2026-27', 'active');

-- t1 = el tutor que se va · t2 = el otro tutor de j2 · m5 = la cuenta propia de j5
select pg_temp.new_test_user('fa7a0000-0000-4000-8000-000000000001', 't1@rca.test', '{}'::jsonb);
select pg_temp.new_test_user('fa7a0000-0000-4000-8000-000000000002', 't2@rca.test', '{}'::jsonb);
select pg_temp.new_test_user('fa7a0000-0000-4000-8000-000000000005', 'm5@rca.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('fa7a0000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000001', 'jugador'),
  ('fa7a0000-0000-4000-8000-000000000002', 'fa700000-0000-4000-8000-000000000001', 'jugador'),
  ('fa7a0000-0000-4000-8000-000000000005', 'fa700000-0000-4000-8000-000000000001', 'jugador');

-- Fechas FIJAS: todos menores hoy y dentro de diez anos.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('fa7b0000-0000-4000-8000-000000000001', 'fa700000-0000-4000-8000-000000000001', 'Uno',   'Rca', '2014-03-03'),
  ('fa7b0000-0000-4000-8000-000000000002', 'fa700000-0000-4000-8000-000000000001', 'Dos',   'Rca', '2014-03-03'),
  ('fa7b0000-0000-4000-8000-000000000003', 'fa700000-0000-4000-8000-000000000001', 'Tres',  'Rca', '2014-03-03'),
  ('fa7b0000-0000-4000-8000-000000000004', 'fa700000-0000-4000-8000-000000000001', 'Cuatro','Rca', '2014-03-03'),
  ('fa7b0000-0000-4000-8000-000000000005', 'fa700000-0000-4000-8000-000000000001', 'Cinco', 'Rca', '2014-03-03');

-- t1 es tutor de j1..j4. t2 lo es TAMBIEN de j2, y es el UNICO de j5.
-- j5 cuelga de t2 y no de t1 a proposito: j5 ya tiene cuenta propia, y la
-- 20261101000000 —la regla hermana— no dejaria a t1 ni pedir el borrado teniendo un
-- hijo con cuenta. Colgarlo de t1 haria que este fichero no llegase a montarse.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('fa7b0000-0000-4000-8000-000000000001', 'fa7a0000-0000-4000-8000-000000000001', 'parent'),
  ('fa7b0000-0000-4000-8000-000000000002', 'fa7a0000-0000-4000-8000-000000000001', 'parent'),
  ('fa7b0000-0000-4000-8000-000000000003', 'fa7a0000-0000-4000-8000-000000000001', 'parent'),
  ('fa7b0000-0000-4000-8000-000000000004', 'fa7a0000-0000-4000-8000-000000000001', 'parent'),
  ('fa7b0000-0000-4000-8000-000000000002', 'fa7a0000-0000-4000-8000-000000000002', 'parent'),
  ('fa7b0000-0000-4000-8000-000000000005', 'fa7a0000-0000-4000-8000-000000000002', 'parent'),
  ('fa7b0000-0000-4000-8000-000000000005', 'fa7a0000-0000-4000-8000-000000000005', 'self');

-- Decisiones de imagen en la temporada activa para TODOS menos j3: j3 es el que mide
-- el orden en [4]. `granted` da igual —el blocker comprueba que exista la decision, no
-- cual fue— pero se pone true para no mezclar dos cosas en un mismo fixture.
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select 'fa7a0000-0000-4000-8000-000000000001', p.id,
       ld.doc_type::text::public.consent_type, true, ld.id, ld.version,
       'fa7c0000-0000-4000-8000-000000000001'
  from public.players p
  cross join public.legal_documents ld
 where p.club_id = 'fa700000-0000-4000-8000-000000000001'
   and p.id <> 'fa7b0000-0000-4000-8000-000000000003'
   and ld.club_id = 'fa700000-0000-4000-8000-000000000001'
   and ld.doc_type in ('image_internal', 'image_social');

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] ANCLA POSITIVA: el mismo tutor, ANTES de pedir el borrado.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"fa7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_estado text; v_inv record;
begin
  v_estado := public.player_self_account_status('fa7b0000-0000-4000-8000-000000000001');
  if v_estado <> 'none' then
    raise exception 'FAIL [1]: sin borrado en curso la tarjeta tenia que decir none, dijo %', v_estado;
  end if;
  select * into v_inv from public.invite_player_self('fa7b0000-0000-4000-8000-000000000001', 'j1@rca.test');
  if v_inv.id is null then
    raise exception 'FAIL [1]: sin borrado en curso la invitacion tenia que crearse';
  end if;
end $$;

-- Esa invitacion se retira ANTES de pedir el borrado, y no es limpieza cosmetica: la
-- 20261101000000 cuenta una invitacion viva como «hijo con cuenta propia» y se negaria
-- a aceptar la peticion. Las dos reglas se engranan; con ella puesta, este fixture no
-- llegaria ni a montarse.
reset role;
delete from public.invitations where player_id = 'fa7b0000-0000-4000-8000-000000000001';

-- ── El tutor pide el borrado ─────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"fa7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.request_account_deletion('ensayo rca');
exception when others then
  raise exception 'FAIL [montaje]: el tutor tenia que poder pedir el borrado sin hijos con cuenta (%)', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] La tarjeta lo dice.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_estado text;
begin
  v_estado := public.player_self_account_status('fa7b0000-0000-4000-8000-000000000002');
  if v_estado <> 'account_deletion_pending' then
    raise exception 'FAIL [2]: la tarjeta tenia que decir account_deletion_pending, dijo %', v_estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] La RPC se niega, con el mismo codigo, y no deja nada detras.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.invite_player_self('fa7b0000-0000-4000-8000-000000000002', 'j2@rca.test');
  raise exception 'FAIL [3]: la RPC tenia que negarse con un borrado en curso';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%account_deletion_pending%' then
      raise exception 'FAIL [3]: esperaba account_deletion_pending, dio: %', sqlerrm;
    end if;
end $$;

reset role;
do $$
begin
  if exists (
    select 1 from public.invitations
     where player_id = 'fa7b0000-0000-4000-8000-000000000002'
  ) then
    raise exception 'FAIL [3]: la RPC se nego pero dejo la invitacion creada';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] ORDEN: j3 no tiene las decisiones de imagen. Gana el borrado.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"fa7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_estado text;
begin
  v_estado := public.player_self_account_status('fa7b0000-0000-4000-8000-000000000003');
  if v_estado <> 'account_deletion_pending' then
    raise exception 'FAIL [4]: con borrado en curso Y consentimientos pendientes esperaba account_deletion_pending, dijo %', v_estado;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] El candado es de QUIEN LLAMA: el otro tutor de j2 invita sin problema.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"fa7a0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare v_estado text; v_inv record;
begin
  v_estado := public.player_self_account_status('fa7b0000-0000-4000-8000-000000000002');
  if v_estado <> 'none' then
    raise exception 'FAIL [5]: el tutor que NO se borra tenia que ver none, vio %', v_estado;
  end if;
  select * into v_inv from public.invite_player_self('fa7b0000-0000-4000-8000-000000000002', 'j2@rca.test');
  if v_inv.id is null then
    raise exception 'FAIL [5]: el tutor que NO se borra tenia que poder invitar';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] Cancelado el borrado, se desbloquea solo.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"fa7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v_estado text; v_inv record;
begin
  perform public.cancel_account_deletion();
  v_estado := public.player_self_account_status('fa7b0000-0000-4000-8000-000000000004');
  if v_estado <> 'none' then
    raise exception 'FAIL [6]: cancelado el borrado la tarjeta tenia que volver a none, dijo %', v_estado;
  end if;
  select * into v_inv from public.invite_player_self('fa7b0000-0000-4000-8000-000000000004', 'j4@rca.test');
  if v_inv.id is null then
    raise exception 'FAIL [6]: cancelado el borrado tenia que poder invitar otra vez';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] CANDADO ACL: el blocker no se ofrece al cliente.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.player_self_invite_blocker(uuid)', 'execute') then
    raise exception 'FAIL [7]: anon puede ejecutar player_self_invite_blocker';
  end if;
  if has_function_privilege('authenticated', 'public.player_self_invite_blocker(uuid)', 'execute') then
    raise exception 'FAIL [7]: authenticated puede ejecutar player_self_invite_blocker';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] LA PREMISA: al blocker solo llega un tutor. El propio jugador sale por 'linked'.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.player_accounts
     where player_id = 'fa7b0000-0000-4000-8000-000000000005'
       and profile_id = 'fa7a0000-0000-4000-8000-000000000005'
       and relation in ('parent', 'guardian')
  ) then
    raise exception 'FAIL [8]: el fixture es malo, m5 tenia que entrar SOLO como self';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"fa7a0000-0000-4000-8000-000000000005","role":"authenticated"}';
do $$
declare v_estado text;
begin
  v_estado := public.player_self_account_status('fa7b0000-0000-4000-8000-000000000005');
  if v_estado <> 'linked' then
    raise exception 'FAIL [8]: el propio jugador tenia que salir por linked antes del blocker, salio %', v_estado;
  end if;
end $$;

reset role;
rollback;
