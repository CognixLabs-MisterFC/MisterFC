-- El tutor retira la cuenta propia de su hijo (migracion 20261100000000).
--
-- LA REGLA: el tutor puede retirar la cuenta propia del hijo igual que puede
-- crearsela. Cumplidos los 18, la cuenta es suya y el tutor no la toca.
--
-- Cubre:
--   [T0]  La funcion existe (si no, la migracion esta sin aplicar y el resto miente).
--   [T1]  EL CONTROL, primera mitad: el DELETE directo del tutor afecta 0 filas y no
--         da error. Por eso hace falta una RPC y no una policy: hoy le sale MUDO.
--   [T2]  El tutor retira la cuenta: devuelve 'account' y la fila 'self' desaparece.
--   [T3]  LO QUE NO SE TOCA (decision de Jose): el nino sigue siendo jugador del club,
--         con su ficha y su equipo. players y team_members, intactos.
--   [T4]  Lo que SI cae: la membresia de ESE perfil en ESE club, que es el acceso a
--         la app. Sin esto, «retirar la cuenta» no retira nada: medido en produccion,
--         el menor seguia viendo 45 jugadores, 22 eventos y 6 equipos.
--   [T5]  Idempotente: la segunda llamada devuelve 'none' y no revienta.
--   [T6]  La invitacion VIVA tambien se retira ('invitation'). Si no, el tutor retira
--         hoy y el crio entra manana con el enlace que seguia vivo.
--   [T7]  Una invitacion CADUCADA no se toca: no puede volverse cuenta, y es historia.
--   [T8]  LOS 18: jugador_mayor_de_edad, y su fila sigue donde estaba.
--   [T9]  Un tercero: forbidden.
--   [T10] El PROPIO jugador no se retira a si mismo: forbidden. Para irse del todo
--         tiene su propio derecho y su propio camino, que es el borrado de cuenta.
--   [T11] Sin sesion: no_session.
--   [T12] La membresia NO se cierra si al perfil le queda otra razon de estar en el
--         club (aqui: es seguidor de un hermano). Hay UNA por (perfil, club).
--   [T13] EL CONTROL, segunda mitad: el mismo DELETE, como admin del club, SI borra.
--         Sin esta ancla positiva, el 0 de [T1] podria ser que la fila no existiera.
--   [T14] CANDADO ACL: anon NO ejecuta; authenticated si.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Los privilegios se comprueban con has_function_privilege, NUNCA provocando
-- el 42501 (leccion de BC-1: eso tumbaba el backend del CI).
--
-- UNA TRAMPA QUE ESTE FICHERO PISO Y AQUI QUEDA DICHA: las aserciones LEEN con el rol
-- de la sesion. Comprobar «la fila self ya no esta» con la sesion del TUTOR pasa
-- siempre, porque `player_accounts_select_self_or_staff` se la oculta de todos modos
-- (MN-9). Una ausencia leida por quien no podria verla no afirma nada. Por eso: la
-- RPC se llama con la sesion del usuario, y TODA comprobacion de estado se hace
-- despues de `reset role`.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── T0 ───────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.revoke_player_self_account(uuid)') is null then
    raise exception 'FAIL [T0]: falta revoke_player_self_account — la migracion 20261100000000 no esta aplicada en esta BD';
  end if;
end $$;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('4e700000-0000-4000-8000-000000000001', 'Club Retiro', 'club-retiro');

insert into public.seasons (id, club_id, label, status) values
  ('4e7c0000-0000-4000-8000-000000000001', '4e700000-0000-4000-8000-000000000001', '2026-27', 'active');

insert into public.categories (id, club_id, name) values
  ('4e7d0000-0000-4000-8000-000000000001', '4e700000-0000-4000-8000-000000000001', 'Cat Retiro');

insert into public.teams (id, category_id, name, format, color, season) values
  ('4e7e0000-0000-4000-8000-000000000001', '4e7d0000-0000-4000-8000-000000000001', 'Equipo Retiro', 'F7', '#10B981', '2026-27');

