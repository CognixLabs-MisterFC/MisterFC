-- Punto 7 (camino B) — una cuenta propia de menor no existe sin tutor.
--
-- QUÉ SE PROTEGE. Antes de la mig 20261097000000, `player_accounts` no tenía ni un
-- trigger y su policy de escritura es `cmd=*` para admin_club, director y
-- coordinador del equipo. Un `INSERT … relation='self'` a pelo dejaba al menor con
-- cuenta y sin nadie detrás — medido contra producción con BEGIN…ROLLBACK.
--
-- La regla tiene DOS mitades y aquí se prueban las dos: el `self` de un MENOR no
-- ENTRA sin tutor, y el último tutor no SALE mientras el menor tenga cuenta propia.
-- Un candado que solo vale al entrar no es un invariante.
--
-- Y manda SOLO sobre el menor. `relation='self'` significa dos cosas: el jugador
-- ADULTO vinculado a su propia ficha (mig 20261038) y la cuenta propia del menor
-- (MN-5). El adulto nunca necesitó tutor — T12 y T13 lo fijan, porque la primera
-- versión de esta migración se lo prohibía y lo cazó la suite entera.
--
-- Invariantes:
--   T0.  El trigger existe (si no, la migración está sin aplicar y el resto miente).
--   T1.  Tutor primero, cuenta propia después ⇒ PASA (el camino bueno, intacto).
--   T2.  Cuenta propia sin ningún tutor ⇒ RECHAZA.
--   T3.  Vincular un tutor a un jugador pelado ⇒ PASA (la regla no toca a los tutores).
--   T4.  Con dos tutores, retirar uno ⇒ PASA.
--   T5.  Retirar al ÚLTIMO tutor habiendo cuenta propia ⇒ RECHAZA.
--   T6.  Retirar al último tutor SIN cuenta propia ⇒ PASA (no hay nada que proteger).
--   T7.  Convertir en 'self' la fila del único tutor ⇒ RECHAZA (no se cuenta a sí misma).
--   T8.  Mover a otro jugador la fila del único tutor ⇒ RECHAZA.
--   T9.  BORRADO DE CUENTA: con `profiles.deleted_at` puesto, el DELETE PASA.
--   T10. El trigger ve al tutor aunque quien escribe sea el MENOR (SECURITY DEFINER).
--   T11. CONTROL NEGATIVO de las dos mitades: sin el trigger, lo de T2 y lo de T5
--        pasan. Si este bloque falla, aquellos rechazos no los producía el trigger.
--   T12. Jugador ADULTO con cuenta propia y SIN tutor ⇒ PASA (no es asunto de esta regla).
--   T13. Retirar al único tutor de un ADULTO con cuenta propia ⇒ PASA (cumplió 18).
\ir helpers/auth_users.sql

begin;

-- ── T0: sin trigger, el resto de este fichero no prueba nada. ──
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.player_accounts'::regclass
       and tgname = 'player_accounts_self_con_tutor'
       and not tgisinternal
  ) then
    raise exception 'FAIL [T0]: falta el trigger player_accounts_self_con_tutor — la migración 20261097000000 no está aplicada en esta BD';
  end if;
end $$;

-- ── Scaffold ───────────────────────────────────────────────────────────────
-- JUGADOR A: el del caso completo (tutores + cuenta propia).
-- JUGADOR B: pelado, sin ningún vínculo. Es contra el que se prueban los rechazos.
insert into public.clubs (id, name, slug) values
  ('f1970000-cccc-0000-0000-000000000001', 'Club Punto 7', 'punto-7-self-sin-tutor');

