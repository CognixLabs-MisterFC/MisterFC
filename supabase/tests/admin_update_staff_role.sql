-- Bug 2 · 2b — verifica admin_update_staff_role.
-- Migración 20260714000000_bug2b_admin_update_staff_role.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club A con admin, coordinador y un entrenador (target). Club B con su
-- propio admin y un entrenador (para el caso cross-club).
--
-- Casos:
--   F1. admin de A cambia el rol del entrenador de A (principal → ayudante) → ok.
--   G1. no-admin (coordinador de A) → forbidden (no cambia nada).
--   G2. admin de A → target de OTRO club → target_invalid.
--   G3. rol inválido ('superadmin') → role_invalid.
--   L1. GUARDA: admin único degrada a OTRO… no aplica; el caso es degradarse a sí
--       mismo siendo el único admin → would_remove_last_admin (no cambia nada).
--   L2. GUARDA: degradar al único admin (sobre el propio admin) bloqueado — ya
--       cubierto por L1; aquí verificamos que el admin sigue siendo admin_club.
--   L3. promover a un rol ALTO (admin_club) por UPDATE directo → rechazado
--       (high_role_invite_only, F1B2b): los roles altos solo por invitación.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('bb000000-0000-4000-8000-000000000001', 'Club A 2b', 'club-a-2b'),
  ('bb000000-0000-4000-8000-000000000002', 'Club B 2b', 'club-b-2b');

