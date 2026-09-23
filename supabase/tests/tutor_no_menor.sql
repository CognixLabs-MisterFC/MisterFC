-- Tercera desviación — un MENOR no puede figurar como tutor.
--
-- QUÉ SE PROTEGE. Nada impide que el club escriba en `players.invite_email` —el
-- campo del TUTOR— la dirección del propio crío. El crío acepta y queda registrado
-- como `parent` de sí mismo: desde ahí firma sus consentimientos, ve la ficha médica
-- y puede pedir la supresión. MN-4 ya describió el agujero y dijo por qué no podía
-- cerrarlo: no se puede saber de quién es un correo. Esto lo ataca por la EDAD, que
-- cuando consta sí se mide.
--
-- DOS VÍAS, y basta con una:
--   (a) el perfil es la cuenta propia (`self`) de un jugador menor → dato al 100%;
--   (b) su `profiles.date_of_birth`, SI consta → hoy está al 0% en los vínculos
--       vivos, así que esta vía no muerde hasta que esa fecha se recoja.
--
-- Y la AUSENCIA de fecha no afirma nada (doctrina de la 219 de VERTEX). T4 lo fija:
-- si alguien hiciera que negase ante la ausencia, rompería el alta de todos.
--
-- Invariantes:
--   T0. El trigger existe (si no, la migración está sin aplicar y el resto miente).
--   T1. Un adulto de fecha conocida como tutor ⇒ PASA.
--   T2. Vía (b): un perfil cuya `profiles.date_of_birth` dice menor ⇒ RECHAZA.
--   T3. Vía (a): la cuenta propia de un jugador MENOR, como tutor de otro ⇒ RECHAZA.
--   T4. SIN fecha y sin cuenta propia ⇒ PASA. La ausencia no afirma nada.
--   T5. La cuenta propia de un jugador ADULTO, como tutor de su hermano ⇒ PASA.
--   T6. El propio `self` no se toca: un menor SÍ es cuenta propia de su ficha.
--   T7. El UPDATE: un `self` de menor que pasa a `parent` ⇒ RECHAZA.
--   T8. EL CASO QUE NOS TRAJO AQUÍ: el club pone el correo del niño en el campo del
--       tutor, el niño acepta dando su fecha real ⇒ RECHAZA.
--   T9. CONTROL NEGATIVO: sin el trigger, lo de T2 y lo de T3 pasan.
\ir helpers/auth_users.sql

begin;

-- ── T0 ──
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.player_accounts'::regclass
       and tgname = 'player_accounts_tutor_mayor'
       and not tgisinternal
  ) then
    raise exception 'FAIL [T0]: falta el trigger player_accounts_tutor_mayor — la migración 20261099000000 no está aplicada en esta BD';
  end if;
end $$;

-- ── Scaffold ───────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('f1990000-cccc-0000-0000-000000000001', 'Club Tutor Mayor', 'tutor-no-menor');

insert into public.seasons (id, club_id, label, status) values
  ('f1990000-5ea5-0000-0000-000000000001', 'f1990000-cccc-0000-0000-000000000001', '2025-26', 'active');

-- Fechas fijas, no aritmética sobre el día en que corra la suite.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f1990000-0000-aaaa-0000-00000000000a', 'f1990000-cccc-0000-0000-000000000001', 'Hermano', 'Peque',  '2016-05-10'),
  ('f1990000-0000-bbbb-0000-00000000000b', 'f1990000-cccc-0000-0000-000000000001', 'Menor',   'ConApp', '2013-01-20'),
  ('f1990000-0000-cccc-0000-00000000000c', 'f1990000-cccc-0000-0000-000000000001', 'Adulto',  'ConApp', '1995-02-03'),
  ('f1990000-0000-dddd-0000-00000000000d', 'f1990000-cccc-0000-0000-000000000001', 'Crio',    'Correo', '2014-08-08');

select pg_temp.new_test_user('f1990000-1111-1111-1111-000000000001', 'adulto-tm@ts.test',   '{}'::jsonb);
select pg_temp.new_test_user('f1990000-1111-1111-1111-000000000002', 'sinfecha-tm@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1990000-2222-2222-2222-000000000001', 'menorapp-tm@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1990000-2222-2222-2222-000000000002', 'adultapp-tm@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1990000-3333-3333-3333-000000000001', 'criocorreo-tm@ts.test', '{}'::jsonb);

-- Fechas de PERFIL: solo las que el test necesita que consten. El de «sinfecha» se
-- queda deliberadamente a NULL, que es como están hoy 9 de 9 tutores en producción.
update public.profiles set date_of_birth = '1985-04-04' where id = 'f1990000-1111-1111-1111-000000000001';
update public.profiles set date_of_birth = '2014-08-08' where id = 'f1990000-3333-3333-3333-000000000001';

-- ── T1: el caso normal. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-aaaa-0000-00000000000a', 'f1990000-1111-1111-1111-000000000001', 'parent');
  exception when others then
    raise exception 'FAIL [T1]: un adulto con fecha conocida no ha podido ser tutor (%)', sqlerrm;
  end;
