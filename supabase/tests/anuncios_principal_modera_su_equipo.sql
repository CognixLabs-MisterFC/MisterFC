-- El principal del equipo modera los anuncios de SU equipo.
-- Verifica la migración 20261114000000_anuncios_el_principal_modera_su_equipo.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise 'FAIL[...]'; el rol y el
-- `auth.uid()` se cambian con set_config('role'|'request.jwt.claims', …, true) DENTRO del
-- bloque y se vuelve a 'postgres' antes de afirmar, para que la aserción lea sin RLS.
--
-- EL PUNTO DE TODO ESTO está en el fixture: P, O y X tienen rol de CLUB
-- `entrenador_ayudante` —el que NO está en la lista de la policy—, y lo único que los
-- distingue es su fila de `team_staff`. Si alguien «arregla» esto metiendo un rol de club
-- en la lista, estos tests siguen verdes y no deberían: por eso ninguno es ayudante de
-- club Y principal de equipo a la vez con el rol alto puesto.
--
-- Nadie es AUTOR de lo que intenta moderar (todos los anuncios de prueba los firma el
-- admin, salvo el de T6): si el autor coincidiera, la rama `author_profile_id = auth.uid()`
-- dejaría pasar la escritura y el test mediría esa rama vieja en vez de la nueva.
--
-- Casos:
--   T1. P (PRINCIPAL de E1) EDITA un anuncio de E1 que no es suyo → 1 fila. Rojo antes.
--   T2. P BORRA un anuncio de E1 que no es suyo → 1 fila. Rojo antes.
--   T3. CONTROL: O (AYUDANTE de E1) intenta editar → 0 filas. Modera el principal, no
--       todo el staff; es la diferencia entre user_is_principal_of_team y
--       user_is_staff_of_team, que es lo que usa el INSERT.
--   T4. CONTROL: P intenta editar un anuncio de E2 (otro equipo) → 0 filas. El permiso es
--       de SU equipo, no del club.
--   T5. CONTROL: P intenta editar un anuncio de CLUB (team_id null) → 0 filas. La rama
--       nueva lleva `team_id is not null`.
--   T6. ANTI-REGRESIÓN: O edita un anuncio SUYO → 1 fila. La rama del autor sigue viva.
--   T7. ANTI-REGRESIÓN: el admin del club modera cualquiera, incluido el de club.
\ir helpers/auth_users.sql

begin;

