-- MN-4 — la misma direccion no puede ser tutor Y cuenta propia (migracion 20261071000000).
-- Cubre:
--   [1]  La red: una invitacion de TUTOR a la direccion que ya es la cuenta propia
--        del jugador se rechaza. Es el agujero de invite_email, por su lado medible.
--   [2]  Tambien contra una invitacion self VIVA, antes de que llegue a ser cuenta.
--   [3]  La direccion contraria, por la RPC: invite_player_self contra una cuenta de
--        tutor (lo que MN-2 llamaba email_is_tutor) y contra una invitacion de tutor
--        VIVA (lo que MN-2 NO cazaba, porque solo miraba cuentas).
--   [4]  Una invitacion CADUCADA no bloquea: un error de tecleo no envenena una
--        direccion para siempre.
--   [5]  Una invitacion ACEPTADA tampoco manda por si sola. Lo que manda es la cuenta.
--   [6]  Normalizacion: mayusculas y espacios chocan igual.
--   [7]  El UPDATE de una fila no se bloquea a si mismo.
--   [8]  Lo que NO toca: invitacion sin jugador, y dos tutores con la misma direccion.
--   [9]  CANDADO: el predicado vive en UN sitio, cerrado a anon/authenticated/PUBLIC,
--        y el trigger esta puesto sobre los eventos que tiene que vigilar.
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
  ('3ea00000-0000-4000-8000-000000000001', 'Club MN4', 'club-mn4');

insert into public.seasons (id, club_id, label, status) values
  ('3eac0000-0000-4000-8000-000000000001', '3ea00000-0000-4000-8000-000000000001', '2026-27', 'active');

select pg_temp.new_test_user('3eaa0000-0000-4000-8000-000000000001', 't1@mn4.test', '{}'::jsonb);
select pg_temp.new_test_user('3eaa0000-0000-4000-8000-000000000002', 'm1@mn4.test', '{}'::jsonb);
select pg_temp.new_test_user('3eaa0000-0000-4000-8000-000000000003', 't2@mn4.test', '{}'::jsonb);
select pg_temp.new_test_user('3eaa0000-0000-4000-8000-000000000004', 'tutorbase@mn4.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('3eaa0000-0000-4000-8000-000000000001', '3ea00000-0000-4000-8000-000000000001', 'jugador'),
  ('3eaa0000-0000-4000-8000-000000000002', '3ea00000-0000-4000-8000-000000000001', 'jugador'),
  ('3eaa0000-0000-4000-8000-000000000003', '3ea00000-0000-4000-8000-000000000001', 'jugador'),
  ('3eaa0000-0000-4000-8000-000000000004', '3ea00000-0000-4000-8000-000000000001', 'jugador');

-- j1 el que YA tiene las dos cuentas (tutor t1 + propia m1), con direcciones distintas:
-- esa combinacion es legitima y no la toca nadie. j2 el de la rama de la RPC.
-- j3..j6 sirven cada uno a un escenario, para que ninguno arrastre estado del anterior.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('3eab0000-0000-4000-8000-000000000001', '3ea00000-0000-4000-8000-000000000001', 'Uno',   'Mn4', (current_date - interval '12 years')::date),
  ('3eab0000-0000-4000-8000-000000000002', '3ea00000-0000-4000-8000-000000000001', 'Dos',   'Mn4', (current_date - interval '12 years')::date),
  ('3eab0000-0000-4000-8000-000000000003', '3ea00000-0000-4000-8000-000000000001', 'Tres',  'Mn4', (current_date - interval '12 years')::date),
  ('3eab0000-0000-4000-8000-000000000004', '3ea00000-0000-4000-8000-000000000001', 'Cuatro','Mn4', (current_date - interval '12 years')::date),
  ('3eab0000-0000-4000-8000-000000000005', '3ea00000-0000-4000-8000-000000000001', 'Cinco', 'Mn4', (current_date - interval '12 years')::date),
  ('3eab0000-0000-4000-8000-000000000006', '3ea00000-0000-4000-8000-000000000001', 'Seis',  'Mn4', (current_date - interval '12 years')::date);

-- Tutor de j3..j6. Desde la mig 20261098000000 no se crea la invitación de cuenta
-- propia de un MENOR sin tutor, y j3..j6 son los jugadores sobre los que estos
-- bloques cursan esas invitaciones. Su dirección no aparece en ningún escenario:
-- está para que exista el tutor, no para entrar en ningún choque de correos.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('3eab0000-0000-4000-8000-000000000001', '3eaa0000-0000-4000-8000-000000000001', 'parent'),
  ('3eab0000-0000-4000-8000-000000000001', '3eaa0000-0000-4000-8000-000000000002', 'self'),
  ('3eab0000-0000-4000-8000-000000000002', '3eaa0000-0000-4000-8000-000000000003', 'parent'),
  ('3eab0000-0000-4000-8000-000000000003', '3eaa0000-0000-4000-8000-000000000004', 'parent'),
  ('3eab0000-0000-4000-8000-000000000004', '3eaa0000-0000-4000-8000-000000000004', 'parent'),
  ('3eab0000-0000-4000-8000-000000000005', '3eaa0000-0000-4000-8000-000000000004', 'parent'),
  ('3eab0000-0000-4000-8000-000000000006', '3eaa0000-0000-4000-8000-000000000004', 'parent');

-- j2 con sus decisiones de imagen: es la precondicion de invite_player_self (MN-2), y
-- sin ellas los bloques [3] fallarian por el motivo equivocado.
insert into public.consents (tutor_profile_id, player_id, consent_type, granted,
                             legal_document_id, legal_document_version, season_id)
select '3eaa0000-0000-4000-8000-000000000003', '3eab0000-0000-4000-8000-000000000002',
       ld.doc_type::text::public.consent_type, true, ld.id, ld.version,
       '3eac0000-0000-4000-8000-000000000001'
  from public.legal_documents ld
 where ld.club_id = '3ea00000-0000-4000-8000-000000000001'
   and ld.doc_type in ('image_internal', 'image_social');

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] La red — invitacion de TUTOR a la direccion que ya es la cuenta propia
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('m1@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000001', 'parent');
  raise exception 'FAIL [1]: la direccion de la cuenta propia no puede recibir invitacion de tutor';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%email_relation_conflict%' then
      raise exception 'FAIL [1]: esperaba email_relation_conflict, dio: %', sqlerrm;
    end if;