insert into public.seasons (id, club_id, label, status) values
  ('f1970000-5ea5-0000-0000-000000000001', 'f1970000-cccc-0000-0000-000000000001', '2025-26', 'active');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f1970000-0000-aaaa-0000-00000000000a', 'f1970000-cccc-0000-0000-000000000001', 'Menor', 'ConTutor', '2014-03-01'),
  ('f1970000-0000-bbbb-0000-00000000000b', 'f1970000-cccc-0000-0000-000000000001', 'Menor', 'Pelado',   '2015-06-02'),
  -- El ADULTO. Fecha fija y muy anterior a 18 años: nada de aritmética que dependa
  -- del calendario del día en que corra la suite.
  ('f1970000-0000-cccc-0000-00000000000c', 'f1970000-cccc-0000-0000-000000000001', 'Adulto', 'ConFicha', '1995-02-03');

select pg_temp.new_test_user('f1970000-1111-1111-1111-000000000001', 'tutor1-p7@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1970000-1111-1111-1111-000000000002', 'tutor2-p7@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1970000-2222-2222-2222-000000000001', 'menor-a-p7@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1970000-2222-2222-2222-000000000002', 'menor-b-p7@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('f1970000-3333-3333-3333-000000000001', 'adulto-p7@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1970000-115e-0000-0000-000000000001', 'f1970000-1111-1111-1111-000000000001', 'f1970000-cccc-0000-0000-000000000001', 'jugador'),
  ('f1970000-115e-0000-0000-000000000002', 'f1970000-1111-1111-1111-000000000002', 'f1970000-cccc-0000-0000-000000000001', 'jugador'),
  ('f1970000-115e-0000-0000-000000000003', 'f1970000-2222-2222-2222-000000000001', 'f1970000-cccc-0000-0000-000000000001', 'jugador'),
  ('f1970000-115e-0000-0000-000000000004', 'f1970000-2222-2222-2222-000000000002', 'f1970000-cccc-0000-0000-000000000001', 'jugador'),
  ('f1970000-115e-0000-0000-000000000005', 'f1970000-3333-3333-3333-000000000001', 'f1970000-cccc-0000-0000-000000000001', 'jugador');

-- ── T3 primero, porque es el que construye el escenario: vincular un tutor a un
--    jugador que no tiene nada NO lo toca la regla. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1970000-0000-aaaa-0000-00000000000a', 'f1970000-1111-1111-1111-000000000001', 'parent');
  exception when others then
    raise exception 'FAIL [T3]: vincular un TUTOR a un jugador sin vínculos debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T1: con el tutor ya puesto, la cuenta propia entra. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1970000-0000-aaaa-0000-00000000000a', 'f1970000-2222-2222-2222-000000000001', 'self');
  exception when others then
    raise exception 'FAIL [T1]: el camino bueno (tutor → cuenta propia) debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T2: el camino B medido en producción. Jugador B no tiene tutor. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1970000-0000-bbbb-0000-00000000000b', 'f1970000-2222-2222-2222-000000000002', 'self');
    raise exception 'FAIL [T2]: se ha creado una cuenta propia SIN TUTOR; el trigger no la ha parado';
  exception when check_violation then null;
  end;
end $$;

-- ── T4: con dos tutores, retirar uno no deja solo a nadie. ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1970000-0000-aaaa-0000-00000000000a', 'f1970000-1111-1111-1111-000000000002', 'guardian');
  begin
    delete from public.player_accounts
     where player_id = 'f1970000-0000-aaaa-0000-00000000000a'
       and profile_id = 'f1970000-1111-1111-1111-000000000002';
  exception when others then
    raise exception 'FAIL [T4]: retirar UNO de DOS tutores debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T5: la otra mitad de la regla. Queda un solo tutor y una cuenta propia. ──
do $$
begin
  begin
    delete from public.player_accounts
     where player_id = 'f1970000-0000-aaaa-0000-00000000000a'
       and profile_id = 'f1970000-1111-1111-1111-000000000001';
    raise exception 'FAIL [T5]: se ha retirado al ÚLTIMO tutor de un jugador con cuenta propia';
  exception when check_violation then null;
  end;
end $$;

