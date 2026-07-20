-- platform_change_club_admin — cambiar el admin de un club (consola superadmin).
--
-- Verifica:
--   T1. superadmin cambia admin → el viejo pierde la membership admin_club de ESTE
--       club; el club queda owner NULL; existe invitación admin_club para el nuevo;
--       las invitaciones NO-admin del viejo siguen vivas; el viejo conserva su
--       membership en OTRO club (aislamiento); el trigger NUNCA se desactiva (el
--       mecanismo es un permiso de sesión LOCAL, no DISABLE/ENABLE TRIGGER).
--   T2. NO-superadmin → forbidden.
--   T3. En una transacción NUEVA (sin el permiso de sesión) el trigger
--       protect_club_owner_membership bloquea un DELETE directo de una membership
--       admin_club. Corre en su propia transacción a propósito: prueba que el
--       set_config(is_local:=true) de la RPC NO persiste entre transacciones.
--
-- Convención: psql ON_ERROR_STOP=1; asserts con DO+raise; BEGIN/ROLLBACK. El
-- superadmin se siembra en platform_admins (as postgres) y se simula auth con role
-- authenticated + request.jwt.claims.
\ir helpers/auth_users.sql

begin;

-- Users
select pg_temp.new_test_user('c0000000-0000-4000-8000-000000000001', 'super@chg.test',    '{"full_name":"Super"}'::jsonb);
select pg_temp.new_test_user('c0000000-0000-4000-8000-000000000002', 'oldadmin@chg.test',  '{"full_name":"Old Admin"}'::jsonb);
select pg_temp.new_test_user('c0000000-0000-4000-8000-000000000003', 'nobody@chg.test',    '{"full_name":"Nobody"}'::jsonb);

-- Superadmin de plataforma.
insert into public.platform_admins (profile_id) values ('c0000000-0000-4000-8000-000000000001');

-- Club A (owner = oldadmin) y Club B (oldadmin es coordinador → aislamiento).
insert into public.clubs (id, name, slug, owner_profile_id) values
  ('caaa0000-0000-4000-8000-000000000001', 'Club A', 'club-a-chgadmin', 'c0000000-0000-4000-8000-000000000002'),
  ('cbbb0000-0000-4000-8000-000000000001', 'Club B', 'club-b-chgadmin', null);

insert into public.memberships (profile_id, club_id, role) values
  ('c0000000-0000-4000-8000-000000000002', 'caaa0000-0000-4000-8000-000000000001', 'admin_club'),   -- viejo admin (club A)
  ('c0000000-0000-4000-8000-000000000002', 'cbbb0000-0000-4000-8000-000000000001', 'coordinador');   -- mismo user, otro club

-- Invitación NO-admin creada por el viejo admin en club A (debe sobrevivir).
insert into public.invitations (id, token, email, club_id, role, expires_at, accepted_at, created_by) values
  ('caaa0001-0000-4000-8000-000000000001', 'caaa0001-0000-4000-8000-0000000a0001',
   'peon@chg.test', 'caaa0000-0000-4000-8000-000000000001', 'entrenador_principal',
   now() + interval '7 days', null, 'c0000000-0000-4000-8000-000000000002');

-- ── T2 primero: NO-superadmin → forbidden ──
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$
begin
  perform public.platform_change_club_admin('caaa0000-0000-4000-8000-000000000001', 'new@chg.test');
  raise exception 'FAIL [T2]: un no-superadmin pudo cambiar el admin';
exception when others then
  if sqlerrm <> 'forbidden' then
    raise exception 'FAIL [T2]: esperaba forbidden, obtuve "%"', sqlerrm;
  end if;
end $$;

-- ── T1: superadmin cambia el admin ──
set local "request.jwt.claims" = '{"sub":"c0000000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare
  v_inv_email text;
  v_cnt int;
  v_tg  "char";
