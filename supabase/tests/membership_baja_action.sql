-- Baja de miembros · Paso 4a+4b — LA ACCIÓN. Verifica set_membership_left (autorización
-- A2 + guardas + reversibilidad + idempotencia) y el arreglo del re-invite en
-- accept_pending_invitations (ON CONFLICT reactiva y decide el rol por left_at).
-- Migración 20261051000000_membership_baja_action.sql, sobre 20261049 (columna left_at)
-- y 20261050 (enforcement).
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception 'FAIL[...]'.
-- auth.uid() se fija con `set local "request.jwt.claims"`. Los casos que esperan error
-- capturan sqlstate P0001 y comprueban el MENSAJE exacto (un fallo silencioso — no lanzar
-- o lanzar otra cosa — se convierte en FAIL).
--
-- Fixture: Club con admin, dos directores (D, D2), un entrenador ayudante (E), un tutor
-- (T, membership jugador) y un segundo ayudante ACTIVO (E2, para P10); temporada activa
-- (la exige accept_pending_invitations). Sin legal_documents: accept no pide consents.
--
-- Casos (P0–P10):
--   P0.  entrenador intenta dar de baja            → forbidden (caller gate).
--   P1.  director da de baja a un coach            → OK (left_at + razón interna).
--   P2.  reactivar (admin)                         → left_at NULL y razón limpia.
--   P3.  idempotente (baja ×2 misma fecha)         → mismo left_at.
--   P4.  director da de baja al admin              → admin_immutable.
--   P5.  director se da de baja a sí mismo         → cannot_leave_self.
--   P6.  director da de baja a OTRO director       → forbidden_requires_admin.
--   P7.  admin da de baja a un director            → OK.
--   P8.  director da de baja a un tutor            → OK (A2).
--   P9.  re-invitar a un DE BAJA con rol nuevo     → reactiva y ADOPTA el rol invitado.
--   P10. ACTIVO re-acepta con rol distinto         → CONSERVA su rol (decisión B).
--        P9+P10 juntas demuestran que el CASE discrimina por left_at.
\ir helpers/auth_users.sql

begin;

