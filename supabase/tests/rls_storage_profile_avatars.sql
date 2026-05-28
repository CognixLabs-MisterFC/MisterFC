-- Tests RLS del bucket `profile-avatars` (F2.0).
--
-- Verifica que:
--   T1. Cualquier authenticated puede SELECT sobre objetos del bucket
--       (permitido para generar signed URLs server-side; la enumeración real
--       de paths sigue restringida vía RLS de public.profiles).
--   T2. anon NO puede SELECT — el bucket no es público.
--   T3. User A puede INSERT en su propia carpeta `<A>/...`.
--   T4. User A NO puede INSERT en la carpeta de B `<B>/...` (anti-suplantación).
--   T5. User A puede UPDATE/DELETE solo en su propia carpeta.
--   T6. User A NO puede UPDATE/DELETE objetos de B.

begin;

-- Setup: dos users de prueba.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user-a@avatars.test', now(), '{"full_name":"User A"}'::jsonb, now(), now()),
  ('bbbbbbbb-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'user-b@avatars.test', now(), '{"full_name":"User B"}'::jsonb, now(), now());

-- Seed: un objeto preexistente en la carpeta de B (insertado como postgres,
-- bypass RLS) para luego comprobar que A no puede tocar/leer pertenece-a-B.
insert into storage.objects (bucket_id, name, owner, metadata)
values ('profile-avatars', 'bbbbbbbb-2222-2222-2222-222222222222/seed.webp',
        'bbbbbbbb-2222-2222-2222-222222222222', '{}'::jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: authenticated puede SELECT (necesario para createSignedUrl server-side)
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt
  from storage.objects
  where bucket_id = 'profile-avatars'
    and name = 'bbbbbbbb-2222-2222-2222-222222222222/seed.webp';
  if cnt <> 1 then
    raise exception 'FAIL [T1]: authenticated no ve los objetos (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: anon NO puede SELECT (bucket privado)
-- ─────────────────────────────────────────────────────────────────────────────

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

do $$
declare cnt int;
begin
  select count(*) into cnt
  from storage.objects
  where bucket_id = 'profile-avatars';
  if cnt <> 0 then
    raise exception 'FAIL [T2]: anon no debería ver objetos privados (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: User A puede INSERT en su propia carpeta
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"aaaaaaaa-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('profile-avatars',
          'aaaaaaaa-1111-1111-1111-111111111111/' || gen_random_uuid() || '.webp',
          auth.uid(),
          '{}'::jsonb);
exception when others then
  raise exception 'FAIL [T3]: user A no pudo INSERT en su carpeta: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: User A NO puede INSERT en la carpeta de B
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('profile-avatars',
            'bbbbbbbb-2222-2222-2222-222222222222/' || gen_random_uuid() || '.webp',
            auth.uid(),
            '{}'::jsonb);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T4]: user A pudo INSERT en carpeta de B (anti-suplantación rota)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5: User A puede UPDATE/DELETE en su propia carpeta
-- ─────────────────────────────────────────────────────────────────────────────

-- Seed un objeto propio para luego actualizar/borrar.
do $$
declare own_name text;
begin
  own_name := 'aaaaaaaa-1111-1111-1111-111111111111/own.webp';
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('profile-avatars', own_name, auth.uid(), '{"v":1}'::jsonb);

  update storage.objects
    set metadata = '{"v":2}'::jsonb
    where bucket_id = 'profile-avatars' and name = own_name;
  if not found then
    raise exception 'FAIL [T5.a]: user A no pudo UPDATE su propio objeto';
  end if;

  delete from storage.objects
    where bucket_id = 'profile-avatars' and name = own_name;
  if not found then
    raise exception 'FAIL [T5.b]: user A no pudo DELETE su propio objeto';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T6: User A NO puede UPDATE/DELETE objetos de B
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare cnt int;
begin
  update storage.objects
    set metadata = '{"hacked":true}'::jsonb
    where bucket_id = 'profile-avatars'
      and name = 'bbbbbbbb-2222-2222-2222-222222222222/seed.webp';
  -- UPDATE silently no-op cuando la policy USING evalúa a false (0 filas).
  select count(*) into cnt
  from storage.objects
  where bucket_id = 'profile-avatars'
    and name = 'bbbbbbbb-2222-2222-2222-222222222222/seed.webp'
    and metadata @> '{"hacked":true}'::jsonb;
  if cnt <> 0 then
    raise exception 'FAIL [T6.a]: user A pudo UPDATE objeto de B';
  end if;

  delete from storage.objects
    where bucket_id = 'profile-avatars'
      and name = 'bbbbbbbb-2222-2222-2222-222222222222/seed.webp';
  select count(*) into cnt
  from storage.objects
  where bucket_id = 'profile-avatars'
    and name = 'bbbbbbbb-2222-2222-2222-222222222222/seed.webp';
  if cnt <> 1 then
    raise exception 'FAIL [T6.b]: user A pudo DELETE objeto de B';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS de profile-avatars pasaron.'
\echo '──────────────────────────────────────────────'
