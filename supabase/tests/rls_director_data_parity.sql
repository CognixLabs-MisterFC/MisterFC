-- F1B-1 — Tests RLS: paridad de DATOS del rol 'director' con 'admin_club'.
--
-- Verifica las tres propiedades del barrido comprehensivo de escritura:
--   AISLAMIENTO (crítico): un director del club A NO ve ni escribe datos del club B.
--   EQUIVALENCIA: un director del club A puede ver/gestionar lo mismo que el
--                 admin_club del club A (muestra representativa de dominios).
--   NO-FUGA: un director NO puede crear invitaciones/miembros ni cambiar roles
--            (eso lo bloquea F1B-2; aquí solo verificamos que F1B-1 no lo abrió).
--
-- Estilo house (rls_events.sql): begin … set local jwt.claims … do $$ raise on
-- fail $$ … rollback. Corre por psql contra el remoto (pgTAP no va en CI).

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup: dos clubs A y B, con admin+director en cada uno + un jugador en A.
-- ─────────────────────────────────────────────────────────────────────────────

-- Nota: owner_profile_id se deja NULL (los profiles aún no existen aquí y F1B-1
-- no lo usa; el owner es una marca de F1B-0 sin efecto en la paridad de datos).
insert into public.clubs (id, name, slug) values
  ('f1b10000-aaaa-0000-0000-000000000001', 'Club A F1B', 'club-a-f1b'),
  ('f1b10000-bbbb-0000-0000-000000000001', 'Club B F1B', 'club-b-f1b');

insert into public.club_settings (club_id) values
  ('f1b10000-aaaa-0000-0000-000000000001'),
  ('f1b10000-bbbb-0000-0000-000000000001')
on conflict (club_id) do nothing;