-- ── T6: sin cuenta propia detrás, el último tutor sale sin problema. El jugador B
--    tiene tutor desde aquí y ninguna cuenta propia (T2 no llegó a escribir). ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1970000-0000-bbbb-0000-00000000000b', 'f1970000-1111-1111-1111-000000000002', 'parent');
  begin
    delete from public.player_accounts
     where player_id = 'f1970000-0000-bbbb-0000-00000000000b'
       and profile_id = 'f1970000-1111-1111-1111-000000000002';
  exception when others then
    raise exception 'FAIL [T6]: retirar al último tutor de un jugador SIN cuenta propia debería pasar, y ha fallado con %', sqlerrm;
  end;
end $$;

-- ── T7: el UPDATE que se cuenta a sí mismo. La fila del único tutor de A pasa a
--    'self': si el trigger no se excluyera, se vería a sí misma como tutor y
--    dejaría pasar un jugador con dos 'self' y cero tutores. ──
do $$
begin
  begin
    update public.player_accounts
       set relation = 'self'
     where player_id = 'f1970000-0000-aaaa-0000-00000000000a'
       and profile_id = 'f1970000-1111-1111-1111-000000000001';
    raise exception 'FAIL [T7]: el único tutor se ha convertido en cuenta propia; el trigger se ha contado a sí mismo';
  exception when check_violation then null;
  end;
end $$;

-- ── T8: mover la fila del único tutor a OTRO jugador deja al primero solo. Es el
--    mismo daño que un DELETE, por una puerta distinta. ──
do $$
begin
  begin
    update public.player_accounts
       set player_id = 'f1970000-0000-bbbb-0000-00000000000b'
     where player_id = 'f1970000-0000-aaaa-0000-00000000000a'
       and profile_id = 'f1970000-1111-1111-1111-000000000001';
    raise exception 'FAIL [T8]: se ha movido al único tutor a otro jugador, dejando al primero con cuenta propia y sin tutor';
  exception when check_violation then null;
  end;
end $$;

-- ── T9: LA EXCEPCIÓN. `finalize_account_deletion` pone profiles.deleted_at en su
--    paso 5.1 y borra los vínculos en el 5.4, misma transacción. Sin esta salida,
--    un tutor con un hijo con cuenta propia no podría borrar su cuenta (Apple
--    5.1.1 v, serie BC). Se simula el orden real: marca primero, borrado después. ──
do $$
begin
  update public.profiles set deleted_at = now()
   where id = 'f1970000-1111-1111-1111-000000000001';
  begin
    delete from public.player_accounts
     where profile_id = 'f1970000-1111-1111-1111-000000000001';
  exception when others then
    raise exception 'FAIL [T9]: el borrado de cuenta no ha podido retirar el vínculo; la anonimización quedaría bloqueada (%)', sqlerrm;
  end;
  -- Y el menor se queda, efectivamente, sin tutor. Se afirma a propósito: es la
  -- consecuencia conocida de la excepción, no un descuido. La decisión de producto
  -- sobre qué hacer con esa cuenta está sin tomar.
  if exists (
    select 1 from public.player_accounts
     where player_id = 'f1970000-0000-aaaa-0000-00000000000a'
       and relation in ('parent', 'guardian')
  ) then
    raise exception 'FAIL [T9]: se esperaba que el jugador quedara sin tutor tras el borrado de cuenta';
  end if;
  update public.profiles set deleted_at = null
   where id = 'f1970000-1111-1111-1111-000000000001';
end $$;

-- ── T10: SECURITY DEFINER, y que no es adorno. La RLS de `player_accounts` solo
--    deja ver a cada cual SUS filas: el menor no ve la de su tutor. Un trigger
--    INVOKER concluiría «no hay tutor» y negaría el caso bueno. Se escribe con la
--    sesión del menor, por su propia policy (`player_accounts_insert_invitee`),
--    que exige una invitación viva a su nombre. ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1970000-0000-bbbb-0000-00000000000b', 'f1970000-1111-1111-1111-000000000001', 'parent');
  insert into public.invitations (email, club_id, role, player_id, player_relation, created_by) values
    ('menor-b-p7@ts.test', 'f1970000-cccc-0000-0000-000000000001', 'jugador',
     'f1970000-0000-bbbb-0000-00000000000b', 'self', 'f1970000-1111-1111-1111-000000000001');
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"f1970000-2222-2222-2222-000000000002","role":"authenticated"}';