-- t = tutor de todos · m = la cuenta propia de p1 · x = un tercero · s = admin del
-- club · a = la cuenta propia de p4, que YA es mayor de edad · m2 = la cuenta propia
-- de p5, que ademas sigue a su hermano p6.
select pg_temp.new_test_user('4e7a0000-0000-4000-8000-000000000001', 't@retiro.test',  '{}'::jsonb);
select pg_temp.new_test_user('4e7a0000-0000-4000-8000-000000000002', 'm@retiro.test',  '{}'::jsonb);
select pg_temp.new_test_user('4e7a0000-0000-4000-8000-000000000003', 'x@retiro.test',  '{}'::jsonb);
select pg_temp.new_test_user('4e7a0000-0000-4000-8000-000000000004', 's@retiro.test',  '{}'::jsonb);
select pg_temp.new_test_user('4e7a0000-0000-4000-8000-000000000005', 'a@retiro.test',  '{}'::jsonb);
select pg_temp.new_test_user('4e7a0000-0000-4000-8000-000000000006', 'm2@retiro.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('4e7a0000-0000-4000-8000-000000000001', '4e700000-0000-4000-8000-000000000001', 'jugador'),
  ('4e7a0000-0000-4000-8000-000000000002', '4e700000-0000-4000-8000-000000000001', 'jugador'),
  ('4e7a0000-0000-4000-8000-000000000003', '4e700000-0000-4000-8000-000000000001', 'jugador'),
  ('4e7a0000-0000-4000-8000-000000000004', '4e700000-0000-4000-8000-000000000001', 'admin_club'),
  ('4e7a0000-0000-4000-8000-000000000005', '4e700000-0000-4000-8000-000000000001', 'jugador'),
  ('4e7a0000-0000-4000-8000-000000000006', '4e700000-0000-4000-8000-000000000001', 'jugador');

-- Fechas FIJAS, no aritmetica sobre el dia en que corra la suite. p4 nacio en 2000:
-- mayor de edad hoy y dentro de veinte anos.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('4e7b0000-0000-4000-8000-000000000001', '4e700000-0000-4000-8000-000000000001', 'Uno',   'Retiro', '2014-03-03'),
  ('4e7b0000-0000-4000-8000-000000000002', '4e700000-0000-4000-8000-000000000001', 'Dos',   'Retiro', '2014-03-03'),
  ('4e7b0000-0000-4000-8000-000000000003', '4e700000-0000-4000-8000-000000000001', 'Tres',  'Retiro', '2014-03-03'),
  ('4e7b0000-0000-4000-8000-000000000004', '4e700000-0000-4000-8000-000000000001', 'Cuatro','Retiro', '2000-01-01'),
  ('4e7b0000-0000-4000-8000-000000000005', '4e700000-0000-4000-8000-000000000001', 'Cinco', 'Retiro', '2014-03-03'),
  ('4e7b0000-0000-4000-8000-000000000006', '4e700000-0000-4000-8000-000000000001', 'Seis',  'Retiro', '2014-03-03');

insert into public.team_members (player_id, team_id) values
  ('4e7b0000-0000-4000-8000-000000000001', '4e7e0000-0000-4000-8000-000000000001');

-- El tutor va PRIMERO en la lista: desde la 20261097000000 un 'self' de menor no
-- nace sin tutor, y dentro de un mismo INSERT cada fila solo ve las anteriores.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('4e7b0000-0000-4000-8000-000000000001', '4e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('4e7b0000-0000-4000-8000-000000000002', '4e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('4e7b0000-0000-4000-8000-000000000003', '4e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('4e7b0000-0000-4000-8000-000000000004', '4e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('4e7b0000-0000-4000-8000-000000000005', '4e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('4e7b0000-0000-4000-8000-000000000006', '4e7a0000-0000-4000-8000-000000000001', 'parent'),
  ('4e7b0000-0000-4000-8000-000000000001', '4e7a0000-0000-4000-8000-000000000002', 'self'),
  ('4e7b0000-0000-4000-8000-000000000004', '4e7a0000-0000-4000-8000-000000000005', 'self'),
  ('4e7b0000-0000-4000-8000-000000000005', '4e7a0000-0000-4000-8000-000000000006', 'self');

-- La otra razon de m2 para estar en el club: sigue a su hermano p6 (caso [T12]).
insert into public.player_spectators (player_id, spectator_profile_id) values
  ('4e7b0000-0000-4000-8000-000000000006', '4e7a0000-0000-4000-8000-000000000006');

-- p2 con invitacion VIVA; p3 con invitacion CADUCADA.
insert into public.invitations (email, club_id, role, player_id, player_relation, created_by, expires_at) values
  ('hijo2@retiro.test', '4e700000-0000-4000-8000-000000000001', 'jugador',
   '4e7b0000-0000-4000-8000-000000000002', 'self', '4e7a0000-0000-4000-8000-000000000001', now() + interval '7 days'),
  ('hijo3@retiro.test', '4e700000-0000-4000-8000-000000000001', 'jugador',
   '4e7b0000-0000-4000-8000-000000000003', 'self', '4e7a0000-0000-4000-8000-000000000001', now() - interval '1 day');

-- ─────────────────────────────────────────────────────────────────────────────
-- [T1] EL CONTROL, primera mitad. Antes de tocar nada: el tutor NO puede borrar la
--      fila por su cuenta, y —lo que lo hace caro— no se entera de que no puede.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare v_filas integer;
begin
  with b as (
    delete from public.player_accounts
     where player_id = '4e7b0000-0000-4000-8000-000000000001' and relation = 'self'
    returning 1
  ) select count(*) into v_filas from b;

  if v_filas <> 0 then
    raise exception 'FAIL [T1]: el tutor ha borrado la fila self por RLS (% filas). La RPC sobra o la policy se abrio', v_filas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T2] La RPC si. Devuelve 'account' y la fila desaparece.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000001');
  if v is distinct from 'account' then
    raise exception 'FAIL [T2]: esperaba account, dio: %', v;
  end if;
end $$;

reset role;
do $$
begin
  if exists (
    select 1 from public.player_accounts
     where player_id = '4e7b0000-0000-4000-8000-000000000001' and relation = 'self'
  ) then
    raise exception 'FAIL [T2]: la cuenta propia sigue ahi despues de retirarla';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T3] EL NINO SIGUE SIENDO JUGADOR DEL CLUB. Decision de Jose, literal: «con su
--      ficha, su equipo y sus convocatorias: solo pierde el acceso a la app».
--      Si algun dia alguien "limpia" esto de paso, se pone rojo aqui.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select p.left_club_at, p.erased_at into r
    from public.players p where p.id = '4e7b0000-0000-4000-8000-000000000001';
  if r.left_club_at is not null or r.erased_at is not null then
    raise exception 'FAIL [T3]: retirar la cuenta ha dado de baja al JUGADOR (left_club_at=%, erased_at=%)', r.left_club_at, r.erased_at;
  end if;

  if not exists (
    select 1 from public.team_members tm
     where tm.player_id = '4e7b0000-0000-4000-8000-000000000001'
       and tm.team_id   = '4e7e0000-0000-4000-8000-000000000001'
       and tm.left_at is null
  ) then
    raise exception 'FAIL [T3]: retirar la cuenta ha sacado al jugador de su equipo';
  end if;

  -- Y el tutor sigue siendo tutor: lo retirado es la cuenta del hijo, no el vinculo.
  if not exists (
    select 1 from public.player_accounts
     where player_id = '4e7b0000-0000-4000-8000-000000000001'
       and profile_id = '4e7a0000-0000-4000-8000-000000000001'
       and relation = 'parent'
  ) then
    raise exception 'FAIL [T3]: se ha llevado por delante el vinculo del tutor';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T4] Lo que SI cae: el acceso a la app de ESE perfil.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select m.left_at, m.left_reason into r
    from public.memberships m
   where m.profile_id = '4e7a0000-0000-4000-8000-000000000002'
     and m.club_id    = '4e700000-0000-4000-8000-000000000001';
  if r.left_at is null then
    raise exception 'FAIL [T4]: la membresia del hijo sigue activa. Sin cerrarla el crio sigue leyendo el club entero: retirar la cuenta no retira nada';
  end if;
  if r.left_reason is null then
    raise exception 'FAIL [T4]: la baja sin motivo no se distingue de una del club';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T5] Idempotente. El boton se pulsa dos veces mas a menudo de lo que parece.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v text;