end $$;

-- ── T4: la ausencia no afirma nada. Va PRONTO y no al final: si esto se rompiera,
--    el alta de todo el mundo se caería mañana, porque hoy ningún tutor tiene fecha. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-aaaa-0000-00000000000a', 'f1990000-1111-1111-1111-000000000002', 'guardian');
  exception when others then
    raise exception 'FAIL [T4]: un perfil SIN fecha de nacimiento ha sido tratado como menor (%). La ausencia no afirma nada, y hoy no la tiene ningún tutor', sqlerrm;
  end;
end $$;

-- ── T2: vía (b). Su propia fecha dice menor. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-aaaa-0000-00000000000a', 'f1990000-3333-3333-3333-000000000001', 'parent');
    raise exception 'FAIL [T2]: un perfil cuya fecha dice MENOR ha quedado como tutor';
  exception when check_violation then null;
  end;
end $$;

-- ── T6 + T3: la cuenta propia del menor sí existe (T6) y no puede ser tutor de
--    otro (T3). El orden importa: el `self` tiene que estar escrito para que la
--    vía (a) tenga algo que ver. El tutor del menor va delante porque lo exige la
--    mig 20261097000000. ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1990000-0000-bbbb-0000-00000000000b', 'f1990000-1111-1111-1111-000000000001', 'parent');
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-bbbb-0000-00000000000b', 'f1990000-2222-2222-2222-000000000001', 'self');
  exception when others then
    raise exception 'FAIL [T6]: un MENOR no ha podido ser cuenta propia de su propia ficha (%). Esta regla es sobre TUTORES, no sobre el self', sqlerrm;
  end;

  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-aaaa-0000-00000000000a', 'f1990000-2222-2222-2222-000000000001', 'parent');
    raise exception 'FAIL [T3]: la cuenta propia de un jugador MENOR ha quedado como tutor de otro';
  exception when check_violation then null;
  end;
end $$;

-- ── T5: y el mismo montaje con un jugador ADULTO pasa. Un hermano mayor que tutela
--    al pequeño es legítimo, y la vía (a) tiene que distinguirlo. ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1990000-0000-cccc-0000-00000000000c', 'f1990000-2222-2222-2222-000000000002', 'self');
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-dddd-0000-00000000000d', 'f1990000-2222-2222-2222-000000000002', 'parent');
  exception when others then
    raise exception 'FAIL [T5]: la cuenta propia de un jugador ADULTO no ha podido ser tutor de otro (%)', sqlerrm;
  end;
end $$;

-- ── T7: el UPDATE. Un `self` de menor que se convierte en `parent` es el mismo
--    daño por otra puerta, y por eso `relation` está en la lista de columnas. ──
do $$
begin
  begin
    update public.player_accounts
       set relation = 'parent'
     where player_id = 'f1990000-0000-bbbb-0000-00000000000b'
       and profile_id = 'f1990000-2222-2222-2222-000000000001';
    raise exception 'FAIL [T7]: la cuenta propia de un menor se ha convertido en tutor por un UPDATE';
  exception when check_violation then null;
  end;
end $$;

-- ── T8: EL CASO QUE NOS TRAJO AQUÍ, entero. El club pone en el campo del TUTOR la
--    dirección del propio crío; el crío acepta, da su fecha real —que es lo que hace
--    `claimInviteeAccount` ANTES de crear el vínculo— y el vínculo se rechaza. ──
do $$
begin
  -- La fecha ya está puesta arriba, igual que la escribe el flujo `new invitee`.
  if (select date_of_birth from public.profiles where id = 'f1990000-3333-3333-3333-000000000001') is null then
    raise exception 'FAIL [T8]: el montaje del test es el que falla: al crío no le consta la fecha';
  end if;
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-dddd-0000-00000000000d', 'f1990000-3333-3333-3333-000000000001', 'parent');
    raise exception 'FAIL [T8]: el crío ha quedado como tutor DE SÍ MISMO';
  exception when check_violation then null;
  end;
end $$;

-- ── T9: CONTROL NEGATIVO de las dos vías. Sin el trigger, T2 y T3 entran. Si esto
--    fallara, aquellos rechazos los produciría otra cosa. El rollback lo repone. ──
drop trigger player_accounts_tutor_mayor on public.player_accounts;

do $$
begin
  -- (b) por fecha propia
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-aaaa-0000-00000000000a', 'f1990000-3333-3333-3333-000000000001', 'parent');
  exception when others then
    raise exception 'FAIL [T9b]: sin el trigger, el perfil con fecha de menor debería entrar. Ha fallado con % — el rechazo de T2 no lo produce el trigger', sqlerrm;
  end;
  -- (a) por ser cuenta propia de un menor
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1990000-0000-dddd-0000-00000000000d', 'f1990000-2222-2222-2222-000000000001', 'parent');
  exception when others then
    raise exception 'FAIL [T9a]: sin el trigger, la cuenta propia de un menor debería entrar como tutor. Ha fallado con % — el rechazo de T3 no lo produce el trigger', sqlerrm;
  end;
end $$;

rollback;
