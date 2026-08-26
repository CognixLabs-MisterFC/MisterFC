-- Baja de miembros · Paso 2 (enforcement). Verifica que memberships.left_at IS NOT NULL
-- = "ya no es miembro": los helpers de rol/acceso lo niegan, aplica a director/staff/
-- tutor, el superadmin se preserva, y es reversible. Migración
-- 20261050000000_memberships_lifecycle_enforcement.sql (helpers) sobre
-- 20261049000000 (columna left_at).
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. auth.uid()
-- se fija con `set local "request.jwt.claims"`.
--
-- Fixture: Club A con admin, director (D), coordinador (C, team_staff activo), tutor (T,
-- membership jugador + hijo P en el equipo) y un director control (K); superadmin (S)
-- con membership de baja en A. Club B con un ÚNICO admin de baja NO-superadmin (para
-- probar la guarda solo-admin, no construible con datos de prod).
--
-- Casos:
--   C0. baseline activo: roles y accesos correctos.
--   C1. director de baja → user_role_in_club NULL, profile_is_staff_of_club false.
--   C2. coordinador de baja CON team_staff activo → staff_of_team/coordinates false
--       (defensa en profundidad) y fuera del fan-out de chat.
--   C3. baja DEPORTIVA del hijo (players.left_club_at) → el tutor NO se ve afectado.
--   C4. tutor de baja (membership) → role NULL, team_member_account false, fuera de chat.
--   C5. superadmin con membership de baja → sigue admin_club.
--   C6. reactivar (left_at→NULL) → acceso restaurado.
--   C7. control activo → intacto.
--   C8. admin_update_staff_role por un director de baja → forbidden.
--   C9. open_next_season por un admin_club de BAJA (no superadmin) → forbidden.
--   INV. ningún tutor sin membership en el club del hijo (protege el join de C4).
\ir helpers/auth_users.sql

begin;

-- ── Usuarios (crea auth.users + profiles vía trigger) ────────────────────────────────
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000001', 'mlc-admin@test.local',  '{"full_name":"Admin A"}'::jsonb);
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000002', 'mlc-dir@test.local',    '{"full_name":"Directora D"}'::jsonb);
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000003', 'mlc-coord@test.local',  '{"full_name":"Coordinador C"}'::jsonb);
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000004', 'mlc-tutor@test.local',  '{"full_name":"Tutor T"}'::jsonb);
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000005', 'mlc-super@test.local',  '{"full_name":"Superadmin S"}'::jsonb);
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000006', 'mlc-ctrl@test.local',   '{"full_name":"Director K"}'::jsonb);
select pg_temp.new_test_user('aaaa0000-0000-4000-8000-000000000007', 'mlc-adminb@test.local', '{"full_name":"Admin B"}'::jsonb);

-- ── Clubs ─────────────────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('aa000000-0000-4000-8000-0000000000a1', 'Club A MLC', 'club-a-mlc'),
  ('aa000000-0000-4000-8000-0000000000b1', 'Club B MLC', 'club-b-mlc');

-- ── Memberships (Club A: admin, director, coordinador, tutor-jugador, superadmin, control)
--    Club B: admin de baja. La del coordinador con id explícito (la referencia team_staff).
insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('aadd0000-0000-4000-8000-000000000001','aaaa0000-0000-4000-8000-000000000001','aa000000-0000-4000-8000-0000000000a1','admin_club',    null),
  ('aadd0000-0000-4000-8000-000000000002','aaaa0000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-0000000000a1','director',      null),
  ('aadd0000-0000-4000-8000-000000000003','aaaa0000-0000-4000-8000-000000000003','aa000000-0000-4000-8000-0000000000a1','coordinador',   null),
  ('aadd0000-0000-4000-8000-000000000004','aaaa0000-0000-4000-8000-000000000004','aa000000-0000-4000-8000-0000000000a1','jugador',       null),
  ('aadd0000-0000-4000-8000-000000000005','aaaa0000-0000-4000-8000-000000000005','aa000000-0000-4000-8000-0000000000a1','entrenador_ayudante', current_date),  -- superadmin, membership de baja
  ('aadd0000-0000-4000-8000-000000000006','aaaa0000-0000-4000-8000-000000000006','aa000000-0000-4000-8000-0000000000a1','director',      null),
  ('aadd0000-0000-4000-8000-000000000007','aaaa0000-0000-4000-8000-000000000007','aa000000-0000-4000-8000-0000000000b1','admin_club',    current_date);  -- Club B: admin de baja