begin
  v := public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000001');
  if v is distinct from 'none' then
    raise exception 'FAIL [T5]: la segunda llamada tenia que devolver none, dio: %', v;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T6] La invitacion VIVA tambien se retira. Es la mitad que impide que la regla
--      se reabra sola al dia siguiente.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000002');
  if v is distinct from 'invitation' then
    raise exception 'FAIL [T6]: esperaba invitation, dio: %', v;
  end if;
end $$;

reset role;
do $$
begin
  if exists (
    select 1 from public.invitations
     where player_id = '4e7b0000-0000-4000-8000-000000000002'
       and player_relation = 'self' and accepted_at is null and expires_at > now()
  ) then
    raise exception 'FAIL [T6]: la invitacion sigue viva; el crio podria entrar manana';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- [T7] La CADUCADA no se toca. No puede volverse cuenta, y la fila es historia:
--      MN-4 [4] se apoya en que caducar es lo que permite volver a invitar.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  v := public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000003');
  if v is distinct from 'none' then
    raise exception 'FAIL [T7]: una invitacion caducada no es nada que retirar, dio: %', v;
  end if;
end $$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.invitations
     where player_id = '4e7b0000-0000-4000-8000-000000000003' and player_relation = 'self'
  ) then
    raise exception 'FAIL [T7]: se ha borrado una invitacion caducada, que es historia';
  end if;
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

