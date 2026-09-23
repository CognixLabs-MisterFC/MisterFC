-- RC-B — el remate del borrado retira las cuentas de los menores que se quedarian sin
-- ningun tutor (migracion 20261102000000).
--
-- LA VENTANA QUE CIERRA, medida entera contra produccion: la 20261101000000 impide
-- PEDIR el borrado dejando a un menor con cuenta propia, pero mide AL PEDIR, y entre
-- medias hay 30 dias. El tutor pide el borrado (el hijo aun no tiene cuenta), le invita
-- —`invite_player_self` no mira si hay un borrado en curso—, el hijo acepta —el candado
-- de BC-6 solo frena a QUIEN ACEPTA— y al vencer el plazo el menor se quedaba dentro de
-- la app, con su cuenta y su membresia viva, sin nadie.
--
-- Este fichero monta esa misma secuencia y comprueba que ahora el remate lo arregla.
--
-- Cubre:
--   [T0]  Las dos funciones existen (si no, la migracion esta sin aplicar).
--   [T1]  El menor que se quedaba solo: fuera su cuenta propia y cerrado su acceso.
--   [T2]  LO QUE NO SE TOCA (decision de Jose): sigue siendo jugador del club, con su
--         ficha, su equipo y sus convocatorias.
--   [T3]  La invitacion VIVA tambien se retira: si no, el crio entraria despues.
--   [T4]  El menor que TIENE otro tutor conserva su cuenta y su acceso. No se queda solo.
--   [T5]  El jugador MAYOR DE EDAD conserva la suya: es suya, no la toca nadie.
--   [T6]  Queda rastro en audit_log, con el actor y el motivo.
--   [T7]  El aviso `tutor_unlinked` NO se le escribe a quien acabamos de sacar, y SI al
--         otro tutor que se queda. Escribir una novedad en un sitio del que acabas de
--         echar a alguien es dejarla sin leer para siempre.
--   [T8]  El borrado SE COMPLETA. La alternativa —no rematar mientras haya menores
--         colgando— dejaria a alguien sin poder borrarse nunca (5.1.1(v) de Apple).
--   [T9]  CANDADO ACL: el `_apply` no se concede a nadie. Sin gate, ejecutarlo es
--         retirar la cuenta de cualquier menor.
--   [T10] CONTROL NEGATIVO: sin el bloque 5.0, el menor se queda con cuenta y sin tutor.
--
-- Que `revoke_player_self_account` sigue haciendo lo mismo por fuera tras partirse en
-- dos lo mide su propio fichero, `retirar_cuenta_propia.sql`, que corre en la misma
-- suite y no ha necesitado tocarse. Esa es la prueba de que el reparto no cambio nada.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Las aserciones LEEN con el rol de la sesion: las comprobaciones van como
-- postgres.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── T0 ───────────────────────────────────────────────────────────────────────
do $$
begin
  if to_regprocedure('public.revoke_player_self_account_apply(uuid)') is null then
    raise exception 'FAIL [T0]: falta revoke_player_self_account_apply — la migracion 20261102000000 no esta aplicada';
  end if;
end $$;

-- ── Fixture ──────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('dd700000-0000-4000-8000-000000000001', 'Club RCB', 'club-rcb');

insert into public.seasons (id, club_id, label, status) values
  ('dd7c0000-0000-4000-8000-000000000001', 'dd700000-0000-4000-8000-000000000001', '2026-27', 'active');

insert into public.categories (id, club_id, name) values
  ('dd7d0000-0000-4000-8000-000000000001', 'dd700000-0000-4000-8000-000000000001', 'Cat RCB');

insert into public.teams (id, category_id, name, format, color, season) values
  ('dd7e0000-0000-4000-8000-000000000001', 'dd7d0000-0000-4000-8000-000000000001', 'Equipo RCB', 'F7', '#10B981', '2026-27');