end $$;

-- Y la combinacion legitima —dos direcciones DISTINTAS, una de tutor y otra propia—
-- sigue pasando: el guard mide la direccion, no la existencia de cuenta propia.
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('otrotutor@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000001', 'parent');
exception when others then
  raise exception 'FAIL [1]: otro tutor con OTRA direccion debe poder entrar: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] Tambien contra una invitacion self VIVA, antes de que sea cuenta
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.invitations (email, club_id, role, player_id, player_relation)
values ('choque@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
        '3eab0000-0000-4000-8000-000000000003', 'self');

do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('choque@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000003', 'parent');
  raise exception 'FAIL [2]: una invitacion self viva debe bloquear la de tutor';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%email_relation_conflict%' then
      raise exception 'FAIL [2]: esperaba email_relation_conflict, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] La direccion contraria, por la RPC
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eaa0000-0000-4000-8000-000000000003","role":"authenticated"}';

-- 3a · contra una CUENTA de tutor. Es el caso que MN-2 llamaba email_is_tutor.
do $$
begin
  perform public.invite_player_self('3eab0000-0000-4000-8000-000000000002', 't2@mn4.test');
  raise exception 'FAIL [3a]: el tutor no puede invitarse a si mismo como cuenta propia';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%email_relation_conflict%' then
      raise exception 'FAIL [3a]: esperaba email_relation_conflict, dio: %', sqlerrm;
    end if;
end $$;

reset role;

-- 3b · contra una INVITACION de tutor VIVA. Esto MN-2 no lo cazaba: solo miraba
--      cuentas, y una invitacion pendiente todavia no es una cuenta.
insert into public.invitations (email, club_id, role, player_id, player_relation)
values ('pendiente@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
        '3eab0000-0000-4000-8000-000000000002', 'guardian');

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"3eaa0000-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
begin
  perform public.invite_player_self('3eab0000-0000-4000-8000-000000000002', 'pendiente@mn4.test');
  raise exception 'FAIL [3b]: una invitacion de tutor viva debe bloquear la de cuenta propia';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%email_relation_conflict%' then
      raise exception 'FAIL [3b]: esperaba email_relation_conflict, dio: %', sqlerrm;
    end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Una invitacion CADUCADA no bloquea
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.invitations (email, club_id, role, player_id, player_relation, expires_at)
values ('caducada@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
        '3eab0000-0000-4000-8000-000000000004', 'self', now() - interval '1 day');

do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('caducada@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000004', 'parent');
exception when others then
  raise exception 'FAIL [4]: una invitacion caducada no debe bloquear: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] Una invitacion ACEPTADA no manda por si sola: manda la cuenta
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.invitations (email, club_id, role, player_id, player_relation, accepted_at)
values ('aceptada@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
        '3eab0000-0000-4000-8000-000000000005', 'self', now());

