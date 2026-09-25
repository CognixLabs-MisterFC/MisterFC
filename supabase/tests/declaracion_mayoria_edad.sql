-- D-2 — la DECLARACIÓN de mayoría de edad del tutor, pegada al vínculo.
--
-- QUÉ SE PROTEGE. La pantalla de aceptar dejó de pedirle al tutor su fecha de
-- nacimiento (#722): nadie pone su edad en un formulario de alta, y lo que llegó a
-- producción fue `2020-01-01` —un relleno— que hacía que el trigger de la mig
-- 20261099000000 rechazara el alta. En su lugar hay una casilla. Una casilla que no
-- se guarda en ninguna parte no es una declaración, así que aquí queda: con su fecha
-- y hora, en la fila del vínculo.
--
-- Y lo que de verdad hay que vigilar no es que se pueda escribir —eso lo vería
-- cualquiera—, sino que NO SE PUEDA REESCRIBIR. Una prueba que el servidor puede
-- cambiar a posteriori no prueba nada.
--
-- Invariantes:
--   T0. La columna existe, es timestamptz y admite NULL (si no, el resto miente).
--   T1. El trigger y el CHECK existen.
--   T2. Un vínculo nace SIN declaración: la columna no la inventa por defecto.
--   T3. Se puede anotar (NULL → valor) y queda escrita.
--   T4. Una vez anotada, NO se puede cambiar por otra fecha.
--   T5. Ni vaciar. Ni con el rol dueño de la base.
--   T6. Escribir el MISMO valor otra vez SÍ pasa: un reintento no es reescribir.
--   T7. Se puede insertar ya anotada, para el día que lo haga la propia RPC.
--   T8. En un `self` no cabe: ni al insertar ni al actualizar.
--   T9. Un UPDATE que no la toca sigue funcionando (parent → guardian).
--   T11. La función del trigger no la puede ejecutar nadie por su nombre.
--   T10. CONTROL NEGATIVO: sin el trigger, lo de T4 y T5 pasa.
\ir helpers/auth_users.sql

begin;

-- ── T0 ──
do $$
declare
  v_tipo text;
  v_notnull boolean;
begin
  select data_type, is_nullable = 'NO'
    into v_tipo, v_notnull
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'player_accounts'
     and column_name = 'adult_declared_at';

  if v_tipo is null then
    raise exception 'FAIL [T0]: no existe player_accounts.adult_declared_at — la migración 20261109000000 no está aplicada en esta BD, y todo lo que sigue no comprueba nada';
  end if;
  if v_tipo <> 'timestamp with time zone' then
    raise exception 'FAIL [T0]: adult_declared_at es % y tiene que ser timestamptz: una declaración sin hora no sirve de prueba', v_tipo;
  end if;
  if v_notnull then
    raise exception 'FAIL [T0]: adult_declared_at es NOT NULL. Tiene que admitir NULL: los vínculos anteriores a #722 no declararon nada y NULL es «no consta»';
  end if;
end $$;

-- ── T1 ──
do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.player_accounts'::regclass
       and tgname = 'player_accounts_declaracion_inmutable'
       and not tgisinternal
  ) then
    raise exception 'FAIL [T1]: falta el trigger player_accounts_declaracion_inmutable — sin él la declaración se puede reescribir y deja de ser una prueba';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.player_accounts'::regclass
       and conname = 'player_accounts_declaracion_solo_tutor'
  ) then
    raise exception 'FAIL [T1]: falta el CHECK player_accounts_declaracion_solo_tutor';
  end if;
end $$;

-- ── Scaffold ───────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('d2900000-cccc-0000-0000-000000000001', 'Club Declaracion', 'declaracion-mayoria');

insert into public.seasons (id, club_id, label, status) values
  ('d2900000-5ea5-0000-0000-000000000001', 'd2900000-cccc-0000-0000-000000000001', '2025-26', 'active');