-- t  = el tutor que se va · m1 = la cuenta del menor que se quedaria solo
-- m2 = la cuenta del menor que SI tiene otro tutor · t2 = ese otro tutor
-- ma = la cuenta de un jugador MAYOR de edad, del que t tambien es tutor
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-000000000001', 't@rcb.test',  '{}'::jsonb);
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-000000000002', 'm1@rcb.test', '{}'::jsonb);
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-000000000003', 't2@rcb.test', '{}'::jsonb);
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-000000000004', 'm2@rcb.test', '{}'::jsonb);
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-000000000005', 'ma@rcb.test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('dd7a0000-0000-4000-8000-000000000001', 'dd700000-0000-4000-8000-000000000001', 'jugador'),
  ('dd7a0000-0000-4000-8000-000000000002', 'dd700000-0000-4000-8000-000000000001', 'jugador'),
  ('dd7a0000-0000-4000-8000-000000000003', 'dd700000-0000-4000-8000-000000000001', 'jugador'),
  ('dd7a0000-0000-4000-8000-000000000004', 'dd700000-0000-4000-8000-000000000001', 'jugador'),
  ('dd7a0000-0000-4000-8000-000000000005', 'dd700000-0000-4000-8000-000000000001', 'jugador');

-- Fechas FIJAS. p4 nacio en 2000: mayor de edad hoy y dentro de veinte anos.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('dd7b0000-0000-4000-8000-000000000001', 'dd700000-0000-4000-8000-000000000001', 'Uno',    'Rcb', '2014-03-03'),
  ('dd7b0000-0000-4000-8000-000000000002', 'dd700000-0000-4000-8000-000000000001', 'Dos',    'Rcb', '2014-03-03'),
  ('dd7b0000-0000-4000-8000-000000000003', 'dd700000-0000-4000-8000-000000000001', 'Tres',   'Rcb', '2014-03-03'),
  ('dd7b0000-0000-4000-8000-000000000004', 'dd700000-0000-4000-8000-000000000001', 'Mayor',  'Rcb', '2000-01-01');

insert into public.team_members (player_id, team_id) values
  ('dd7b0000-0000-4000-8000-000000000001', 'dd7e0000-0000-4000-8000-000000000001');

-- t es tutor de los cuatro. t2 lo es TAMBIEN de p3.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('dd7b0000-0000-4000-8000-000000000001', 'dd7a0000-0000-4000-8000-000000000001', 'parent'),
  ('dd7b0000-0000-4000-8000-000000000002', 'dd7a0000-0000-4000-8000-000000000001', 'parent'),
  ('dd7b0000-0000-4000-8000-000000000003', 'dd7a0000-0000-4000-8000-000000000001', 'parent'),
  ('dd7b0000-0000-4000-8000-000000000003', 'dd7a0000-0000-4000-8000-000000000003', 'parent'),
  ('dd7b0000-0000-4000-8000-000000000004', 'dd7a0000-0000-4000-8000-000000000001', 'parent');

-- ── LA VENTANA, paso 1: el tutor pide el borrado. Todavia no hay ninguna cuenta de
--    menor, asi que el candado de la 20261101000000 le deja pasar. ──
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"dd7a0000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.request_account_deletion('ensayo rcb');
exception when others then
  raise exception 'FAIL [montaje]: el tutor tenia que poder pedir el borrado ANTES de que su hijo tuviera cuenta (%)', sqlerrm;
end $$;

-- ── paso 2 y 3: durante los 30 dias aparecen las cuentas. Se escriben directamente
--    porque lo que se mide aqui es el REMATE, no el camino por el que llegaron: el
--    ensayo de produccion ya comprobo que invitar y aceptar funcionan en esa ventana. ──
reset role;
insert into public.player_accounts (player_id, profile_id, relation) values
  ('dd7b0000-0000-4000-8000-000000000001', 'dd7a0000-0000-4000-8000-000000000002', 'self'),
  ('dd7b0000-0000-4000-8000-000000000003', 'dd7a0000-0000-4000-8000-000000000004', 'self'),
  ('dd7b0000-0000-4000-8000-000000000004', 'dd7a0000-0000-4000-8000-000000000005', 'self');

insert into public.invitations (email, club_id, role, player_id, player_relation, created_by, expires_at) values
  ('hijo2@rcb.test', 'dd700000-0000-4000-8000-000000000001', 'jugador',
   'dd7b0000-0000-4000-8000-000000000002', 'self', 'dd7a0000-0000-4000-8000-000000000001',
   now() + interval '7 days');