begin
  select email into v_inv_email
    from public.platform_change_club_admin('caaa0000-0000-4000-8000-000000000001', 'NEW@chg.test');
  if v_inv_email is null then
    raise exception 'FAIL [T1.0]: la RPC no devolvió invitación';
  end if;

  -- viejo admin fuera del club A
  select count(*) into v_cnt from public.memberships
   where club_id = 'caaa0000-0000-4000-8000-000000000001'
     and profile_id = 'c0000000-0000-4000-8000-000000000002';
  if v_cnt <> 0 then raise exception 'FAIL [T1.1]: el viejo admin sigue en el club A (% filas)', v_cnt; end if;

  -- club A sin owner
  select count(*) into v_cnt from public.clubs
   where id = 'caaa0000-0000-4000-8000-000000000001' and owner_profile_id is null;
  if v_cnt <> 1 then raise exception 'FAIL [T1.2]: club A no quedó con owner NULL'; end if;

  -- invitación admin_club para el nuevo (email normalizado a minúsculas)
  select count(*) into v_cnt from public.invitations
   where club_id = 'caaa0000-0000-4000-8000-000000000001'
     and role = 'admin_club' and accepted_at is null and email = 'new@chg.test';
  if v_cnt <> 1 then raise exception 'FAIL [T1.3]: no existe la invitación admin para el nuevo (% filas)', v_cnt; end if;

  -- aislamiento: el viejo conserva su membership en club B
  select count(*) into v_cnt from public.memberships
   where club_id = 'cbbb0000-0000-4000-8000-000000000001'
     and profile_id = 'c0000000-0000-4000-8000-000000000002' and role = 'coordinador';
  if v_cnt <> 1 then raise exception 'FAIL [T1.4]: se tocó la membership del viejo en OTRO club'; end if;

  -- las invitaciones NO-admin del viejo siguen vivas
  select count(*) into v_cnt from public.invitations
   where id = 'caaa0001-0000-4000-8000-000000000001';
  if v_cnt <> 1 then raise exception 'FAIL [T1.5]: se borró una invitación no-admin del viejo'; end if;

  -- El trigger NUNCA se desactiva: el mecanismo es set_config local, no DISABLE
  -- TRIGGER. tgenabled sigue siendo 'O' (origin/enabled). Detecta una regresión a
  -- DISABLE/ENABLE TRIGGER (que dejaría tgenabled='D' si algo lo interrumpiera).
  select tgenabled into v_tg from pg_trigger
   where tgname = 'protect_club_owner_membership'
     and tgrelid = 'public.memberships'::regclass;
  if v_tg is distinct from 'O' then
    raise exception 'FAIL [T1.6]: el trigger no quedó enabled (tgenabled=%)', v_tg;
  end if;
end $$;

reset role;
rollback;

-- ── T3: transacción NUEVA — el permiso de sesión NO persiste (prueba is_local) y el
--        trigger vuelve a bloquear un DELETE directo de admin_club (como postgres) ──
begin;

-- El set_config(is_local:=true) que la RPC activó en la transacción anterior debe
-- haberse limpiado al hacer rollback: aquí la variable NO debe valer 'on'.
do $$
begin
  if coalesce(current_setting('misterfc.allow_owner_membership_delete', true), '') = 'on' then
    raise exception 'FAIL [T3.0]: el permiso de sesión persistió entre transacciones (is_local roto)';
  end if;
end $$;

select pg_temp.new_test_user('c0000000-0000-4000-8000-000000000004', 'freshadmin@chg.test', '{"full_name":"Fresh"}'::jsonb);
insert into public.clubs (id, name, slug, owner_profile_id)
  values ('cccc0000-0000-4000-8000-000000000001', 'Club C', 'club-c-chgadmin', null);
insert into public.memberships (profile_id, club_id, role)
  values ('c0000000-0000-4000-8000-000000000004', 'cccc0000-0000-4000-8000-000000000001', 'admin_club');

do $$
begin
  delete from public.memberships
   where club_id = 'cccc0000-0000-4000-8000-000000000001' and role = 'admin_club';
  raise exception 'FAIL [T3]: el DELETE directo de admin_club NO fue bloqueado (sin set_config)';
exception when others then
  if sqlerrm <> 'owner_membership_protected' then
    raise exception 'FAIL [T3]: esperaba owner_membership_protected, obtuve "%"', sqlerrm;
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ platform_change_club_admin: corta al viejo, owner NULL, invita al nuevo, aísla otros clubes; guard por sesión local (no DISABLE TRIGGER), que no persiste entre transacciones y sigue protegiendo.'
\echo '──────────────────────────────────────────────'