-- Fechas fijas, no aritmética sobre el día en que corra la suite.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('d2900000-0000-aaaa-0000-00000000000a', 'd2900000-cccc-0000-0000-000000000001', 'Peque',  'Uno', '2016-05-10'),
  ('d2900000-0000-bbbb-0000-00000000000b', 'd2900000-cccc-0000-0000-000000000001', 'Menor',  'Dos', '2013-01-20');

select pg_temp.new_test_user('d2900000-1111-0000-0000-000000000001', 'tutor1-d2@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('d2900000-1111-0000-0000-000000000002', 'tutor2-d2@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('d2900000-2222-0000-0000-000000000001', 'menorapp-d2@ts.test', '{}'::jsonb);

-- ── T2: el vínculo nace sin declaración. ──
insert into public.player_accounts (player_id, profile_id, relation) values
  ('d2900000-0000-aaaa-0000-00000000000a', 'd2900000-1111-0000-0000-000000000001', 'parent');

do $$
begin
  if (select adult_declared_at from public.player_accounts
       where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
         and profile_id = 'd2900000-1111-0000-0000-000000000001') is not null then
    raise exception 'FAIL [T2]: el vínculo ha nacido con una declaración que nadie hizo. NULL es «no consta», y un DEFAULT aquí sería inventar una prueba';
  end if;
end $$;

-- ── T3: se anota, y queda. ──
do $$
declare v_cuando timestamptz;
begin
  update public.player_accounts
     set adult_declared_at = '2026-09-26 10:00:00+00'
   where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
     and profile_id = 'd2900000-1111-0000-0000-000000000001';

  select adult_declared_at into v_cuando
    from public.player_accounts
   where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
     and profile_id = 'd2900000-1111-0000-0000-000000000001';

  if v_cuando is distinct from '2026-09-26 10:00:00+00'::timestamptz then
    raise exception 'FAIL [T3]: la declaración no se ha guardado (quedó %)', v_cuando;
  end if;
end $$;

-- ── T4: no se cambia. ──
do $$
begin
  begin
    update public.player_accounts
       set adult_declared_at = '2020-01-01 00:00:00+00'
     where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
       and profile_id = 'd2900000-1111-0000-0000-000000000001';
    raise exception 'FAIL [T4]: se ha podido CAMBIAR una declaración ya hecha. Una prueba que se reescribe no es una prueba';
  exception when check_violation then null;
  end;
end $$;

-- ── T5: no se borra. Y esto corre con el rol dueño de la BD, que es el más
--    poderoso que puede tocar esta tabla: si aquí no se puede, no se puede. ──
do $$
begin
  begin
    update public.player_accounts
       set adult_declared_at = null
     where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
       and profile_id = 'd2900000-1111-0000-0000-000000000001';
    raise exception 'FAIL [T5]: se ha podido VACIAR una declaración ya hecha';
  exception when check_violation then null;
  end;
end $$;

-- ── T6: el mismo valor otra vez pasa. El alta puede reintentarse. ──
do $$
begin
  begin
    update public.player_accounts
       set adult_declared_at = '2026-09-26 10:00:00+00'
     where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
       and profile_id = 'd2900000-1111-0000-0000-000000000001';
  exception when others then
    raise exception 'FAIL [T6]: escribir el MISMO valor ha fallado (%). Un reintento idempotente no es reescribir la historia', sqlerrm;
  end;
end $$;

-- ── T7: se puede insertar ya anotada. Hoy la web la escribe justo después de
--    aceptar; si algún día lo hace la propia RPC en el INSERT, tiene que caber. ──
do $$
begin
  begin
    insert into public.player_accounts (player_id, profile_id, relation, adult_declared_at) values
      ('d2900000-0000-aaaa-0000-00000000000a', 'd2900000-1111-0000-0000-000000000002',
       'guardian', '2026-09-26 11:00:00+00');
  exception when others then
    raise exception 'FAIL [T7]: no se ha podido crear un vínculo ya declarado (%)', sqlerrm;
  end;
end $$;

-- ── T8: en un `self` no cabe. El tutor va DELANTE porque lo exige la mig
--    20261097000000 (un self no nace sin tutor). ──
insert into public.player_accounts (player_id, profile_id, relation) values
  ('d2900000-0000-bbbb-0000-00000000000b', 'd2900000-1111-0000-0000-000000000001', 'parent');

do $$
begin
  -- al insertar
  begin
    insert into public.player_accounts (player_id, profile_id, relation, adult_declared_at) values
      ('d2900000-0000-bbbb-0000-00000000000b', 'd2900000-2222-0000-0000-000000000001',
       'self', '2026-09-26 12:00:00+00');
    raise exception 'FAIL [T8i]: una cuenta propia ha podido llevar declaración de mayoría de edad. En un self no quiere decir nada: es el propio jugador, y puede ser menor';
  exception when check_violation then null;
  end;

  -- y al actualizar
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('d2900000-0000-bbbb-0000-00000000000b', 'd2900000-2222-0000-0000-000000000001', 'self');
  begin
    update public.player_accounts
       set adult_declared_at = '2026-09-26 12:00:00+00'
     where player_id = 'd2900000-0000-bbbb-0000-00000000000b'
       and profile_id = 'd2900000-2222-0000-0000-000000000001';
    raise exception 'FAIL [T8u]: se ha podido anotar una declaración sobre una cuenta propia';
  exception when check_violation then null;
  end;
end $$;

-- ── T9: el trigger no estorba a lo que no le toca. ──
do $$
begin
  begin
    update public.player_accounts
       set relation = 'guardian'
     where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
       and profile_id = 'd2900000-1111-0000-0000-000000000001';
  exception when others then
    raise exception 'FAIL [T9]: un UPDATE que NO toca la declaración ha fallado (%). El trigger solo debe despertarse con su columna en el SET', sqlerrm;
  end;
end $$;

-- ── T11: la función del trigger, cerrada por su nombre. Una función nueva nace con
--    la ACL por defecto, donde PUBLIC tiene EXECUTE, así que `anon` puede llamarla sin
--    que nadie la conceda. Nadie la necesita: la despierta el trigger, y un trigger no
--    comprueba el EXECUTE de quien hizo el UPDATE.
--
--    Esto lo caza también el bloque [1] de `anon_execute_cerrado` —de hecho lo cazó—,
--    pero ese bloque es una lista global que se puede relajar. Aquí va nominal, por la
--    misma razón que su bloque [2] existe. Con has_function_privilege, nunca provocando
--    el 42501: un 42501 tumba la BD efímera del CI.
do $$
declare
  v_rol text;
begin
  for v_rol in select unnest(array['anon', 'authenticated']) loop
    if has_function_privilege(
         v_rol, 'public.player_accounts_declaracion_inmutable()', 'execute') then
      raise exception 'FAIL [T11]: % puede ejecutar player_accounts_declaracion_inmutable() por su nombre. Falta el revoke (hacen falta los dos: PUBLIC y el rol; son entradas distintas)', v_rol;
    end if;
  end loop;
end $$;

-- ── T10: CONTROL NEGATIVO. Sin el trigger, T4 y T5 entran. Si esto fallara, esos
--    dos rechazos los produciría otra cosa y el trigger no estaría probado. El
--    rollback lo repone. ──
drop trigger player_accounts_declaracion_inmutable on public.player_accounts;

do $$
begin
  -- cambiarla
  begin
    update public.player_accounts
       set adult_declared_at = '2020-01-01 00:00:00+00'
     where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
       and profile_id = 'd2900000-1111-0000-0000-000000000001';
  exception when others then
    raise exception 'FAIL [T10a]: sin el trigger, cambiar la declaración debería pasar. Ha fallado con % — el rechazo de T4 no lo produce el trigger', sqlerrm;
  end;
  -- vaciarla
  begin
    update public.player_accounts
       set adult_declared_at = null
     where player_id = 'd2900000-0000-aaaa-0000-00000000000a'
       and profile_id = 'd2900000-1111-0000-0000-000000000001';
  exception when others then
    raise exception 'FAIL [T10b]: sin el trigger, vaciar la declaración debería pasar. Ha fallado con % — el rechazo de T5 no lo produce el trigger', sqlerrm;
  end;
end $$;

rollback;