insert into public.categories (id, club_id, name) values
  ('f1b10000-c0a1-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'Cat A'),
  ('f1b10000-c0b1-0000-0000-000000000001', 'f1b10000-bbbb-0000-0000-000000000001', 'Cat B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('f1b10000-7ea1-0000-0000-000000000001', 'f1b10000-c0a1-0000-0000-000000000001', 'Team A', 'F7', '#10B981', '2025-26'),
  ('f1b10000-7eb1-0000-0000-000000000001', 'f1b10000-c0b1-0000-0000-000000000001', 'Team B', 'F7', '#EF4444', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('f1b10000-9111-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'Player', 'A', '2012-01-01'),
  ('f1b10000-9222-0000-0000-000000000001', 'f1b10000-bbbb-0000-0000-000000000001', 'Player', 'B', '2012-01-01');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('f1b10000-0001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-a@f1b.test',    now(), '{}'::jsonb, now(), now()),
  ('f1b10000-0002-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'director-a@f1b.test', now(), '{}'::jsonb, now(), now()),
  ('f1b10000-0004-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-a@f1b.test',  now(), '{}'::jsonb, now(), now()),
  ('f1b10000-0005-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b@f1b.test',    now(), '{}'::jsonb, now(), now()),
  ('f1b10000-0003-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'director-b@f1b.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1b10000-5001-0000-0000-000000000001', 'f1b10000-0001-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'admin_club'),
  ('f1b10000-5002-0000-0000-000000000001', 'f1b10000-0002-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'director'),
  ('f1b10000-5004-0000-0000-000000000001', 'f1b10000-0004-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'jugador'),
  ('f1b10000-5005-0000-0000-000000000001', 'f1b10000-0005-0000-0000-000000000001', 'f1b10000-bbbb-0000-0000-000000000001', 'admin_club'),
  ('f1b10000-5003-0000-0000-000000000001', 'f1b10000-0003-0000-0000-000000000001', 'f1b10000-bbbb-0000-0000-000000000001', 'director');

set local role authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- A. AISLAMIENTO — director del club A NO ve ni escribe datos del club B.
-- ═════════════════════════════════════════════════════════════════════════════

set local "request.jwt.claims" = '{"sub":"f1b10000-0002-0000-0000-000000000001","role":"authenticated"}';

-- A1 — helper: director A NO es admin_or_director de B.
do $$
begin
  if public.user_is_admin_or_director('f1b10000-bbbb-0000-0000-000000000001') then
    raise exception 'FAIL [A1]: director de A pasa como admin_or_director de B';
  end if;
  if not public.user_is_admin_or_director('f1b10000-aaaa-0000-0000-000000000001') then
    raise exception 'FAIL [A1]: director de A NO pasa como admin_or_director de A';
  end if;
end $$;

-- A2 — SELECT cross-club = 0 (categorías, equipos, jugadores, club_settings de B).
do $$
declare c int;
begin
  select count(*) into c from public.categories where club_id = 'f1b10000-bbbb-0000-0000-000000000001';
  if c <> 0 then raise exception 'FAIL [A2]: director A ve categorías de B (%).', c; end if;
  select count(*) into c from public.players where club_id = 'f1b10000-bbbb-0000-0000-000000000001';
  if c <> 0 then raise exception 'FAIL [A2]: director A ve jugadores de B (%).', c; end if;
  select count(*) into c from public.club_settings where club_id = 'f1b10000-bbbb-0000-0000-000000000001';
  if c <> 0 then raise exception 'FAIL [A2]: director A ve club_settings de B (%).', c; end if;
end $$;

-- A3 — INSERT cross-club rechazado (categoría en B).
do $$
begin
  insert into public.categories (club_id, name)
  values ('f1b10000-bbbb-0000-0000-000000000001', 'Cat B intrusa');
  raise exception 'FAIL [A3]: director A pudo INSERT categoría en B';
exception
  when insufficient_privilege or check_violation then null;  -- esperado (RLS)
end $$;

-- A4 — UPDATE cross-club sin efecto (players de B: 0 filas afectadas).
do $$
declare n int;
begin
  update public.players set first_name = 'HACK'
   where club_id = 'f1b10000-bbbb-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [A4]: director A actualizó % jugador(es) de B', n; end if;
end $$;

-- A5 — UPDATE cross-club sin efecto (club B metadata).
do $$
declare n int;
begin
  update public.clubs set name = 'HACK B'
   where id = 'f1b10000-bbbb-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [A5]: director A actualizó el club B (% filas)', n; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- B. EQUIVALENCIA — director del club A gestiona igual que admin del club A.
-- ═════════════════════════════════════════════════════════════════════════════

-- B1 — INSERT categoría en A (escritura core).
do $$
begin
  insert into public.categories (id, club_id, name)
  values ('f1b10000-c0a2-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'Cat A2 por director');
exception when others then
  raise exception 'FAIL [B1]: director A no pudo INSERT categoría en A: % (%).', sqlerrm, sqlstate;
end $$;

-- B2 — INSERT equipo en A.
do $$
begin
  insert into public.teams (id, category_id, name, format, color, season)
  values ('f1b10000-7ea2-0000-0000-000000000001', 'f1b10000-c0a2-0000-0000-000000000001', 'Team A2', 'F7', '#000000', '2025-26');
exception when others then
  raise exception 'FAIL [B2]: director A no pudo INSERT equipo en A: % (%).', sqlerrm, sqlstate;
end $$;

-- B3 — UPDATE jugador en A.
do $$
declare n int;
begin
  update public.players set first_name = 'PlayerEditado'
   where id = 'f1b10000-9111-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [B3]: director A no actualizó al jugador de A (% filas)', n; end if;
end $$;

-- B4 — INSERT season en A (era admin-only).
do $$
begin
  insert into public.seasons (club_id, label)
  values ('f1b10000-aaaa-0000-0000-000000000001', '2026-27');
exception when others then
  raise exception 'FAIL [B4]: director A no pudo INSERT season en A: % (%).', sqlerrm, sqlstate;
end $$;

-- B5 — UPDATE club_settings en A (era admin-only) + SELECT (paridad de lectura).
do $$
declare n int; c int;
begin
  select count(*) into c from public.club_settings where club_id = 'f1b10000-aaaa-0000-0000-000000000001';
  if c <> 1 then raise exception 'FAIL [B5]: director A no ve club_settings de A (%).', c; end if;
  update public.club_settings set evaluations_player_visibility = true
   where club_id = 'f1b10000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [B5]: director A no actualizó club_settings de A (% filas)', n; end if;
end $$;

-- B6 — crear SESIÓN en A (owner = director; user_can_create_sessions).
do $$
begin
  insert into public.sessions (club_id, team_id, owner_profile_id, title, session_date)
  values ('f1b10000-aaaa-0000-0000-000000000001', 'f1b10000-7ea1-0000-0000-000000000001',
          'f1b10000-0002-0000-0000-000000000001', 'Sesión por director', '2026-05-01');
exception when others then
  raise exception 'FAIL [B6]: director A no pudo crear sesión en A: % (%).', sqlerrm, sqlstate;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- C. NO-FUGA — director NO gestiona roles/miembros/invitaciones (Grupo B, F1B-2).
-- ═════════════════════════════════════════════════════════════════════════════

-- C1 — director A NO puede INSERT una membership nueva (crear admin/director).
do $$
begin
  insert into public.memberships (profile_id, club_id, role)
  values ('f1b10000-0004-0000-0000-000000000001', 'f1b10000-aaaa-0000-0000-000000000001', 'director');
  raise exception 'FAIL [C1]: director A pudo INSERT una membership';
exception
  when insufficient_privilege or check_violation or unique_violation then null;  -- esperado
end $$;

-- C2 — director A NO puede crear una invitación.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b10000-aaaa-0000-0000-000000000001', 'nuevo@f1b.test', 'entrenador_principal',
          'f1b10000-0002-0000-0000-000000000001');
  raise exception 'FAIL [C2]: director A pudo crear una invitación';
exception
  when insufficient_privilege or check_violation then null;  -- esperado
end $$;

-- C3 — director A NO puede cambiar roles vía admin_update_staff_role (solo admin).
do $$
begin
  perform public.admin_update_staff_role(
    'f1b10000-aaaa-0000-0000-000000000001',
    'f1b10000-0004-0000-0000-000000000001',
    'coordinador'
  );
  raise exception 'FAIL [C3]: director A pudo cambiar un rol vía admin_update_staff_role';
exception
  when others then
    if sqlerrm not like '%forbidden%' then
      raise exception 'FAIL [C3]: error inesperado (esperaba forbidden): % (%).', sqlerrm, sqlstate;
    end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ F1B-1: aislamiento + equivalencia + no-fuga del rol director OK.'
\echo '──────────────────────────────────────────────'