-- ── Superadmin de plataforma ─────────────────────────────────────────────────────────
insert into public.platform_admins (profile_id) values ('aaaa0000-0000-4000-8000-000000000005');

-- ── Categoría, temporada activa, equipo (Club A) ─────────────────────────────────────
insert into public.categories (id, club_id, name, kind, half_duration_minutes, is_standard) values
  ('aacc0000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-0000000000a1', 'Alevin', 'alevin', 30, true);
insert into public.seasons (club_id, label, status) values
  ('aa000000-0000-4000-8000-0000000000a1', '2025-26', 'active');
insert into public.teams (id, club_id, category_id, season, name, format, color) values
  ('aaee0000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a1', 'aacc0000-0000-4000-8000-00000000000a', '2025-26', 'Alevin A', 'F8', '#10B981');

-- ── Coordinador C como team_staff ACTIVO del equipo ──────────────────────────────────
insert into public.team_staff (membership_id, team_id, staff_role, joined_at) values
  ('aadd0000-0000-4000-8000-000000000003', 'aaee0000-0000-4000-8000-0000000000a1', 'coordinador', '2025-09-01');

-- ── Jugador P (hijo del tutor T), en el roster del equipo ────────────────────────────
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('aaff0000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000a1', 'Pau', 'Test', '2015-05-05');
insert into public.team_members (player_id, team_id, joined_at) values
  ('aaff0000-0000-4000-8000-000000000001', 'aaee0000-0000-4000-8000-0000000000a1', '2025-09-01');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('aaff0000-0000-4000-8000-000000000001', 'aaaa0000-0000-4000-8000-000000000004', 'guardian');

-- ══════════════════════════════════ C0 · baseline activo ════════════════════════════
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is distinct from 'director' then
    raise exception 'FAIL[C0a]: director activo debería dar rol director';
  end if;
