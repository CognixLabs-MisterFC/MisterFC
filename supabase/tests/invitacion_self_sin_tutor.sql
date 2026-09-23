-- Punto 7 (camino A) — la invitación de cuenta propia tampoco se crea sin tutor.
--
-- QUÉ SE PROTEGE. `invitations_insert_admin` deja a cualquier admin_club/director
-- insertar `role='jugador'`, `player_relation='self'` sin mirar si hay tutor, y
-- ningún CHECK lo frenaba. Medido contra producción: invitación → cuenta → aceptada
-- → menor con cuenta propia y cero tutores.
--
-- El candado de verdad es el trigger de `player_accounts` (mig 20261097000000). Este
-- adelanta el rechazo a quien CREA la invitación: sin él, la invitación se crea, el
-- correo sale, y el error le estalla al niño al pulsar el enlace.
--
-- Invariantes:
--   T0. El trigger existe (si no, la migración está sin aplicar y el resto miente).
--   T1. Invitación de TUTOR a un jugador sin vínculos ⇒ PASA (es la primera de todas).
--   T2. Invitación `self` de un MENOR sin tutor ⇒ RECHAZA.
--   T3. Invitación `self` de un MENOR CON tutor ⇒ PASA.
--   T4. Invitación `self` de un jugador ADULTO sin tutor ⇒ PASA (mig 20261038).
--   T5. Invitación de SEGUIDOR ⇒ PASA (no lleva relación, no toca player_accounts).
--   T6. UPDATE que convierte una invitación de tutor en `self` sin tutor ⇒ RECHAZA.
--   T7. ACEPTAR (update de accepted_at) NO dispara el trigger, ni siquiera cuando el
--       tutor ya no está. Es lo que protege el `update of <columnas>`.
--   T8. Por la vía buena manda `invite_player_self`: un NO-tutor lee 'forbidden',
--       no 'self_sin_tutor'. El orden de los errores no cambia.
--   T9. CONTROL NEGATIVO: sin el trigger, lo de T2 pasa.
\ir helpers/auth_users.sql

begin;

-- ── T0 ──
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.invitations'::regclass
       and tgname = 'invitations_self_con_tutor'
       and not tgisinternal
  ) then
    raise exception 'FAIL [T0]: falta el trigger invitations_self_con_tutor — la migración 20261098000000 no está aplicada en esta BD';
  end if;
end $$;

-- ── Scaffold ───────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('f1980000-cccc-0000-0000-000000000001', 'Club Invit P7', 'punto-7-invitacion-self');

insert into public.seasons (id, club_id, label, status) values
  ('f1980000-5ea5-0000-0000-000000000001', 'f1980000-cccc-0000-0000-000000000001', '2025-26', 'active');

-- MENOR sin nada · MENOR que tendrá tutor · ADULTO (fecha fija, sin aritmética que
-- dependa del día en que corra la suite).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f1980000-0000-aaaa-0000-00000000000a', 'f1980000-cccc-0000-0000-000000000001', 'Menor',  'Solo',    '2014-03-01'),
  ('f1980000-0000-bbbb-0000-00000000000b', 'f1980000-cccc-0000-0000-000000000001', 'Menor',  'ConTutor','2015-06-02'),
  ('f1980000-0000-cccc-0000-00000000000c', 'f1980000-cccc-0000-0000-000000000001', 'Adulto', 'ConFicha','1995-02-03');

select pg_temp.new_test_user('f1980000-1111-1111-1111-000000000001', 'admin-p7b@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1980000-1111-1111-1111-000000000002', 'tutor-p7b@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1980000-1111-1111-1111-000000000003', 'ajeno-p7b@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1980000-115e-0000-0000-000000000001', 'f1980000-1111-1111-1111-000000000001', 'f1980000-cccc-0000-0000-000000000001', 'admin_club'),
  ('f1980000-115e-0000-0000-000000000002', 'f1980000-1111-1111-1111-000000000002', 'f1980000-cccc-0000-0000-000000000001', 'jugador'),
  ('f1980000-115e-0000-0000-000000000003', 'f1980000-1111-1111-1111-000000000003', 'f1980000-cccc-0000-0000-000000000001', 'jugador');

-- ── T1: la invitación de TUTOR no exige tutor previo. Es la que lo crea. ──
do $$
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
      ('tutor-p7b@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'jugador',
       'f1980000-0000-bbbb-0000-00000000000b', 'parent', 'f1980000-1111-1111-1111-000000000001');
  exception when others then
    raise exception 'FAIL [T1]: la invitación de TUTOR de un jugador sin vínculos debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T2: el camino A medido en producción. ──
do $$
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
      ('menor-solo@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'jugador',
       'f1980000-0000-aaaa-0000-00000000000a', 'self', 'f1980000-1111-1111-1111-000000000001');
    raise exception 'FAIL [T2]: se ha creado la invitación de cuenta propia de un MENOR SIN TUTOR';
  exception when check_violation then null;
  end;
end $$;

-- ── T3: con el tutor ya vinculado, la invitación del menor entra. ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1980000-0000-bbbb-0000-00000000000b', 'f1980000-1111-1111-1111-000000000002', 'parent');
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
      ('hijo-p7b@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'jugador',
       'f1980000-0000-bbbb-0000-00000000000b', 'self', 'f1980000-1111-1111-1111-000000000002');
  exception when others then
    raise exception 'FAIL [T3]: el camino bueno (tutor vinculado → invitar al menor) debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T4: EL CASO QUE NO ES ASUNTO DE ESTA REGLA. Un jugador mayor de edad
