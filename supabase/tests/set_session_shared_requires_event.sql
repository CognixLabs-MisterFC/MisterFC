-- Punto 1 QA — set_session_shared: compartir una sesión SOLO si está asignada a un
-- entrenamiento (event_id no nulo). Cubre:
--   T1  compartir una sesión SUELTA (event_id NULL) → falla (session_not_assigned).
--   T2  compartir una sesión ASIGNADA (event_id no nulo) → OK (visibility='team').
--   T3  compartir una PLANTILLA → sigue fallando (template_not_shareable).
--   T4  DESCOMPARTIR una suelta ya compartida (legacy) → permitido (el guard solo
--       aplica a p_shared=true).
-- Migración 20261043000000_o2_session_share_requires_event. Gate del RPC =
-- staff del equipo ∪ admin/director ∪ superadmin: el actor es el PRINCIPAL del equipo.
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('5ec00000-0000-4000-8000-000000000001', 'Club Share A', 'club-share-a');

insert into public.categories (id, club_id, name) values
  ('5eca0000-0000-4000-8000-000000000001', '5ec00000-0000-4000-8000-000000000001', 'Cat A');

insert into public.teams (id, category_id, name, format, color, season) values
  ('5e700000-0000-4000-8000-000000000001', '5eca0000-0000-4000-8000-000000000001', 'Team A', 'F11', '#10B981', '2025-26');

select pg_temp.new_test_user('5ea00000-0000-4000-8000-00000000000c', 'coachP@share.test', '{}'::jsonb);

-- coachP: rol de club ayudante pero PRINCIPAL de Team A → staff del equipo (pasa el gate).
insert into public.memberships (id, profile_id, club_id, role) values
  ('5e550000-0000-4000-8000-00000000000c', '5ea00000-0000-4000-8000-00000000000c', '5ec00000-0000-4000-8000-000000000001', 'entrenador_ayudante');
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('5e700000-0000-4000-8000-000000000001', '5e550000-0000-4000-8000-00000000000c', 'entrenador_principal');

-- Entrenamiento de Team A → aporta el event_id para la sesión ASIGNADA.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('5e600000-0000-4000-8000-000000000001', '5ec00000-0000-4000-8000-000000000001', '5e700000-0000-4000-8000-000000000001',
   'training', 'Entreno A', '2026-10-02 18:00:00+00', '5ea00000-0000-4000-8000-00000000000c');

-- Tres sesiones (triggers off para sembrar valores directos):
--   c1 = ASIGNADA (event_id), c2 = SUELTA (event_id NULL), c3 = PLANTILLA (team NULL).
alter table public.sessions disable trigger trg_sessions_validate;
insert into public.sessions (id, owner_profile_id, club_id, team_id, event_id, session_date, visibility, is_template) values
  ('5e500000-0000-4000-8000-0000000000c1', '5ea00000-0000-4000-8000-00000000000c', '5ec00000-0000-4000-8000-000000000001', '5e700000-0000-4000-8000-000000000001', '5e600000-0000-4000-8000-000000000001', '2026-10-02', 'staff', false),
  ('5e500000-0000-4000-8000-0000000000c2', '5ea00000-0000-4000-8000-00000000000c', '5ec00000-0000-4000-8000-000000000001', '5e700000-0000-4000-8000-000000000001', null, '2026-10-05', 'staff', false),
  ('5e500000-0000-4000-8000-0000000000c3', '5ea00000-0000-4000-8000-00000000000c', '5ec00000-0000-4000-8000-000000000001', null, null, null, 'staff', true);
alter table public.sessions enable trigger trg_sessions_validate;

set local role authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: compartir la SUELTA (event_id NULL) → session_not_assigned; NO cambia estado.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false; v text;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    perform public.set_session_shared('5e500000-0000-4000-8000-0000000000c2', true);
  exception when insufficient_privilege then
    ok := (sqlerrm = 'session_not_assigned');
    if not ok then raise exception 'FAIL [T1]: excepción inesperada: %', sqlerrm; end if;
  end;
  if not ok then raise exception 'FAIL [T1]: compartir una sesión suelta NO fue rechazado'; end if;
  select visibility into v from public.sessions where id = '5e500000-0000-4000-8000-0000000000c2';
  if v <> 'staff' then raise exception 'FAIL [T1]: la sesión suelta quedó compartida (v=%)', v; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: compartir la ASIGNADA (event_id no nulo) → OK, visibility='team'.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  perform public.set_session_shared('5e500000-0000-4000-8000-0000000000c1', true);
  select visibility into v from public.sessions where id = '5e500000-0000-4000-8000-0000000000c1';
  if v <> 'team' then raise exception 'FAIL [T2]: la sesión asignada no se compartió (v=%)', v; end if;
exception when insufficient_privilege then
  raise exception 'FAIL [T2]: compartir una sesión asignada fue rechazado: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: compartir la PLANTILLA → sigue rechazada (template_not_shareable).
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  begin
    perform public.set_session_shared('5e500000-0000-4000-8000-0000000000c3', true);
  exception when insufficient_privilege then
    ok := (sqlerrm = 'template_not_shareable');
    if not ok then raise exception 'FAIL [T3]: excepción inesperada: %', sqlerrm; end if;
  end;
  if not ok then raise exception 'FAIL [T3]: compartir una plantilla NO fue rechazado'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: DESCOMPARTIR una suelta ya compartida (legacy) → permitido (guard solo aplica
--     a compartir). Se marca 'team' saltando el RPC (dato antiguo) y se descomparte.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v text;
begin
  reset role;  -- postgres: fija el estado legacy sin pasar por RLS/RPC
  update public.sessions set visibility = 'team' where id = '5e500000-0000-4000-8000-0000000000c2';
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"5ea00000-0000-4000-8000-00000000000c","role":"authenticated"}';
  perform public.set_session_shared('5e500000-0000-4000-8000-0000000000c2', false);
  select visibility into v from public.sessions where id = '5e500000-0000-4000-8000-0000000000c2';
  if v <> 'staff' then raise exception 'FAIL [T4]: no se pudo descompartir la sesión suelta (v=%)', v; end if;
exception when insufficient_privilege then
  raise exception 'FAIL [T4]: descompartir una sesión suelta fue rechazado: %', sqlerrm;
end $$;

reset role;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests set_session_shared: compartir exige entrenamiento (event_id) pasaron.'
\echo '──────────────────────────────────────────────'