-- ── paso 4: vence el plazo y el cron remata. ──
update public.account_deletion_requests set deadline_at = now() - interval '1 day'
 where profile_id = 'dd7a0000-0000-4000-8000-000000000001';
update public.erasure_requests set status = 'rejected', decided_at = now()
 where requested_by = 'dd7a0000-0000-4000-8000-000000000001' and status = 'pending';

do $$
begin
  perform public.finalize_account_deletion('dd7a0000-0000-4000-8000-000000000001');
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T1] El menor que se quedaba solo.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  if exists (
    select 1 from public.player_accounts
     where player_id = 'dd7b0000-0000-4000-8000-000000000001' and relation = 'self'
  ) then
    raise exception 'FAIL [T1]: el menor conserva su cuenta propia y ya no le queda ningun tutor';
  end if;

  select m.left_at, m.left_reason into r
    from public.memberships m
   where m.profile_id = 'dd7a0000-0000-4000-8000-000000000002'
     and m.club_id    = 'dd700000-0000-4000-8000-000000000001';
  if r.left_at is null then
    raise exception 'FAIL [T1]: la cuenta del menor sigue con acceso al club. Sin cerrar la membresia, retirar no retira nada';
  end if;
  if r.left_reason is null then
    raise exception 'FAIL [T1]: la baja sin motivo no se distingue de una del club';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T2] LO QUE NO SE TOCA. Decision de Jose, literal: «el nino sigue en el club con su
--      ficha, su equipo y sus convocatorias; solo pierde el acceso a la app».
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  select p.left_club_at, p.erased_at into r
    from public.players p where p.id = 'dd7b0000-0000-4000-8000-000000000001';
  if r.left_club_at is not null or r.erased_at is not null then
    raise exception 'FAIL [T2]: el remate ha dado de baja al JUGADOR (left_club_at=%, erased_at=%)', r.left_club_at, r.erased_at;
  end if;
  if not exists (
    select 1 from public.team_members tm
     where tm.player_id = 'dd7b0000-0000-4000-8000-000000000001'
       and tm.team_id   = 'dd7e0000-0000-4000-8000-000000000001'
       and tm.left_at is null
  ) then
    raise exception 'FAIL [T2]: el remate ha sacado al jugador de su equipo';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T3] La invitacion VIVA tambien se retira.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.invitations
     where player_id = 'dd7b0000-0000-4000-8000-000000000002'
       and player_relation = 'self'
       and accepted_at is null
       and expires_at > now()
  ) then
    raise exception 'FAIL [T3]: la invitacion sigue viva; el crio entraria despues de que su tutor ya no exista';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T4] El menor que TIENE otro tutor no se toca: no se queda solo.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.player_accounts
     where player_id = 'dd7b0000-0000-4000-8000-000000000003' and relation = 'self'
  ) then
    raise exception 'FAIL [T4]: se ha retirado la cuenta de un menor al que le queda otro tutor';
  end if;
  if (select m.left_at from public.memberships m
       where m.profile_id = 'dd7a0000-0000-4000-8000-000000000004'
         and m.club_id    = 'dd700000-0000-4000-8000-000000000001') is not null then
    raise exception 'FAIL [T4]: se ha cerrado el acceso de un menor al que le queda otro tutor';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T5] El jugador MAYOR DE EDAD conserva la suya: es suya.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.player_accounts
     where player_id = 'dd7b0000-0000-4000-8000-000000000004' and relation = 'self'
  ) then
    raise exception 'FAIL [T5]: el remate ha retirado la cuenta de un jugador MAYOR de edad. Esa cuenta es suya y solo el la cierra';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T6] Rastro en auditoria.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.audit_log
     where action = 'player.self_account_revoked'
       and target_id = 'dd7b0000-0000-4000-8000-000000000001'
       and actor_profile_id = 'dd7a0000-0000-4000-8000-000000000001'
       and reason like '%borrado%'
  ) then
    raise exception 'FAIL [T6]: la retirada automatica no ha dejado rastro en audit_log';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T7] A quien se saca no se le escribe una novedad; a quien se queda, si.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from public.notifications
     where user_id = 'dd7a0000-0000-4000-8000-000000000002'
       and type = 'tutor_unlinked'
  ) then
    raise exception 'FAIL [T7]: se le ha escrito un aviso a la cuenta que acabamos de cerrar. Nadie lo leera nunca';
  end if;
  if not exists (
    select 1 from public.notifications
     where user_id = 'dd7a0000-0000-4000-8000-000000000003'
       and type = 'tutor_unlinked'
  ) then
    raise exception 'FAIL [T7]: el otro tutor, que se queda como unico responsable del menor, NO se ha enterado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T8] El borrado se completa. Nadie se queda sin poder irse.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from public.account_deletion_requests
     where profile_id = 'dd7a0000-0000-4000-8000-000000000001' and status = 'completed'
  ) then
    raise exception 'FAIL [T8]: el borrado no se ha completado. Bloquear el remate dejaria a alguien sin poder irse nunca';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T9] CANDADO ACL del `_apply` — sin gate, ejecutarlo es retirar la cuenta de