--    vinculándose a su propia ficha nunca necesitó tutor (mig 20261038). Es el
--    error que la primera versión del guard hermano cometió, y que aquí no se
--    repite. ──
do $$
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
      ('adulto-p7b@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'jugador',
       'f1980000-0000-cccc-0000-00000000000c', 'self', 'f1980000-1111-1111-1111-000000000001');
  exception when others then
    raise exception 'FAIL [T4]: un jugador ADULTO no puede ser invitado a su propia ficha sin tutor (%). La regla se ha pasado de ancha', sqlerrm;
  end;
end $$;

-- ── T5: el seguidor no lleva relación y no crea vínculo de familia. ──
do $$
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
      ('abuela-p7b@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'spectator',
       'f1980000-0000-aaaa-0000-00000000000a', null, 'f1980000-1111-1111-1111-000000000002');
  exception when others then
    raise exception 'FAIL [T5]: la invitación de SEGUIDOR debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T6: el UPDATE. Una invitación de tutor que se convierte en `self` produce
--    exactamente el mismo daño que un INSERT, por otra puerta. ──
do $$
declare v_id uuid;
begin
  insert into public.invitations (email, club_id, role, player_id, player_relation, created_by)
  values ('otro-tutor-p7b@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'jugador',
          'f1980000-0000-aaaa-0000-00000000000a', 'parent', 'f1980000-1111-1111-1111-000000000001')
  returning id into v_id;
  begin
    update public.invitations set player_relation = 'self' where id = v_id;
    raise exception 'FAIL [T6]: una invitación de tutor se ha convertido en cuenta propia de un menor sin tutor';
  exception when check_violation then null;
  end;
end $$;

-- ── T7: ACEPTAR no vuelve a evaluar la regla. Se monta el peor caso posible: una
--    invitación `self` VIVA y legítima cuyo tutor ya no está vinculado (se retiró
--    después de cursarla, cosa que el guard de player_accounts permite porque el
--    menor todavía no tiene cuenta). Si el trigger mirara todo UPDATE, el
--    `accepted_at = now()` de `accept_pending_invitations` la rechazaría — y
--    tumbaría la aceptación de TODO el lote. ──
do $$
declare v_id uuid;
begin
  select id into v_id from public.invitations
   where player_id = 'f1980000-0000-bbbb-0000-00000000000b' and player_relation = 'self';
  if v_id is null then
    raise exception 'FAIL [T7]: no está la invitación de T3; el montaje del test es el que falla';
  end if;

  delete from public.player_accounts
   where player_id = 'f1980000-0000-bbbb-0000-00000000000b'
     and profile_id = 'f1980000-1111-1111-1111-000000000002';

  -- Ancla positiva: el jugador se ha quedado SIN tutor de verdad. Sin esto, el
  -- UPDATE de abajo pasaría por el motivo equivocado y el test no probaría nada.
  if exists (
    select 1 from public.player_accounts
     where player_id = 'f1980000-0000-bbbb-0000-00000000000b'
       and relation in ('parent', 'guardian')
  ) then
    raise exception 'FAIL [T7]: el jugador sigue teniendo tutor; este test ya no prueba que aceptar no reevalúe la regla';
  end if;

  begin
    update public.invitations set accepted_at = now() where id = v_id;
  exception when others then
    raise exception 'FAIL [T7]: aceptar ha disparado el trigger (%). El `update of <columnas>` no está acotado', sqlerrm;
  end;
end $$;

-- ── T8: por la vía buena, el que manda es `invite_player_self`. Quien no es tutor
--    lee 'forbidden', que es lo que la app sabe traducir — no el 'self_sin_tutor'
--    de este trigger, que nunca debería llegarle a nadie por ahí. ──
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1980000-1111-1111-1111-000000000003","role":"authenticated"}';

do $$
begin
  begin
    perform public.invite_player_self(
      'f1980000-0000-aaaa-0000-00000000000a', 'quien-sea-p7b@ts.test');
    raise exception 'FAIL [T8]: un NO-tutor ha podido cursar la invitación de cuenta propia';
  exception
    when check_violation then
      raise exception 'FAIL [T8]: el rechazo ha venido del trigger, no del gate de invite_player_self. El orden de los errores ha cambiado y la app enseñará el mensaje equivocado';
    when others then
      if sqlerrm <> 'forbidden' then
        raise exception 'FAIL [T8]: se esperaba «forbidden» del gate de invite_player_self y ha llegado «%»', sqlerrm;
      end if;
  end;
end $$;

reset role;

-- ── T9: CONTROL NEGATIVO. Sin el trigger, lo de T2 entra. Si esto fallara, el
--    rechazo de T2 lo estaría produciendo otra cosa —un CHECK, una FK, la RLS— y
--    este fichero no probaría lo que dice. El rollback repone el trigger. ──
drop trigger invitations_self_con_tutor on public.invitations;

do $$
begin
  begin
    insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
      ('menor-solo@ts.test', 'f1980000-cccc-0000-0000-000000000001', 'jugador',
       'f1980000-0000-aaaa-0000-00000000000a', 'self', 'f1980000-1111-1111-1111-000000000001');
  exception when others then
    raise exception 'FAIL [T9]: sin el trigger, la invitación de cuenta propia sin tutor debería entrar. Ha fallado con % — el rechazo de T2 no lo produce el trigger', sqlerrm;
  end;
end $$;

rollback;