do $$
begin
  -- Anclaje POSITIVO primero: el menor NO ve la fila de su tutor. Sin esto, el
  -- INSERT de abajo podría pasar por un motivo que no es el que se quiere probar.
  if exists (
    select 1 from public.player_accounts
     where player_id = 'f1970000-0000-bbbb-0000-00000000000b'
       and relation = 'parent'
  ) then
    raise exception 'FAIL [T10]: el menor VE la fila de su tutor; este test ya no prueba que el trigger necesite SECURITY DEFINER';
  end if;
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1970000-0000-bbbb-0000-00000000000b', 'f1970000-2222-2222-2222-000000000002', 'self');
  exception when others then
    raise exception 'FAIL [T10]: el menor no ha podido crear su cuenta propia teniendo tutor; el trigger no está viendo al tutor (%)', sqlerrm;
  end;
end $$;

reset role;

-- ── T12: EL CASO QUE ESTA MIGRACIÓN NO DEBE TOCAR. Un jugador mayor de edad
--    vinculado a su propia ficha: es para lo que la mig 20261038 creó `self`, nunca
--    tuvo tutor y no tiene por qué tenerlo. La primera versión de este trigger se lo
--    prohibía; lo cazaron 20 ficheros de la suite. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1970000-0000-cccc-0000-00000000000c', 'f1970000-3333-3333-3333-000000000001', 'self');
  exception when others then
    raise exception 'FAIL [T12]: un jugador ADULTO no puede vincularse a su propia ficha sin tutor (%). La regla se ha pasado de ancha', sqlerrm;
  end;
end $$;

-- ── T13: y su tutor, si lo tuviera, puede retirarse. Es lo que pasa solo el día del
--    18º cumpleaños: `player_is_minor` se calcula en vivo, sin trigger ni cron. ──
do $$
begin
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('f1970000-0000-cccc-0000-00000000000c', 'f1970000-1111-1111-1111-000000000002', 'parent');
  begin
    delete from public.player_accounts
     where player_id = 'f1970000-0000-cccc-0000-00000000000c'
       and profile_id = 'f1970000-1111-1111-1111-000000000002';
  exception when others then
    raise exception 'FAIL [T13]: retirar al tutor de un jugador ADULTO con cuenta propia debería pasar (%)', sqlerrm;
  end;
end $$;

-- ── T11: CONTROL NEGATIVO, las DOS mitades. Se quita el trigger y se repite lo
--    que T2 y T5 rechazaron. Si algo de esto fallara, aquellos rechazos los estaría
--    produciendo otra cosa —una FK, un CHECK, la RLS— y este fichero no probaría lo
--    que dice probar. Va al final y dentro del mismo BEGIN: el rollback lo repone. ──
drop trigger player_accounts_self_con_tutor on public.player_accounts;

do $$
begin
  -- (a) ENTRAR. El jugador A se quedó sin tutores en T9.
  begin
    insert into public.player_accounts (player_id, profile_id, relation) values
      ('f1970000-0000-aaaa-0000-00000000000a', 'f1970000-1111-1111-1111-000000000002', 'self');
  exception when others then
    raise exception 'FAIL [T11a]: sin el trigger, la cuenta propia sin tutor debería entrar. Ha fallado con % — el rechazo de T2 no lo produce el trigger', sqlerrm;
  end;

  -- (b) SALIR. El jugador B tiene un único tutor y una cuenta propia (T10).
  begin
    delete from public.player_accounts
     where player_id = 'f1970000-0000-bbbb-0000-00000000000b'
       and profile_id = 'f1970000-1111-1111-1111-000000000001';
  exception when others then
    raise exception 'FAIL [T11b]: sin el trigger, retirar al último tutor debería pasar. Ha fallado con % — el rechazo de T5 no lo produce el trigger', sqlerrm;
  end;
end $$;

rollback;
