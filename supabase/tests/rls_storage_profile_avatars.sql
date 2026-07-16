-- Tests RLS del bucket `profile-avatars` (F2.0).
--
-- Verifica que:
--   T1. Cualquier authenticated puede SELECT sobre objetos del bucket
--       (permitido para generar signed URLs server-side; la enumeración real
--       de paths sigue restringida vía RLS de public.profiles).
--   T2. anon NO puede SELECT — el bucket no es público.
--   T3. User A puede INSERT en su propia carpeta `<A>/...`.
--   T4. User A NO puede INSERT en la carpeta de B `<B>/...` (anti-suplantación).
--   T5. User A puede UPDATE en su propia carpeta.
--   T6. User A NO puede UPDATE objetos de B.
--
-- Nota: las policies de DELETE NO se prueban aquí. Supabase Storage instala
-- un trigger global `storage.protect_delete()` que bloquea cualquier DELETE
-- directo en `storage.objects` desde SQL (incluso si la policy lo permite)
-- para evitar orphans entre la tabla y el bucket físico. El único path válido
-- es la Storage API (supabase-js `.remove()`). El DELETE se valida en
-- smoke tests E2E desde la app.
\ir helpers/auth_users.sql

begin;

-- Setup: dos users de prueba.
select pg_temp.new_test_user('aaaaaaaa-1111-1111-1111-111111111111', 'user-a@avatars.test', '{"full_name":"User A"}'::jsonb);
select pg_temp.new_test_user('bbbbbbbb-2222-2222-2222-222222222222', 'user-b@avatars.test', '{"full_name":"User B"}'::jsonb);

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
-- T5: User A puede UPDATE en su propia carpeta
-- ─────────────────────────────────────────────────────────────────────────────

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
    raise exception 'FAIL [T5]: user A no pudo UPDATE su propio objeto';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T6: User A NO puede UPDATE objetos de B
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
    raise exception 'FAIL [T6]: user A pudo UPDATE objeto de B';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS de profile-avatars pasaron.'
\echo '──────────────────────────────────────────────'