-- ─────────────────────────────────────────────────────────────────────────────
-- [T8] LOS 18. Cumplidos, la cuenta es suya y el tutor no la toca.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  perform public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000004');
  raise exception 'FAIL [T8]: el tutor ha retirado la cuenta de un jugador MAYOR de edad';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%jugador_mayor_de_edad%' then
      raise exception 'FAIL [T8]: esperaba jugador_mayor_de_edad, dio: %', sqlerrm;
    end if;
end $$;

reset role;
do $$
begin
  if not exists (
    select 1 from public.player_accounts
     where player_id = '4e7b0000-0000-4000-8000-000000000004' and relation = 'self'
  ) then
    raise exception 'FAIL [T8]: la cuenta del mayor de edad ha desaparecido igualmente';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T9] Un tercero.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000005');
  raise exception 'FAIL [T9]: un tercero ha retirado la cuenta de un menor ajeno';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [T9]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T10] El PROPIO jugador no se retira a si mismo. El gate es user_is_tutor_of_player
--       y no user_manages_player, que desde MN-1 ya no cuenta 'self'.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$
begin
  perform public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000005');
  raise exception 'FAIL [T10]: el propio jugador se ha retirado su cuenta por el boton de su padre';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [T10]: esperaba forbidden, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T11] Sin sesion.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{}';
do $$
begin
  perform public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000005');
  raise exception 'FAIL [T11]: sin sesion se ha retirado una cuenta';
exception
  when sqlstate 'P0001' then
    if sqlerrm like 'FAIL %' then raise; end if;
    if sqlerrm not like '%no_session%' then
      raise exception 'FAIL [T11]: esperaba no_session, dio: %', sqlerrm;
    end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T12] La membresia NO se cierra si al perfil le queda otra razon de estar en el
--       club. m2 sigue a su hermano p6: hay UNA membresia por (perfil, club), asi
--       que cerrarla a ciegas le quitaria un acceso que nadie ha pedido retirar.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare v text;
begin
  v := public.revoke_player_self_account('4e7b0000-0000-4000-8000-000000000005');
  if v is distinct from 'account' then
    raise exception 'FAIL [T12]: esperaba account, dio: %', v;
  end if;
end $$;

reset role;
do $$
begin
  if exists (
    select 1 from public.player_accounts
     where player_id = '4e7b0000-0000-4000-8000-000000000005' and relation = 'self'
  ) then
    raise exception 'FAIL [T12]: la cuenta no se ha retirado';
  end if;
  if (select m.left_at from public.memberships m
       where m.profile_id = '4e7a0000-0000-4000-8000-000000000006'
         and m.club_id    = '4e700000-0000-4000-8000-000000000001') is not null then
    raise exception 'FAIL [T12]: se ha cerrado la membresia de quien sigue teniendo otra razon de estar en el club (es seguidor de su hermano)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T13] EL CONTROL, segunda mitad. El mismo DELETE de [T1], con el admin del club,
--       SI borra. Sin esta ancla el 0 de [T1] podria significar «no habia fila».
--       Va sobre p4, cuya fila ya no hace falta para nada mas.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"4e7a0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
declare v_filas integer;
begin
  with b as (
    delete from public.player_accounts
     where player_id = '4e7b0000-0000-4000-8000-000000000004' and relation = 'self'
    returning 1
  ) select count(*) into v_filas from b;

  if v_filas <> 1 then
    raise exception 'FAIL [T13]: el admin del club tenia que poder borrar la fila (dio % filas). El 0 de [T1] no media el permiso del tutor', v_filas;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T14] CANDADO ACL — con has_function_privilege, nunca provocando el 42501.
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
begin
  if has_function_privilege('anon', 'public.revoke_player_self_account(uuid)', 'execute') then
    raise exception 'FAIL [T14]: anon NO puede ejecutar revoke_player_self_account';
  end if;
  if not has_function_privilege('authenticated', 'public.revoke_player_self_account(uuid)', 'execute') then
    raise exception 'FAIL [T14]: authenticated tiene que poder ejecutarla';
  end if;
end $$;

rollback;
