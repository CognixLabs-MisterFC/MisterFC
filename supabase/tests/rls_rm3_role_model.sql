-- RM-3 — Red de seguridad del MODELO DE ROLES (regla dura de Jose).
--
-- Blinda contra regresiones futuras los invariantes consolidados por RM-1 (#321),
-- RM-2 (#322) y F14B (superadmin). NO cambia comportamiento: todo esto YA se
-- cumple hoy. Complementa rls_f1b_director_role.sql (director/owner/aislamiento)
-- con lo que RM añadió: un-admin-por-club (unique), superadmin owner-virtual +
-- protección del owner real, y el límite del director sobre documentos legales.
--
-- MODELO (Jose):
--   · ADMIN = UNO por club, y ES el owner. Único que invita directores.
--   · DIRECTOR = como el admin salvo invitar directores y gestionar docs legales.
--   · SUPERADMIN = paridad-owner en cualquier club, PERO no descabeza al owner real.
--
-- Estilo house (rls_f1b_director_role.sql / rls_events.sql): begin … set local
-- jwt.claims … do $$ raise on fail $$ … rollback. Se corre por psql en DRY-RUN
-- contra el remoto (pgTAP NO va en CI hoy: el job "test" es vitest). Los fixtures
-- insertan en auth.users con raw_app_meta_data='{"founder":"true"}' para pasar el
-- gate de registro cerrado de F14D (handle_new_user); sin eso el trigger RAISE
-- 'registro_no_permitido' revierte el insert.

begin;

-- ═════════════════════════════════════════════════════════════════════════════
-- FIXTURES (como postgres; RLS y gate F14D=founder). Clubs A y B (owner=admin),
-- club C sin admin (para el alta legítima), un SUPERADMIN sin membresías, y varios
-- perfiles (directores, coordinador, jugador, spares).
-- ═════════════════════════════════════════════════════════════════════════════
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, created_at, updated_at) values
  ('a3d30000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-super@rm3.test',  now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-ownerA@rm3.test', now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-dirA@rm3.test',   now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-dir2A@rm3.test',  now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-coordA@rm3.test', now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a5','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-jugA@rm3.test',   now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-spare1@rm3.test', now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-spare2@rm3.test', now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-spareC@rm3.test', now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-ownerB@rm3.test', now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now()),
  ('a3d30000-0000-0000-0000-0000000000b2','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rm3-dirB@rm3.test',   now(),'{}'::jsonb,'{"founder":"true"}'::jsonb,now(),now());

-- SUPERADMIN de plataforma (sin membresías en ningún club).
insert into public.platform_admins (profile_id, granted_by) values
  ('a3d30000-0000-0000-0000-000000000001', 'a3d30000-0000-0000-0000-000000000001');

-- Clubs A y B con owner=admin; C sin owner ni admin (para el alta legítima #3).
insert into public.clubs (id, name, slug, owner_profile_id) values
  ('a3d30000-0000-0000-0000-00000000aaa1', 'Club A RM3', 'club-a-rm3', 'a3d30000-0000-0000-0000-0000000000a1'),
  ('a3d30000-0000-0000-0000-00000000bbb1', 'Club B RM3', 'club-b-rm3', 'a3d30000-0000-0000-0000-0000000000b1'),
  ('a3d30000-0000-0000-0000-00000000ccc1', 'Club C RM3', 'club-c-rm3', null);

insert into public.club_settings (club_id) values
  ('a3d30000-0000-0000-0000-00000000aaa1'),
  ('a3d30000-0000-0000-0000-00000000bbb1'),
  ('a3d30000-0000-0000-0000-00000000ccc1')
on conflict (club_id) do nothing;

-- Membresías: A (owner admin + 2 directores + coord + jugador), B (owner admin + director).
insert into public.memberships (id, profile_id, club_id, role) values
  ('a3d30000-0000-0000-0000-0000000050a1','a3d30000-0000-0000-0000-0000000000a1','a3d30000-0000-0000-0000-00000000aaa1','admin_club'),  -- ownerA
  ('a3d30000-0000-0000-0000-0000000050a2','a3d30000-0000-0000-0000-0000000000a2','a3d30000-0000-0000-0000-00000000aaa1','director'),    -- dirA
  ('a3d30000-0000-0000-0000-0000000050a3','a3d30000-0000-0000-0000-0000000000a3','a3d30000-0000-0000-0000-00000000aaa1','director'),    -- dir2A
  ('a3d30000-0000-0000-0000-0000000050a4','a3d30000-0000-0000-0000-0000000000a4','a3d30000-0000-0000-0000-00000000aaa1','coordinador'), -- coordA
  ('a3d30000-0000-0000-0000-0000000050a5','a3d30000-0000-0000-0000-0000000000a5','a3d30000-0000-0000-0000-00000000aaa1','jugador'),     -- jugA
  ('a3d30000-0000-0000-0000-0000000050b1','a3d30000-0000-0000-0000-0000000000b1','a3d30000-0000-0000-0000-00000000bbb1','admin_club'),  -- ownerB
  ('a3d30000-0000-0000-0000-0000000050b2','a3d30000-0000-0000-0000-0000000000b2','a3d30000-0000-0000-0000-00000000bbb1','director');    -- dirB

-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE RM-1 — UN ADMIN = OWNER, UNO POR CLUB (unique memberships_one_admin_per_club).
-- Como postgres (RLS bypass) para aislar el UNIQUE de las policies.
-- ═════════════════════════════════════════════════════════════════════════════

-- 1. No se puede INSERT un 2º admin_club en un club que ya tiene uno.
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('a3d30000-0000-0000-0000-0000000000a6', 'a3d30000-0000-0000-0000-00000000aaa1', 'admin_club');
  raise exception 'RM-3 TEST 1 FAIL: se permitió un 2º admin_club en el club A';
exception
  when unique_violation then null; -- esperado
end $$;

-- 2. No se puede UPDATE una membership a admin_club en un club que ya tiene admin.
do $$
begin
  update public.memberships set role = 'admin_club'
   where id = 'a3d30000-0000-0000-0000-0000000050a2'; -- dirA → admin_club
  raise exception 'RM-3 TEST 2 FAIL: se permitió promover un 2º admin_club por UPDATE';
exception
  when unique_violation then null; -- esperado
end $$;

-- 3. Sí se puede crear el ÚNICO admin_club de un club sin admin (club C).
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('a3d30000-0000-0000-0000-0000000000c1', 'a3d30000-0000-0000-0000-00000000ccc1', 'admin_club');
  -- lives: si llega aquí, OK. El trigger F14B-5b le asigna owner.
  if not exists (
    select 1 from public.clubs
    where id = 'a3d30000-0000-0000-0000-00000000ccc1'
      and owner_profile_id = 'a3d30000-0000-0000-0000-0000000000c1'
  ) then
    raise exception 'RM-3 TEST 3 FAIL: el trigger no asignó owner al primer admin_club';
  end if;
end $$;

-- 4. Varios directores / coordinadores en el mismo club: permitido (unique es SOLO admin_club).
do $$
begin
  insert into public.memberships (profile_id, club_id, role) values
    ('a3d30000-0000-0000-0000-0000000000a6', 'a3d30000-0000-0000-0000-00000000aaa1', 'director'),      -- 3er director
    ('a3d30000-0000-0000-0000-0000000000a7', 'a3d30000-0000-0000-0000-00000000aaa1', 'coordinador');   -- 2º coordinador
  -- lives: sin unique sobre roles bajos.
  if (select count(*) from public.memberships
      where club_id = 'a3d30000-0000-0000-0000-00000000aaa1' and role = 'director') < 3 then
    raise exception 'RM-3 TEST 4 FAIL: no se pudieron crear varios directores';
  end if;
end $$;
-- limpiar los inserts del test 4 para no ensuciar los bloques siguientes.
delete from public.memberships
 where profile_id in ('a3d30000-0000-0000-0000-0000000000a6','a3d30000-0000-0000-0000-0000000000a7')
   and club_id = 'a3d30000-0000-0000-0000-00000000aaa1';

-- A partir de aquí, contexto de usuario real (authenticated + jwt por persona).
set local role authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE DIRECTOR — límites del modelo (jwt = dirA, director del club A).
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"a3d30000-0000-0000-0000-0000000000a2","role":"authenticated"}';

-- 5. Un director NO puede invitar a un director (invitations_insert_admin exige owner).
do $$
begin
  insert into public.invitations (email, role, club_id, created_by, expires_at)
  values ('rm3-newdir@rm3.test', 'director', 'a3d30000-0000-0000-0000-00000000aaa1',
          'a3d30000-0000-0000-0000-0000000000a2', now() + interval '7 days');
  raise exception 'RM-3 TEST 5 FAIL: un director pudo invitar a un director';
exception
  when insufficient_privilege then null; -- esperado (RLS WITH CHECK)
end $$;

-- 6. Un director NO puede publicar documentos legales (publish_legal_document exige admin_club).
do $$
begin
  perform public.publish_legal_document(
    'a3d30000-0000-0000-0000-00000000aaa1', 'privacy_policy', 'Cuerpo RM-3 director');
  raise exception 'RM-3 TEST 6 FAIL: un director pudo publicar un documento legal';
exception
  when others then
    if SQLERRM not like '%forbidden%' then raise; end if; -- esperado: forbidden
end $$;

-- 7. Un director SÍ gestiona roles BAJOS (jugador → coordinador).
do $$
begin
  perform public.admin_update_staff_role(
    'a3d30000-0000-0000-0000-00000000aaa1', 'a3d30000-0000-0000-0000-0000000000a5', 'coordinador');
  if (select role from public.memberships where id = 'a3d30000-0000-0000-0000-0000000050a5') <> 'coordinador' then
    raise exception 'RM-3 TEST 7 FAIL: el director no pudo cambiar un rol bajo';
  end if;
end $$;

-- 8. Un director NO puede degradar a otro director ni al owner.
do $$
begin
  perform public.admin_update_staff_role(
    'a3d30000-0000-0000-0000-00000000aaa1', 'a3d30000-0000-0000-0000-0000000000a3', 'coordinador'); -- degrade dir2A
  raise exception 'RM-3 TEST 8a FAIL: un director degradó a otro director';
exception
  when others then
    if SQLERRM not like '%forbidden_requires_owner%' then raise; end if; -- esperado
end $$;
do $$
begin
  perform public.admin_update_staff_role(
    'a3d30000-0000-0000-0000-00000000aaa1', 'a3d30000-0000-0000-0000-0000000000a1', 'coordinador'); -- degrade owner
  raise exception 'RM-3 TEST 8b FAIL: un director degradó al owner';
exception
  when others then
    if SQLERRM not like '%owner_immutable%' then raise; end if; -- esperado
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE SUPERADMIN — paridad owner + protección del owner real (jwt = SUPER).
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"a3d30000-0000-0000-0000-000000000001","role":"authenticated"}';

-- 9. El superadmin es owner-virtual de cualquier club (user_is_club_owner = true).
do $$
begin
  if not public.user_is_club_owner('a3d30000-0000-0000-0000-00000000bbb1')
     or not public.user_is_club_owner('a3d30000-0000-0000-0000-00000000aaa1') then
    raise exception 'RM-3 TEST 9 FAIL: el superadmin no es owner-virtual';
  end if;
end $$;

-- 10. El superadmin puede invitar director y publicar documentos legales en un club ajeno (B).
do $$
begin
  insert into public.invitations (email, role, club_id, created_by, expires_at)
  values ('rm3-superdir@rm3.test', 'director', 'a3d30000-0000-0000-0000-00000000bbb1',
          'a3d30000-0000-0000-0000-000000000001', now() + interval '7 days');
  -- lives: RLS lo permite vía user_is_club_owner (RM-2).
  perform public.publish_legal_document(
    'a3d30000-0000-0000-0000-00000000bbb1', 'privacy_policy', 'Cuerpo RM-3 superadmin');
  -- lives: gate admin_club vía chokepoint F14B-2.
end $$;

-- 11. El superadmin NO puede descabezar al owner REAL de un club (owner_immutable).
do $$
begin
  perform public.admin_update_staff_role(
    'a3d30000-0000-0000-0000-00000000bbb1', 'a3d30000-0000-0000-0000-0000000000b1', 'coordinador');
  raise exception 'RM-3 TEST 11a FAIL: el superadmin degradó al owner real';
exception
  when others then
    if SQLERRM not like '%owner_immutable%' then raise; end if; -- esperado
end $$;
-- 11b. Tampoco puede ELIMINAR la membership del owner real (memberships_delete_admin).
do $$
begin
  delete from public.memberships where id = 'a3d30000-0000-0000-0000-0000000050b1'; -- ownerB
  if not exists (select 1 from public.memberships where id = 'a3d30000-0000-0000-0000-0000000050b1') then
    raise exception 'RM-3 TEST 11b FAIL: el superadmin eliminó la membership del owner real';
  end if;
end $$;

-- 12. profile_is_club_owner = true SOLO para el owner real, NO para el superadmin ni un director.
do $$
begin
  if not public.profile_is_club_owner('a3d30000-0000-0000-0000-00000000bbb1', 'a3d30000-0000-0000-0000-0000000000b1') then
    raise exception 'RM-3 TEST 12 FAIL: el owner real no da profile_is_club_owner=true';
  end if;
  if public.profile_is_club_owner('a3d30000-0000-0000-0000-00000000bbb1', 'a3d30000-0000-0000-0000-000000000001') then
    raise exception 'RM-3 TEST 12 FAIL: el superadmin da profile_is_club_owner=true (no debe)';
  end if;
  if public.profile_is_club_owner('a3d30000-0000-0000-0000-00000000bbb1', 'a3d30000-0000-0000-0000-0000000000b2') then
    raise exception 'RM-3 TEST 12 FAIL: un director da profile_is_club_owner=true (no debe)';
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- BLOQUE OWNER — invariante + aislamiento (F1B).
-- ═════════════════════════════════════════════════════════════════════════════

-- 13. El owner de un club NO puede ser degradado (owner_immutable), ni por sí mismo.
set local "request.jwt.claims" = '{"sub":"a3d30000-0000-0000-0000-0000000000a1","role":"authenticated"}';
do $$
begin
  perform public.admin_update_staff_role(
    'a3d30000-0000-0000-0000-00000000aaa1', 'a3d30000-0000-0000-0000-0000000000a1', 'director');
  raise exception 'RM-3 TEST 13 FAIL: el owner pudo ser degradado';
exception
  when others then
    if SQLERRM not like '%owner_immutable%' then raise; end if; -- esperado
end $$;

-- 14. AISLAMIENTO: el owner/admin de A NO gestiona el club B (no es superadmin).
do $$
begin
  if public.user_role_in_club('a3d30000-0000-0000-0000-00000000bbb1') is not null then
    raise exception 'RM-3 TEST 14 FAIL: el admin de A tiene rol en B';
  end if;
  if public.user_is_club_owner('a3d30000-0000-0000-0000-00000000bbb1') then
    raise exception 'RM-3 TEST 14 FAIL: el admin de A es owner-virtual de B (no es superadmin)';
  end if;
end $$;

-- Todos los invariantes verificados.
do $$ begin raise notice 'RM-3: 14/14 invariantes del modelo de roles VERIFICADOS.'; end $$;

rollback;