do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('aceptada@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000005', 'parent');
exception when others then
  raise exception 'FAIL [5]: sin cuenta detras, una invitacion aceptada no bloquea: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] Normalizacion — mayusculas y espacios chocan igual
-- ─────────────────────────────────────────────────────────────────────────────
insert into public.invitations (email, club_id, role, player_id, player_relation)
values ('MiXtO@Mn4.TEST', '3ea00000-0000-4000-8000-000000000001', 'jugador',
        '3eab0000-0000-4000-8000-000000000006', 'self');

do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('  mixto@mn4.test  ', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000006', 'parent');
  raise exception 'FAIL [6]: la misma direccion con otro formato debe chocar igual';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%email_relation_conflict%' then
      raise exception 'FAIL [6]: esperaba email_relation_conflict, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [7] El UPDATE de una fila no se bloquea a si mismo
--
-- Donde importa es en el CAMBIO DE RELACION, y por un detalle de los BEFORE UPDATE:
-- cuando el trigger corre, la tabla todavia guarda el valor VIEJO de la fila. Un
-- 'self' que pasa a 'parent' se encontraria a si mismo —como self, con su misma
-- direccion y su mismo jugador— y chocaria consigo mismo.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_id uuid;
begin
  select id into v_id from public.invitations
   where player_id = '3eab0000-0000-4000-8000-000000000006' and player_relation = 'self';
  update public.invitations set player_relation = 'parent' where id = v_id;
exception when others then
  if sqlerrm like 'FAIL %' then raise; end if;
  raise exception 'FAIL [7]: una fila no puede chocar consigo misma al cambiar de relacion: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [8] Lo que NO toca
-- ─────────────────────────────────────────────────────────────────────────────
-- 8a · invitacion de staff, sin jugador: el trigger pasa de largo.
do $$
begin
  insert into public.invitations (email, club_id, role)
  values ('staff@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'coordinador');
exception when others then
  raise exception 'FAIL [8a]: una invitacion sin jugador no se mira: %', sqlerrm;
end $$;

-- 8b · dos tutores del mismo jugador con la MISMA direccion. Raro, pero no es la
--      contradiccion que medimos, y romperlo seria romper altas normales.
do $$
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('padres@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000003', 'parent');
  insert into public.invitations (email, club_id, role, player_id, player_relation)
  values ('padres@mn4.test', '3ea00000-0000-4000-8000-000000000001', 'jugador',
          '3eab0000-0000-4000-8000-000000000003', 'guardian');
exception when others then
  raise exception 'FAIL [8b]: dos tutores con la misma direccion no es el caso que medimos: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] CANDADO — un solo sitio, cerrado, y el trigger sobre los eventos correctos
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_n int; v_def text;
begin
  -- El predicado no se llama desde ninguna sesion: lo usan el trigger (que corre con
  -- el rol de la tabla) y una RPC security definer.
  if has_function_privilege('anon',
       'public.player_email_relation_conflict(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL [9]: anon NO puede ejecutar el predicado';
  end if;
  if has_function_privilege('authenticated',
       'public.player_email_relation_conflict(uuid,text,text,uuid)', 'EXECUTE') then
    raise exception 'FAIL [9]: authenticated NO puede ejecutar el predicado';
  end if;

  -- El trigger, puesto y sobre los tres campos que pueden crear la contradiccion.
  select count(*) into v_n
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'invitations'
     and t.tgname = 'invitations_relation_not_mixed_check' and not t.tgisinternal;
  if v_n <> 1 then
    raise exception 'FAIL [9]: falta el trigger sobre invitations';
  end if;

  select pg_get_triggerdef(t.oid) into v_def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'invitations'
     and t.tgname = 'invitations_relation_not_mixed_check';
  if v_def not like '%BEFORE INSERT OR UPDATE OF email, player_id, player_relation%' then
    raise exception 'FAIL [9]: el trigger no vigila los campos que debe: %', v_def;
  end if;

  -- Y el predicado no se ha quedado escrito ADEMAS a mano en la RPC: MN-4 existe
  -- justamente para que viva en un sitio. Es el censo que caza al que lo recopie.
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'invite_player_self';
  if v_def like '%email_is_tutor%' then
    raise exception 'FAIL [9]: invite_player_self conserva el predicado viejo escrito a mano';
  end if;
  if v_def not like '%player_email_relation_conflict%' then
    raise exception 'FAIL [9]: invite_player_self debe llamar al predicado comun';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ MN-4: tutor y cuenta propia no comparten direccion, y el predicado vive en un sitio.'
\echo '──────────────────────────────────────────────'