end $$;
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ begin
  if not public.user_is_staff_of_team('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C0b]: coordinador activo debería ser staff del equipo';
  end if;
  if not public.user_coordinates_team('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C0c]: coordinador activo debería coordinar el equipo';
  end if;
end $$;
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is distinct from 'jugador' then
    raise exception 'FAIL[C0d]: tutor activo debería dar rol jugador';
  end if;
  if not public.user_is_team_member_account('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C0e]: tutor activo debería tener acceso al equipo del hijo';
  end if;
end $$;

-- ══════════════════════════════════ C1 · director de baja ═══════════════════════════
update public.memberships set left_at = current_date
 where profile_id='aaaa0000-0000-4000-8000-000000000002' and club_id='aa000000-0000-4000-8000-0000000000a1';
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is not null then
    raise exception 'FAIL[C1a]: director de baja debería dar rol NULL';
  end if;
  if public.profile_is_staff_of_club('aaaa0000-0000-4000-8000-000000000002','aa000000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C1b]: director de baja no debería ser staff del club';
  end if;
end $$;

-- ══════════════════════ C2 · coordinador de baja con team_staff activo ═══════════════
update public.memberships set left_at = current_date
 where profile_id='aaaa0000-0000-4000-8000-000000000003' and club_id='aa000000-0000-4000-8000-0000000000a1';
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000003","role":"authenticated"}';
do $$ begin
  if public.user_is_staff_of_team('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C2a]: coordinador de baja no debería ser staff del equipo (aunque team_staff siga abierto)';
  end if;
  if public.user_coordinates_team('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C2b]: coordinador de baja no debería coordinar el equipo';
  end if;
  if exists (select 1 from public.team_chat_member_profile_ids('aaee0000-0000-4000-8000-0000000000a1') x
              where x='aaaa0000-0000-4000-8000-000000000003') then
    raise exception 'FAIL[C2c]: coordinador de baja no debería estar en el fan-out del chat';
  end if;
end $$;

-- ══════════════════ C3 · baja DEPORTIVA del hijo NO afecta al tutor ══════════════════
update public.players set left_club_at = current_date
 where id='aaff0000-0000-4000-8000-000000000001';
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is distinct from 'jugador' then
    raise exception 'FAIL[C3a]: baja deportiva del hijo no debería cambiar el rol del tutor';
  end if;
  if not public.user_is_team_member_account('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C3b]: baja deportiva del hijo no debería quitar acceso al tutor';
  end if;
end $$;

-- ══════════════════════════════ C4 · tutor de baja (membership) ══════════════════════
update public.memberships set left_at = current_date
 where profile_id='aaaa0000-0000-4000-8000-000000000004' and club_id='aa000000-0000-4000-8000-0000000000a1';
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is not null then
    raise exception 'FAIL[C4a]: tutor de baja debería dar rol NULL';
  end if;
  if public.user_is_team_member_account('aaee0000-0000-4000-8000-0000000000a1') then
    raise exception 'FAIL[C4b]: tutor de baja no debería tener acceso al equipo del hijo';
  end if;
  if exists (select 1 from public.team_chat_member_profile_ids('aaee0000-0000-4000-8000-0000000000a1') x
              where x='aaaa0000-0000-4000-8000-000000000004') then
    raise exception 'FAIL[C4c]: tutor de baja no debería estar en el fan-out del chat';
  end if;
end $$;

-- ══════════════════ C5 · superadmin con membership de baja sigue admin ═══════════════
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000005","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is distinct from 'admin_club' then
    raise exception 'FAIL[C5]: superadmin debería seguir siendo admin_club pese a su membership de baja';
  end if;
end $$;

-- ══════════════════════════════ C6 · reactivar restaura ═════════════════════════════
update public.memberships set left_at = null
 where profile_id='aaaa0000-0000-4000-8000-000000000002' and club_id='aa000000-0000-4000-8000-0000000000a1';
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is distinct from 'director' then
    raise exception 'FAIL[C6]: reactivar (left_at NULL) debería restaurar el rol director';
  end if;
end $$;

-- ══════════════════════════════ C7 · control activo intacto ═════════════════════════
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000006","role":"authenticated"}';
do $$ begin
  if public.user_role_in_club('aa000000-0000-4000-8000-0000000000a1') is distinct from 'director' then
    raise exception 'FAIL[C7]: el director control activo no debería verse afectado';
  end if;
end $$;

-- ════════════════ C8 · acción: director de baja NO puede cambiar roles ═══════════════
-- (Alicia-equivalente D está reactivada; la re-doy de baja para el test de acción.)
update public.memberships set left_at = current_date
 where profile_id='aaaa0000-0000-4000-8000-000000000002' and club_id='aa000000-0000-4000-8000-0000000000a1';
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.admin_update_staff_role(
    'aa000000-0000-4000-8000-0000000000a1',
    'aaaa0000-0000-4000-8000-000000000003', 'entrenador_ayudante');
  raise exception 'FAIL[C8]: un director de baja NO debería poder cambiar roles (no lanzó)';
exception
  when sqlstate 'P0001' then
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL[C8]: se esperaba forbidden, llegó "%"', sqlerrm;
    end if;
end $$;

-- ════════════ C9 · acción solo-admin: admin_club de BAJA (no superadmin) ═════════════
set local "request.jwt.claims" = '{"sub":"aaaa0000-0000-4000-8000-000000000007","role":"authenticated"}';
do $$
begin
  perform public.open_next_season('aa000000-0000-4000-8000-0000000000b1');
  raise exception 'FAIL[C9]: un admin_club de baja NO debería poder abrir temporada (no lanzó)';
exception
  when sqlstate 'P0001' then
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL[C9]: se esperaba forbidden, llegó "%"', sqlerrm;
    end if;
end $$;

-- ════════════════════ INV · ningún tutor sin membership en el club ══════════════════
do $$
declare v_orphans int;
begin
  select count(*) into v_orphans
    from public.player_accounts pa
    join public.players pl on pl.id = pa.player_id
    left join public.memberships m on m.profile_id = pa.profile_id and m.club_id = pl.club_id
   where m.id is null;
  if v_orphans <> 0 then
    raise exception 'FAIL[INV]: hay % tutor(es) sin membership en el club del hijo (rompería el join de user_is_team_member_account)', v_orphans;
  end if;
end $$;

rollback;