select pg_temp.new_test_user('bb0a0000-aaaa-4000-8000-000000000001', 'a2b-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('bb0a0000-cccc-4000-8000-000000000001', 'a2b-coord@test.local', '{}'::jsonb);
select pg_temp.new_test_user('bb0a0000-eeee-4000-8000-000000000001', 'a2b-coach@test.local', '{}'::jsonb);
select pg_temp.new_test_user('bb0b0000-aaaa-4000-8000-000000000001', 'b2b-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('bb0b0000-eeee-4000-8000-000000000001', 'b2b-coach@test.local', '{}'::jsonb);

insert into public.profiles (id, full_name) values
  ('bb0a0000-aaaa-4000-8000-000000000001', 'Admin A'),
  ('bb0a0000-cccc-4000-8000-000000000001', 'Coord A'),
  ('bb0a0000-eeee-4000-8000-000000000001', 'Coach A'),
  ('bb0b0000-aaaa-4000-8000-000000000001', 'Admin B'),
  ('bb0b0000-eeee-4000-8000-000000000001', 'Coach B')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role) values
  ('bb0a0000-aaaa-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'admin_club'),
  ('bb0a0000-cccc-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'coordinador'),
  ('bb0a0000-eeee-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('bb0b0000-aaaa-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'admin_club'),
  ('bb0b0000-eeee-4000-8000-000000000001', 'bb000000-0000-4000-8000-000000000002', 'entrenador_principal');

-- ── F1. admin de A cambia el rol del entrenador (principal → ayudante) ────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bb0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.admin_update_staff_role(
    'bb000000-0000-4000-8000-000000000001',
    'bb0a0000-eeee-4000-8000-000000000001',
    'entrenador_ayudante'
  );
  if not exists (select 1 from public.memberships
                  where profile_id='bb0a0000-eeee-4000-8000-000000000001'
                    and club_id='bb000000-0000-4000-8000-000000000001'
                    and role='entrenador_ayudante') then
    raise exception 'FAIL [F1]: el rol debería quedar en entrenador_ayudante';
  end if;
end $$;

-- ── G3. rol inválido → role_invalid (no cambia nada) ─────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_role(
      'bb000000-0000-4000-8000-000000000001',
      'bb0a0000-eeee-4000-8000-000000000001',
      'superadmin'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G3]: un rol inválido debería ser rechazado'; end if;
  if not exists (select 1 from public.memberships
                  where profile_id='bb0a0000-eeee-4000-8000-000000000001'
                    and role='entrenador_ayudante') then
    raise exception 'FAIL [G3]: el rol no debería haber cambiado tras el fallo';
  end if;
end $$;

-- ── G1. coordinador de A (no-admin) → forbidden ──────────────────────────────
set local "request.jwt.claims" = '{"sub":"bb0a0000-cccc-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_role(
      'bb000000-0000-4000-8000-000000000001',
      'bb0a0000-eeee-4000-8000-000000000001',
      'entrenador_principal'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: un no-admin NO debería poder cambiar roles'; end if;
end $$;

-- ── G2. admin de A → target de OTRO club → target_invalid ────────────────────
set local "request.jwt.claims" = '{"sub":"bb0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_role(
      'bb000000-0000-4000-8000-000000000001',   -- club A
      'bb0b0000-eeee-4000-8000-000000000001',   -- coach de club B
      'entrenador_ayudante'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2]: cambiar el rol de un miembro de otro club debería fallar (target_invalid)'; end if;
end $$;

-- ── L1/L2. GUARDA: el único admin de A intenta degradarse a sí mismo ─────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_role(
      'bb000000-0000-4000-8000-000000000001',
      'bb0a0000-aaaa-4000-8000-000000000001',   -- el propio admin (único)
      'coordinador'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [L1]: degradar al único admin debería bloquearse (would_remove_last_admin)'; end if;
  -- L2: sigue siendo admin_club.
  if not exists (select 1 from public.memberships
                  where profile_id='bb0a0000-aaaa-4000-8000-000000000001'
                    and club_id='bb000000-0000-4000-8000-000000000001'
                    and role='admin_club') then
    raise exception 'FAIL [L2]: el admin único debería seguir siendo admin_club tras el bloqueo';
  end if;
end $$;

-- ── L3. NO se puede promover a un rol ALTO por UPDATE directo (solo por invitación) ──
-- F15-A2 (EXPECTATIVA actualizada, confirmada por Jose): F1B2b (mig 20260825) y el
-- modelo de roles (un-admin-por-club) → los roles altos (admin_club/director) se
-- asignan SOLO por invitación; admin_update_staff_role rechaza el destino alto con
-- high_role_invite_only. Antes L3 promovía al entrenador a 2º admin y degradaba al 1º;
-- hoy eso es imposible, así que el admin único NO puede auto-degradarse por esta vía
-- (ya cubierto por la GUARDA del último admin en L1).
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_role(
      'bb000000-0000-4000-8000-000000000001',
      'bb0a0000-eeee-4000-8000-000000000001',
      'admin_club'
    );
  exception when others then
    if sqlerrm like '%high_role_invite_only%' then ok := true; else raise; end if;
  end;
  if not ok then
    raise exception 'FAIL [L3]: promover a admin_club por UPDATE directo debería rechazarse (high_role_invite_only)';
  end if;
  -- No se creó un 2º admin: sigue habiendo exactamente 1.
  if (select count(*) from public.memberships
        where club_id='bb000000-0000-4000-8000-000000000001' and role='admin_club') <> 1 then
    raise exception 'FAIL [L3]: no debería haberse creado un 2º admin';
  end if;
end $$;

reset role;

-- G2 (cont.): el miembro del otro club quedó intacto (superuser, sin RLS).
do $$
begin
  if not exists (select 1 from public.memberships
                  where profile_id='bb0b0000-eeee-4000-8000-000000000001'
                    and club_id='bb000000-0000-4000-8000-000000000002'
                    and role='entrenador_principal') then
    raise exception 'FAIL [G2]: el miembro del otro club NO debe cambiar de rol';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Bug2b: admin_update_staff_role (admin cambia el rol de club; gateado, cross-club y rol inválido rechazados; GUARDA del último admin bloquea degradar al único admin, incluido a uno mismo; promover a rol alto por UPDATE directo rechazado — high_role_invite_only).'
\echo '──────────────────────────────────────────────'