-- ── Usuarios (crea auth.users + profiles vía trigger) ────────────────────────────────
select pg_temp.new_test_user('baaa0000-0000-4000-8000-000000000001', 'mba-admin@test.local',  '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('baaa0000-0000-4000-8000-000000000002', 'mba-dir@test.local',    '{"full_name":"Director D"}'::jsonb);
select pg_temp.new_test_user('baaa0000-0000-4000-8000-000000000003', 'mba-dir2@test.local',   '{"full_name":"Director D2"}'::jsonb);
select pg_temp.new_test_user('baaa0000-0000-4000-8000-000000000004', 'mba-coach@test.local',  '{"full_name":"Ayudante E"}'::jsonb);
select pg_temp.new_test_user('baaa0000-0000-4000-8000-000000000005', 'mba-tutor@test.local',  '{"full_name":"Tutor T"}'::jsonb);
select pg_temp.new_test_user('baaa0000-0000-4000-8000-000000000006', 'mba-active@test.local', '{"full_name":"Ayudante E2"}'::jsonb);

-- ── Club, memberships (todas ACTIVAS de inicio), temporada activa ────────────────────
insert into public.clubs (id, name, slug) values
  ('ba000000-0000-4000-8000-0000000000c1', 'Club MBA', 'club-mba');
insert into public.memberships (id, profile_id, club_id, role, left_at) values
  ('badd0000-0000-4000-8000-000000000001','baaa0000-0000-4000-8000-000000000001','ba000000-0000-4000-8000-0000000000c1','admin_club',          null),
  ('badd0000-0000-4000-8000-000000000002','baaa0000-0000-4000-8000-000000000002','ba000000-0000-4000-8000-0000000000c1','director',            null),
  ('badd0000-0000-4000-8000-000000000003','baaa0000-0000-4000-8000-000000000003','ba000000-0000-4000-8000-0000000000c1','director',            null),
  ('badd0000-0000-4000-8000-000000000004','baaa0000-0000-4000-8000-000000000004','ba000000-0000-4000-8000-0000000000c1','entrenador_ayudante', null),
  ('badd0000-0000-4000-8000-000000000005','baaa0000-0000-4000-8000-000000000005','ba000000-0000-4000-8000-0000000000c1','jugador',             null),
  ('badd0000-0000-4000-8000-000000000006','baaa0000-0000-4000-8000-000000000006','ba000000-0000-4000-8000-0000000000c1','entrenador_ayudante', null);
insert into public.seasons (club_id, label, status) values
  ('ba000000-0000-4000-8000-0000000000c1', '2025-26', 'active');

-- ══════════════════════ P0 · entrenador NO puede dar de baja ═════════════════════════
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
declare v_thrown boolean := false;
begin
  begin
    perform public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000005', current_date, 'x');
  exception when sqlstate 'P0001' then
    v_thrown := true;
    if sqlerrm <> 'forbidden' then raise exception 'FAIL[P0]: esperaba forbidden, obtuve %', sqlerrm; end if;
  end;
  if not v_thrown then raise exception 'FAIL[P0]: un entrenador NO debería poder dar de baja (no lanzó)'; end if;
end $$;

-- ══════════════════════ P1 · director da de baja a un coach → OK ═════════════════════
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000004', current_date, 'motivo interno');
do $$ begin
  if not exists (
    select 1 from public.memberships
     where id='badd0000-0000-4000-8000-000000000004' and left_at is not null and left_reason='motivo interno'
  ) then raise exception 'FAIL[P1]: director debería poder dar de baja a un coach (left_at + razón)'; end if;
end $$;

-- ══════════════════════ P2 · reactivar (admin) → left_at/razón NULL ══════════════════
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000004', null, null);
do $$ begin
  if not exists (
    select 1 from public.memberships
     where id='badd0000-0000-4000-8000-000000000004' and left_at is null and left_reason is null
  ) then raise exception 'FAIL[P2]: reactivar debería dejar left_at NULL y razón NULL'; end if;
end $$;

-- ══════════════════════ P3 · idempotente (baja ×2 misma fecha) ═══════════════════════
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000004', date '2026-09-01', 'r');
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000004', date '2026-09-01', 'r');
do $$ begin
  if not exists (
    select 1 from public.memberships
     where id='badd0000-0000-4000-8000-000000000004' and left_at = date '2026-09-01'
  ) then raise exception 'FAIL[P3]: dar de baja dos veces debería ser idempotente'; end if;
end $$;

-- ══════════════════════ P4 · director → admin → admin_immutable ══════════════════════
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare v_thrown boolean := false;
begin
  begin
    perform public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000001', current_date, null);
  exception when sqlstate 'P0001' then
    v_thrown := true;
    if sqlerrm <> 'admin_immutable' then raise exception 'FAIL[P4]: esperaba admin_immutable, obtuve %', sqlerrm; end if;
  end;
  if not v_thrown then raise exception 'FAIL[P4]: al admin_club NO se le da de baja (no lanzó)'; end if;
end $$;

-- ══════════════════════ P5 · director → sí mismo → cannot_leave_self ═════════════════
do $$
declare v_thrown boolean := false;
begin
  begin
    perform public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000002', current_date, null);
  exception when sqlstate 'P0001' then
    v_thrown := true;
    if sqlerrm <> 'cannot_leave_self' then raise exception 'FAIL[P5]: esperaba cannot_leave_self, obtuve %', sqlerrm; end if;
  end;
  if not v_thrown then raise exception 'FAIL[P5]: nadie se da de baja a sí mismo (no lanzó)'; end if;
end $$;

-- ══════════════════════ P6 · director → otro director → forbidden_requires_admin ═════
do $$
declare v_thrown boolean := false;
begin
  begin
    perform public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000003', current_date, null);
  exception when sqlstate 'P0001' then
    v_thrown := true;
    if sqlerrm <> 'forbidden_requires_admin' then raise exception 'FAIL[P6]: esperaba forbidden_requires_admin, obtuve %', sqlerrm; end if;
  end;
  if not v_thrown then raise exception 'FAIL[P6]: un director NO puede con otro director (no lanzó)'; end if;
end $$;

-- ══════════════════════ P7 · admin → director → OK ══════════════════════════════════
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000003', current_date, 'x');
do $$ begin
  if not exists (
    select 1 from public.memberships where id='badd0000-0000-4000-8000-000000000003' and left_at is not null
  ) then raise exception 'FAIL[P7]: el admin_club debería poder dar de baja a un director'; end if;
end $$;

-- ══════════════════════ P8 · director → tutor → OK (A2) ═════════════════════════════
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000002","role":"authenticated"}';
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000005', current_date, 'x');
do $$ begin
  if not exists (
    select 1 from public.memberships where id='badd0000-0000-4000-8000-000000000005' and left_at is not null
  ) then raise exception 'FAIL[P8]: un director debería poder dar de baja a un tutor'; end if;
end $$;

-- ══════════ P9 · re-invitar a un DE BAJA con rol nuevo → reactiva + ADOPTA rol ═══════
-- Deja al ayudante E de baja (admin), luego una invitación con rol NUEVO principal.
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000001","role":"authenticated"}';
select public.set_membership_left('ba000000-0000-4000-8000-0000000000c1','baaa0000-0000-4000-8000-000000000004', current_date, 'baja previa');
insert into public.invitations (id, email, club_id, role, token, expires_at) values
  ('bacc0000-0000-4000-8000-000000000001','mba-coach@test.local','ba000000-0000-4000-8000-0000000000c1','entrenador_principal','bacc0000-0000-4000-8000-0000000000a1', now()+interval '7 days');
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000004","role":"authenticated"}';
select public.accept_pending_invitations('bacc0000-0000-4000-8000-0000000000a1', true, true);
do $$ begin
  if not exists (
    select 1 from public.memberships
     where id='badd0000-0000-4000-8000-000000000004'
       and left_at is null and left_reason is null and role='entrenador_principal'
  ) then raise exception 'FAIL[P9]: re-invitar a un de baja debería reactivar y adoptar el rol invitado'; end if;
end $$;

-- ══════════ P10 · ACTIVO re-acepta con rol distinto → CONSERVA su rol (B) ════════════
-- El ayudante E2 está ACTIVO. Le llega una invitación con rol DISTINTO (principal).
insert into public.invitations (id, email, club_id, role, token, expires_at) values
  ('bacc0000-0000-4000-8000-000000000002','mba-active@test.local','ba000000-0000-4000-8000-0000000000c1','entrenador_principal','bacc0000-0000-4000-8000-0000000000a2', now()+interval '7 days');
set local "request.jwt.claims" = '{"sub":"baaa0000-0000-4000-8000-000000000006","role":"authenticated"}';
select public.accept_pending_invitations('bacc0000-0000-4000-8000-0000000000a2', true, true);
do $$ begin
  if not exists (
    select 1 from public.memberships
     where id='badd0000-0000-4000-8000-000000000006' and left_at is null and role='entrenador_ayudante'
  ) then raise exception 'FAIL[P10]: un miembro ACTIVO que re-acepta debería conservar su rol'; end if;
end $$;

rollback;