-- ── Usuarios ─────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('a1aa0000-0000-4000-8000-000000000001', 'apme-admin@test.local', '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('a1aa0000-0000-4000-8000-000000000002', 'apme-p@test.local',     '{"full_name":"Principal E1"}'::jsonb);
select pg_temp.new_test_user('a1aa0000-0000-4000-8000-000000000003', 'apme-o@test.local',     '{"full_name":"Ayudante E1"}'::jsonb);
select pg_temp.new_test_user('a1aa0000-0000-4000-8000-000000000004', 'apme-x@test.local',     '{"full_name":"Principal E2"}'::jsonb);

-- ── Club, categoría, dos equipos ─────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('a1000000-0000-4000-8000-0000000000c1', 'Club APME', 'club-apme');
insert into public.categories (id, club_id, name) values
  ('a1000000-0000-4000-8000-000000000ca1', 'a1000000-0000-4000-8000-0000000000c1', 'Cat APME');
insert into public.teams (id, category_id, name, format, color, season) values
  ('a1000000-0000-4000-8000-000000000701', 'a1000000-0000-4000-8000-000000000ca1', 'Equipo 1', 'F7', '#10B981', '2025-26'),
  ('a1000000-0000-4000-8000-000000000702', 'a1000000-0000-4000-8000-000000000ca1', 'Equipo 2', 'F7', '#10B981', '2025-26');

-- ── Membresías: el admin, y TRES ayudantes de club ───────────────────────────────────
-- `entrenador_ayudante` NO está en la lista de la policy. Es deliberado.
insert into public.memberships (id, profile_id, club_id, role) values
  ('a1dd0000-0000-4000-8000-000000000001','a1aa0000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000c1','admin_club'),
  ('a1dd0000-0000-4000-8000-000000000002','a1aa0000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-0000000000c1','entrenador_ayudante'),
  ('a1dd0000-0000-4000-8000-000000000003','a1aa0000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-0000000000c1','entrenador_ayudante'),
  ('a1dd0000-0000-4000-8000-000000000004','a1aa0000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-0000000000c1','entrenador_ayudante');

-- ── team_staff: lo ÚNICO que distingue a los tres ────────────────────────────────────
insert into public.team_staff (id, team_id, membership_id, staff_role, joined_at) values
  ('a1cc0000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000701','a1dd0000-0000-4000-8000-000000000002','entrenador_principal', date '2026-07-01'),
  ('a1cc0000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000701','a1dd0000-0000-4000-8000-000000000003','entrenador_ayudante',  date '2026-07-01'),
  ('a1cc0000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000702','a1dd0000-0000-4000-8000-000000000004','entrenador_principal', date '2026-07-01');

-- ── Anuncios. Autor = el ADMIN salvo el de T6 ────────────────────────────────────────
insert into public.announcements (id, club_id, team_id, author_profile_id, title, body) values
  ('a1ee0000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-0000000000c1','a1000000-0000-4000-8000-000000000701','a1aa0000-0000-4000-8000-000000000001','E1 · para editar',  'cuerpo'),
  ('a1ee0000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-0000000000c1','a1000000-0000-4000-8000-000000000701','a1aa0000-0000-4000-8000-000000000001','E1 · para borrar',  'cuerpo'),
  ('a1ee0000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-0000000000c1','a1000000-0000-4000-8000-000000000701','a1aa0000-0000-4000-8000-000000000001','E1 · para el ayudante', 'cuerpo'),
  ('a1ee0000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-0000000000c1','a1000000-0000-4000-8000-000000000702','a1aa0000-0000-4000-8000-000000000001','E2 · ajeno',        'cuerpo'),
  ('a1ee0000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-0000000000c1', null,                                 'a1aa0000-0000-4000-8000-000000000001','Club · global',     'cuerpo'),
  ('a1ee0000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-0000000000c1','a1000000-0000-4000-8000-000000000701','a1aa0000-0000-4000-8000-000000000003','E1 · del ayudante', 'cuerpo');

-- ══════════ T1 · el PRINCIPAL edita un anuncio de SU equipo que no es suyo ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.announcements set title = 'editado por el principal'
   where id = 'a1ee0000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T1]: el PRINCIPAL de E1 debía poder EDITAR un anuncio de su equipo (filas=%)', n;
  end if;
  if not exists (
    select 1 from public.announcements
     where id = 'a1ee0000-0000-4000-8000-000000000001' and title = 'editado por el principal'
  ) then raise exception 'FAIL[T1]: la fila no quedó editada'; end if;
end $$;

-- ══════════ T2 · el PRINCIPAL borra un anuncio de SU equipo que no es suyo ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  delete from public.announcements where id = 'a1ee0000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T2]: el PRINCIPAL de E1 debía poder BORRAR un anuncio de su equipo (filas=%)', n;
  end if;
  if exists (select 1 from public.announcements where id = 'a1ee0000-0000-4000-8000-000000000002') then
    raise exception 'FAIL[T2]: la fila sigue ahí';
  end if;
end $$;

-- ══════════ T3 · CONTROL: el AYUDANTE del mismo equipo NO modera ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  update public.announcements set title = 'editado por el ayudante'
   where id = 'a1ee0000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then
    raise exception 'FAIL[T3]: el AYUDANTE no debía poder moderar (filas=%). La rama nueva pide PRINCIPAL, no staff', n;
  end if;
end $$;

-- ══════════ T4 · CONTROL: el principal de E1 no toca E2 ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.announcements set title = 'editado desde fuera'
   where id = 'a1ee0000-0000-4000-8000-000000000004';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then
    raise exception 'FAIL[T4]: el principal de E1 no debía poder editar un anuncio de E2 (filas=%)', n;
  end if;
end $$;

-- ══════════ T5 · CONTROL: el anuncio de CLUB (team_id null) no es suyo ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.announcements set title = 'editado el global'
   where id = 'a1ee0000-0000-4000-8000-000000000005';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then
    raise exception 'FAIL[T5]: un anuncio de CLUB no lo modera el principal de un equipo (filas=%)', n;
  end if;
end $$;

-- ══════════ T6 · ANTI-REGRESIÓN: la rama del AUTOR sigue viva ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  update public.announcements set title = 'el ayudante edita el suyo'
   where id = 'a1ee0000-0000-4000-8000-000000000006';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T6]: el autor debía seguir pudiendo editar lo suyo (filas=%)', n;
  end if;
end $$;

-- ══════════ T7 · ANTI-REGRESIÓN: el admin del club sigue moderando todo ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"a1aa0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  update public.announcements set title = 'moderado por el admin'
   where id in ('a1ee0000-0000-4000-8000-000000000005', 'a1ee0000-0000-4000-8000-000000000006');
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 2 then
    raise exception 'FAIL[T7]: el admin del club debía moderar el global y el del ayudante (filas=%)', n;
  end if;
end $$;

rollback;
