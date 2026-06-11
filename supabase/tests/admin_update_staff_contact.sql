-- Bug 2 · 2c — verifica admin_update_staff_contact.
-- Migración 20260713000000_bug2c_staff_contact.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception. La
-- función con set local role authenticated + request.jwt.claims.
--
-- Setup: club A con admin, coordinador y un entrenador (target). Club B con su
-- propio admin y un entrenador (para el caso cross-club).
--
-- Casos:
--   F1. admin de A guarda phone+contact_email del entrenador de A → ambos
--       trim+actualizados; email de LOGIN (auth.users) intacto.
--   F2. contact_email con formato inválido → contact_email_invalid (no cambia).
--   G1. coordinador de A → forbidden (solo admin_club).
--   G2. el entrenador (no admin) → forbidden.
--   G3. admin de A → target de OTRO club → target_invalid.

begin;

insert into public.clubs (id, name, slug) values
  ('bc000000-0000-4000-8000-000000000001', 'Club A 2c', 'club-a-2c'),
  ('bc000000-0000-4000-8000-000000000002', 'Club B 2c', 'club-b-2c');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('bc0a0000-aaaa-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c-admin@test.local', now(), '{}'::jsonb, now(), now()),
  ('bc0a0000-cccc-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c-coord@test.local', now(), '{}'::jsonb, now(), now()),
  ('bc0a0000-eeee-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c-coach@test.local', now(), '{}'::jsonb, now(), now()),
  ('bc0b0000-aaaa-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c-badmin@test.local', now(), '{}'::jsonb, now(), now()),
  ('bc0b0000-eeee-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'c-bcoach@test.local', now(), '{}'::jsonb, now(), now());

insert into public.profiles (id, full_name) values
  ('bc0a0000-aaaa-4000-8000-000000000001', 'Admin A'),
  ('bc0a0000-cccc-4000-8000-000000000001', 'Coord A'),
  ('bc0a0000-eeee-4000-8000-000000000001', 'Coach A'),
  ('bc0b0000-aaaa-4000-8000-000000000001', 'Admin B'),
  ('bc0b0000-eeee-4000-8000-000000000001', 'Coach B')
on conflict (id) do update set full_name = excluded.full_name;

insert into public.memberships (profile_id, club_id, role) values
  ('bc0a0000-aaaa-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'admin_club'),
  ('bc0a0000-cccc-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'coordinador'),
  ('bc0a0000-eeee-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('bc0b0000-aaaa-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000002', 'admin_club'),
  ('bc0b0000-eeee-4000-8000-000000000001', 'bc000000-0000-4000-8000-000000000002', 'entrenador_principal');

-- ── F1. admin de A guarda phone+contact_email del entrenador de A ─────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"bc0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';

do $$
begin
  perform public.admin_update_staff_contact(
    'bc000000-0000-4000-8000-000000000001',
    'bc0a0000-eeee-4000-8000-000000000001',
    '  600 123 456  ',
    '  coach.contacto@club.test  '
  );

  if not exists (
    select 1 from public.memberships
     where club_id='bc000000-0000-4000-8000-000000000001'
       and profile_id='bc0a0000-eeee-4000-8000-000000000001'
       and phone='600 123 456'
       and contact_email='coach.contacto@club.test'
  ) then
    raise exception 'FAIL [F1]: phone/contact_email deberían quedar trim+actualizados';
  end if;
end $$;

-- ── F2. contact_email inválido → contact_email_invalid (no cambia nada) ──────
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_contact(
      'bc000000-0000-4000-8000-000000000001',
      'bc0a0000-eeee-4000-8000-000000000001',
      '600 123 456',
      'esto-no-es-email'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [F2]: un email inválido debería fallar'; end if;
  if not exists (
    select 1 from public.memberships
     where profile_id='bc0a0000-eeee-4000-8000-000000000001'
       and contact_email='coach.contacto@club.test'
  ) then
    raise exception 'FAIL [F2]: el contacto no debería haber cambiado tras el fallo';
  end if;
end $$;

-- ── G1. coordinador de A → forbidden ─────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"bc0a0000-cccc-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_contact(
      'bc000000-0000-4000-8000-000000000001',
      'bc0a0000-eeee-4000-8000-000000000001',
      '111',
      'hack@coord.test'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G1]: coordinador NO debería poder editar el contacto'; end if;
end $$;

-- ── G2. el entrenador (no admin) → forbidden ─────────────────────────────────
set local "request.jwt.claims" = '{"sub":"bc0a0000-eeee-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_contact(
      'bc000000-0000-4000-8000-000000000001',
      'bc0a0000-eeee-4000-8000-000000000001',
      '222',
      'auto@hack.test'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G2]: un no-admin NO debería poder editar el contacto'; end if;
end $$;

-- ── G3. admin de A → target de OTRO club → target_invalid ────────────────────
set local "request.jwt.claims" = '{"sub":"bc0a0000-aaaa-4000-8000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    perform public.admin_update_staff_contact(
      'bc000000-0000-4000-8000-000000000001',   -- club A
      'bc0b0000-eeee-4000-8000-000000000001',   -- coach de club B
      '333',
      'intruso@club.test'
    );
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL [G3]: editar a un miembro de otro club debería fallar (target_invalid)'; end if;
end $$;

reset role;

-- G3 (cont.): la membership del otro club quedó intacta (como superuser, sin RLS).
do $$
begin
  if exists (select 1 from public.memberships
              where profile_id='bc0b0000-eeee-4000-8000-000000000001'
                and (phone is not null or contact_email is not null)) then
    raise exception 'FAIL [G3]: el contacto del otro club NO debe cambiar';
  end if;
end $$;

-- F1 (cont.): el email de LOGIN (auth.users) quedó intacto — la función solo
-- toca memberships. Se verifica como superuser (authenticated no puede leer
-- auth.users).
do $$
begin
  if not exists (select 1 from auth.users
                  where id='bc0a0000-eeee-4000-8000-000000000001'
                    and email='c-coach@test.local') then
    raise exception 'FAIL [F1]: el email de login NO debe cambiar';
  end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Bug2c: admin_update_staff_contact (admin guarda phone/contact_email de su club, solo esas columnas, gateado, cross-club y no-admin rechazados; email de login intacto).'
\echo '──────────────────────────────────────────────'