--      cualquier menor. No se concede a nadie.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.revoke_player_self_account_apply(uuid)', 'execute') then
    raise exception 'FAIL [T9]: anon NO puede ejecutar el _apply';
  end if;
  if has_function_privilege('authenticated', 'public.revoke_player_self_account_apply(uuid)', 'execute') then
    raise exception 'FAIL [T9]: authenticated tampoco: sin gate, retiraria la cuenta de cualquier menor';
  end if;
  -- Y la puerta del tutor sigue abierta, que es por donde se entra de verdad.
  if not has_function_privilege('authenticated', 'public.revoke_player_self_account(uuid)', 'execute') then
    raise exception 'FAIL [T9]: el tutor tiene que poder seguir retirando la cuenta de su hijo';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [T10] CONTROL NEGATIVO. Sin el bloque 5.0 el menor se queda con cuenta y sin tutor,
--       que es el estado medido en produccion. Si esto fallara, lo de [T1] lo estaria
--       produciendo otra cosa. El rollback lo repone.
-- ─────────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-000000000009', 'neg@rcb.test', '{}'::jsonb);
select pg_temp.new_test_user('dd7a0000-0000-4000-8000-00000000000a', 'negself@rcb.test', '{}'::jsonb);
insert into public.memberships (profile_id, club_id, role) values
  ('dd7a0000-0000-4000-8000-000000000009', 'dd700000-0000-4000-8000-000000000001', 'jugador'),
  ('dd7a0000-0000-4000-8000-00000000000a', 'dd700000-0000-4000-8000-000000000001', 'jugador');
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('dd7b0000-0000-4000-8000-000000000009', 'dd700000-0000-4000-8000-000000000001', 'Neg', 'Rcb', '2014-03-03');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('dd7b0000-0000-4000-8000-000000000009', 'dd7a0000-0000-4000-8000-000000000009', 'parent'),
  ('dd7b0000-0000-4000-8000-000000000009', 'dd7a0000-0000-4000-8000-00000000000a', 'self');

-- El `_apply` deja de hacer nada: es como si el bloque 5.0 no estuviera.
create or replace function public.revoke_player_self_account_apply(p_player_id uuid)
returns text language sql as $fn$ select 'none'::text $fn$;

insert into public.account_deletion_requests (profile_id, deadline_at)
values ('dd7a0000-0000-4000-8000-000000000009', now() - interval '1 day');

do $$
begin
  perform public.finalize_account_deletion('dd7a0000-0000-4000-8000-000000000009');
  if not exists (
    select 1 from public.player_accounts
     where player_id = 'dd7b0000-0000-4000-8000-000000000009' and relation = 'self'
  ) then
    raise exception 'FAIL [T10]: sin el bloque 5.0 la cuenta del menor deberia seguir ahi. Lo de [T1] no lo produce este cambio';
  end if;
  if exists (
    select 1 from public.player_accounts
     where player_id = 'dd7b0000-0000-4000-8000-000000000009' and relation in ('parent','guardian')
  ) then
    raise exception 'FAIL [T10]: el montaje falla — al menor tenia que quedarse sin tutores';
  end if;
end $$;

rollback;
