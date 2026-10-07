-- El principal DE BAJA no manda: user_is_principal_of_team mira m.left_at.
-- Verifica la migración 20261115000000_el_principal_de_baja_no_manda.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise 'FAIL[...]'. El rol y el
-- auth.uid() se cambian con set_config(…, true) DENTRO del bloque.
--
-- EL FIXTURE ES EL CASO: B tiene la membresía del club CERRADA y su fila de `team_staff`
-- de principal ABIERTA. Esa combinación se escribe A MANO a propósito, porque es
-- exactamente lo que NO produce `set_membership_left` (que cierra las asignaciones) y SÍ
-- produce un `update memberships set left_at` directo, que es como se cierran hoy las
-- membresías. Si algún día un trigger impide el colgante, este fixture dejará de poder
-- construirse y el test lo dirá: mejor que enterarse por la vía de un permiso de más.
--
-- Los tres personajes miden las tres condiciones del predicado, una cada uno:
--   P — membresía VIVA  + asignación ABIERTA + principal  → manda
--   B — membresía CERRADA + asignación ABIERTA + principal → NO manda  (lo nuevo)
--   C — membresía VIVA  + asignación CERRADA + principal  → NO manda  (ya era así)
--
-- Casos:
--   T1. El predicado, directo: true para P, false para B, false para C.
--   T2. announcements (las dos políticas de #761): P edita un anuncio de E1 que no es
--       suyo; B no puede.
--   T3. invitations (la política que ya usaba el helper): P ve la invitación del equipo;
--       B no la ve.
--   T4. ANTI-REGRESIÓN de T3: B SIGUE viendo la invitación que creó ÉL (rama created_by).
--       Sin esto, T3 podría estar midiendo que B se ha quedado ciego del todo, que no es
--       lo que se pide.
--   T5. ANTI-REGRESIÓN: el admin del club sigue viendo las invitaciones del club.
\ir helpers/auth_users.sql

begin;

-- ── Usuarios ─────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('b1aa0000-0000-4000-8000-000000000001', 'pdbn-admin@test.local', '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('b1aa0000-0000-4000-8000-000000000002', 'pdbn-p@test.local',     '{"full_name":"Principal vivo"}'::jsonb);
select pg_temp.new_test_user('b1aa0000-0000-4000-8000-000000000003', 'pdbn-b@test.local',     '{"full_name":"Principal de baja"}'::jsonb);
select pg_temp.new_test_user('b1aa0000-0000-4000-8000-000000000004', 'pdbn-c@test.local',     '{"full_name":"Principal retirado del equipo"}'::jsonb);

-- ── Club, categoría, equipo ──────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('b1000000-0000-4000-8000-0000000000c1', 'Club PDBN', 'club-pdbn');
insert into public.categories (id, club_id, name) values
  ('b1000000-0000-4000-8000-000000000ca1', 'b1000000-0000-4000-8000-0000000000c1', 'Cat PDBN');
insert into public.teams (id, category_id, name, format, color, season) values
  ('b1000000-0000-4000-8000-000000000701', 'b1000000-0000-4000-8000-000000000ca1', 'Equipo 1', 'F7', '#10B981', '2025-26');

-- ── Membresías: B CERRADA (la baja a mano), el resto vivas ───────────────────────────
insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('b1dd0000-0000-4000-8000-000000000001','b1aa0000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-0000000000c1','admin_club',          null),
  ('b1dd0000-0000-4000-8000-000000000002','b1aa0000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-0000000000c1','entrenador_ayudante', null),
  ('b1dd0000-0000-4000-8000-000000000003','b1aa0000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-0000000000c1','entrenador_ayudante', date '2026-09-01'),
  ('b1dd0000-0000-4000-8000-000000000004','b1aa0000-0000-4000-8000-000000000004','b1000000-0000-4000-8000-0000000000c1','entrenador_ayudante', null);

-- ── team_staff: el COLGANTE de B es el punto del test ────────────────────────────────
insert into public.team_staff (id, team_id, membership_id, staff_role, joined_at, left_at) values
  ('b1cc0000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000701','b1dd0000-0000-4000-8000-000000000002','entrenador_principal', date '2026-07-01', null),
  ('b1cc0000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000701','b1dd0000-0000-4000-8000-000000000003','entrenador_principal', date '2026-07-01', null),
  ('b1cc0000-0000-4000-8000-000000000003','b1000000-0000-4000-8000-000000000701','b1dd0000-0000-4000-8000-000000000004','entrenador_principal', date '2026-07-01', date '2026-08-01');

-- El colgante existe de verdad: si esto falla, el resto del test no mide nada.
do $$ begin
  if not exists (
    select 1 from public.team_staff ts join public.memberships m on m.id = ts.membership_id
     where ts.id = 'b1cc0000-0000-4000-8000-000000000002'
       and ts.left_at is null and m.left_at is not null
  ) then raise exception 'FAIL[fixture]: el colgante de B no se ha podido construir (asignacion abierta + membresia cerrada)'; end if;
end $$;

-- ── Un anuncio del equipo, firmado por el admin, y dos invitaciones ──────────────────
insert into public.announcements (id, club_id, team_id, author_profile_id, title, body) values
  ('b1ee0000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-0000000000c1','b1000000-0000-4000-8000-000000000701','b1aa0000-0000-4000-8000-000000000001','E1 · del admin','cuerpo');

-- INV1: la crea el ADMIN y va a un correo de nadie del fixture → para P/B solo puede
-- entrar por la rama del principal. INV2: la crea B → su rama created_by.
insert into public.invitations (id, email, club_id, role, team_id, created_by) values
  ('b1ff0000-0000-4000-8000-000000000001','pdbn-tercero@test.local','b1000000-0000-4000-8000-0000000000c1','entrenador_ayudante','b1000000-0000-4000-8000-000000000701','b1aa0000-0000-4000-8000-000000000001'),
  ('b1ff0000-0000-4000-8000-000000000002','pdbn-cuarto@test.local', 'b1000000-0000-4000-8000-0000000000c1','entrenador_ayudante','b1000000-0000-4000-8000-000000000701','b1aa0000-0000-4000-8000-000000000003');

-- ══════════ T1 · el predicado, directo ══════════
-- Solo se cambia la reclamación del JWT: auth.uid() la lee sea cual sea el rol, así que
-- esto mide la FUNCION sin meter por medio los privilegios de ejecución.
do $$
declare v_p boolean; v_b boolean; v_c boolean;
begin
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  select public.user_is_principal_of_team('b1000000-0000-4000-8000-000000000701') into v_p;
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select public.user_is_principal_of_team('b1000000-0000-4000-8000-000000000701') into v_b;
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000004","role":"authenticated"}', true);
  select public.user_is_principal_of_team('b1000000-0000-4000-8000-000000000701') into v_c;

  if v_p is not true then raise exception 'FAIL[T1]: el principal con membresia VIVA debia dar true'; end if;
  if v_b is not false then raise exception 'FAIL[T1]: el principal DE BAJA con la asignacion colgando debia dar false (es el arreglo)'; end if;
  if v_c is not false then raise exception 'FAIL[T1]: el principal con la asignacion CERRADA debia dar false (ya era asi)'; end if;
end $$;

-- ══════════ T2 · announcements: P modera, B no ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.announcements set title = 'editado por el principal vivo'
   where id = 'b1ee0000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception 'FAIL[T2]: el principal VIVO debia poder moderar (filas=%)', n; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  update public.announcements set title = 'editado por el de baja'
   where id = 'b1ee0000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception 'FAIL[T2]: el principal DE BAJA no debia poder moderar (filas=%)', n; end if;
end $$;

-- ══════════ T3 · invitations: P la ve, B no ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  select count(*) into n from public.invitations where id = 'b1ff0000-0000-4000-8000-000000000001';
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception 'FAIL[T3]: el principal VIVO debia ver la invitacion de su equipo (filas=%)', n; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into n from public.invitations where id = 'b1ff0000-0000-4000-8000-000000000001';
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception 'FAIL[T3]: el principal DE BAJA no debia ver la invitacion del equipo (filas=%)', n; end if;
end $$;

-- ══════════ T4 · ANTI-REGRESION: B sigue viendo LO SUYO ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000003","role":"authenticated"}', true);
  select count(*) into n from public.invitations where id = 'b1ff0000-0000-4000-8000-000000000002';
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T4]: B debia seguir viendo la invitacion que creo EL (rama created_by); si no, T3 mide ceguera total y no la rama del principal (filas=%)', n;
  end if;
end $$;

-- ══════════ T5 · ANTI-REGRESION: el admin del club sigue viendo ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"b1aa0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  select count(*) into n from public.invitations
   where id in ('b1ff0000-0000-4000-8000-000000000001','b1ff0000-0000-4000-8000-000000000002');
  perform set_config('role', 'postgres', true);
  if n <> 2 then raise exception 'FAIL[T5]: el admin del club debia ver las dos invitaciones (filas=%)', n; end if;
end $$;

rollback;
