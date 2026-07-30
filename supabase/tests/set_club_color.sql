-- O2-1a — verifica set_club_color + CHECK hex + guard clubs_guard_primary_color.
-- Migración 20261039000000_o2_1a_club_color.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La sesión
-- impersona con set local role authenticated + request.jwt.claims.
--
-- Setup: club A con admin, coordinador y director. (El director es clave: tiene
-- UPDATE sobre clubs por RLS -clubs_update_admin usa user_is_admin_or_director-,
-- así que el UPDATE directo LLEGA al trigger y prueba el guard, no la RLS.)
--
-- Casos:
--   F1. admin fija color válido '#1A2B3C' → ok (columna actualizada).
--   G2a. admin fija 'red' (no-hex) → CHECK lo rechaza (no cambia nada).
--   G2b. admin fija '#12345' (5 dígitos) → CHECK lo rechaza (no cambia nada).
--   F2. admin fija NULL → limpia el color (columna NULL).
--   G1. coordinador (no-admin) llama a la RPC → forbidden (no cambia nada).
--   G3. director hace UPDATE DIRECTO de primary_color → bloqueado por el trigger.
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('cc000000-0000-4000-8000-000000000001', 'Club Color', 'club-color-o21a');

select pg_temp.new_test_user('cc0a0000-aaaa-4000-8000-000000000001', 'color-admin@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cc0a0000-cccc-4000-8000-000000000001', 'color-coord@test.local', '{}'::jsonb);
select pg_temp.new_test_user('cc0a0000-dddd-4000-8000-000000000001', 'color-director@test.local', '{}'::jsonb);

insert into public.profiles (id, full_name) values
  ('cc0a0000-aaaa-4000-8000-000000000001', 'Admin Color'),
  ('cc0a0000-cccc-4000-8000-000000000001', 'Coord Color'),
  ('cc0a0000-dddd-4000-8000-000000000001', 'Director Color')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role) values
  ('cc0a0000-aaaa-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'admin_club'),
  ('cc0a0000-cccc-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'coordinador'),
  ('cc0a0000-dddd-4000-8000-000000000001', 'cc000000-0000-4000-8000-000000000001', 'director');

-- ── F1. admin fija un color válido → ok ──────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cc0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.set_club_color('cc000000-0000-4000-8000-000000000001', '#1A2B3C');
  if not exists (select 1 from public.clubs
                  where id='cc000000-0000-4000-8000-000000000001'
                    and primary_color='#1A2B3C') then
    raise exception 'FAIL [F1]: el color debería quedar en #1A2B3C';
  end if;
end $$;

-- ── G2a. admin fija un valor no-hex ('red') → CHECK lo rechaza ────────────────
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_club_color('cc000000-0000-4000-8000-000000000001', 'red');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2a]: un color no-hex debería ser rechazado por el CHECK'; end if;
  if not exists (select 1 from public.clubs
                  where id='cc000000-0000-4000-8000-000000000001'
                    and primary_color='#1A2B3C') then
    raise exception 'FAIL [G2a]: el color no debería haber cambiado tras el fallo';
  end if;
end $$;

-- ── G2b. admin fija un hex incompleto ('#12345', 5 dígitos) → CHECK lo rechaza ─
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_club_color('cc000000-0000-4000-8000-000000000001', '#12345');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2b]: un hex de 5 dígitos debería ser rechazado por el CHECK'; end if;
end $$;

-- ── F2. admin fija NULL → limpia el color ────────────────────────────────────
do $$
begin
  perform public.set_club_color('cc000000-0000-4000-8000-000000000001', NULL);
  if exists (select 1 from public.clubs
              where id='cc000000-0000-4000-8000-000000000001'
                and primary_color is not null) then
    raise exception 'FAIL [F2]: p_color NULL debería dejar primary_color en NULL';
  end if;
end $$;

-- ── G1. coordinador (no-admin) llama a la RPC → forbidden ────────────────────
set local "request.jwt.claims" = '{"sub":"cc0a0000-cccc-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.set_club_color('cc000000-0000-4000-8000-000000000001', '#000000');
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: un no-admin (coordinador) NO debería poder fijar el color'; end if;
  if exists (select 1 from public.clubs
              where id='cc000000-0000-4000-8000-000000000001'
                and primary_color is not null) then
    raise exception 'FAIL [G1]: el color no debería haber cambiado (sigue NULL)';
  end if;
end $$;

-- ── G3. director hace UPDATE DIRECTO de primary_color → bloqueado por el trigger
--     (el director SÍ tiene UPDATE sobre clubs por RLS, así que el bloqueo lo
--      impone el guard clubs_guard_primary_color, no la policy). ───────────────
set local "request.jwt.claims" = '{"sub":"cc0a0000-dddd-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    update public.clubs set primary_color='#ABCDEF'
      where id='cc000000-0000-4000-8000-000000000001';
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G3]: el UPDATE directo de primary_color por el director debería bloquearse (trigger)'; end if;
  if exists (select 1 from public.clubs
              where id='cc000000-0000-4000-8000-000000000001'
                and primary_color is not null) then
    raise exception 'FAIL [G3]: el color no debería haber cambiado tras el bloqueo';
  end if;
end $$;

rollback;
