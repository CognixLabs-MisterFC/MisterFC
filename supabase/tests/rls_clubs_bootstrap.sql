-- Tests del fix de RLS en clubs INSERT + función create_club_with_admin.
--
-- Verifica que:
--   T1. INSERT directo en clubs desde authenticated está bloqueado.
--   T2. create_club_with_admin crea club + membership en una sola transacción.
--   T3. Llamar a la función dos veces (mismo user, sin memberships) falla la 2ª.
--   T4. Si user ya tiene membership en otro club, la función falla.

begin;

-- Setup: dos users sin memberships.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'newuser@test.local', now(), '{"full_name":"NewUser"}'::jsonb, now(), now()),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'existinguser@test.local', now(), '{"full_name":"Existing"}'::jsonb, now(), now());

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: INSERT directo en clubs bloqueado para authenticated
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into public.clubs (name, slug) values ('Direct Insert', 'direct-insert-test');
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T1]: INSERT directo en clubs debería estar bloqueado';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: create_club_with_admin crea club + membership atómico
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare v_club_id uuid;
declare cnt_clubs int;
declare cnt_memberships int;
begin
  v_club_id := public.create_club_with_admin('Club New', 'club-new-test', 'es');

  if v_club_id is null then
    raise exception 'FAIL [T2.a]: la función devolvió NULL';
  end if;

  select count(*) into cnt_clubs from public.clubs where id = v_club_id;
  if cnt_clubs <> 1 then
    raise exception 'FAIL [T2.b]: el club no se creó (cnt=%)', cnt_clubs;
  end if;

  select count(*) into cnt_memberships
  from public.memberships
  where club_id = v_club_id
    and profile_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
    and role = 'admin_club';
  if cnt_memberships <> 1 then
    raise exception 'FAIL [T2.c]: la membership admin_club no se creó (cnt=%)', cnt_memberships;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: segunda llamada falla con "already_in_a_club"
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare ok boolean := false;
begin
  begin
    perform public.create_club_with_admin('Club Other', 'club-other-test', 'es');
  exception when others then
    if sqlerrm like '%already_in_a_club%' then
      ok := true;
    else
      raise exception 'FAIL [T3]: error inesperado: %', sqlerrm;
    end if;
  end;
  if not ok then
    raise exception 'FAIL [T3]: segunda llamada debería fallar con already_in_a_club';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: user con membership existente (no por la función) tampoco puede
-- ─────────────────────────────────────────────────────────────────────────────

-- Simulamos un user con membership preexistente (insertada por postgres, bypass RLS)
reset role;

-- Necesitamos un club ya creado para meter la membership.
do $$
declare v_club_id uuid;
begin
  -- Como postgres, podemos INSERTAR directo en clubs (BYPASS RLS via superuser).
  insert into public.clubs (id, name, slug)
  values ('aaaaffff-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Pre-existing', 'pre-existing-test')
  returning id into v_club_id;

  insert into public.memberships (profile_id, club_id, role)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', v_club_id, 'admin_club');
end $$;

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cccccccc-cccc-cccc-cccc-cccccccccccc","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    perform public.create_club_with_admin('Second Attempt', 'second-attempt-test', 'es');
  exception when others then
    if sqlerrm like '%already_in_a_club%' then
      ok := true;
    end if;
  end;
  if not ok then
    raise exception 'FAIL [T4]: user con membership previa debería fallar';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests del bootstrap de clubs pasaron.'
\echo '──────────────────────────────────────────────'
