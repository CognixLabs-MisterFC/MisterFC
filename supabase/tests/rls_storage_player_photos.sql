-- Tests F2.2 — RLS del bucket privado `player-photos`
--
-- Verifica que:
--   T1. anon NO puede SELECT — bucket privado.
--   T2. Cualquier miembro del club del jugador puede SELECT.
--   T3. User de otro club NO puede SELECT (aislamiento multi-tenant).
--   T4. admin del club puede INSERT en la carpeta del jugador.
--   T5. ayudante sin can_manage_squad NO puede INSERT.
--   T6. ayudante con can_manage_squad SÍ puede INSERT.
--   T7. admin de otro club NO puede INSERT en player ajeno.
--   T8. admin puede UPDATE en su club.
--
-- Nota: DELETE no se prueba aquí (storage.protect_delete() lo bloquea
-- desde SQL puro; smoke E2E desde la app valida la Storage API).

begin;

-- Setup compartido (mismo patrón que rls_player_helpers).
insert into public.clubs (id, name, slug)
values
  ('dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'Club Alfa Photos', 'alfa-photos'),
  ('dddddddd-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'Club Beta Photos', 'beta-photos');

insert into public.categories (id, club_id, name) values
  ('aaaaa111-0000-0000-0000-000000000001', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'Cat A'),
  ('aaaaa111-0000-0000-0000-000000000002', 'dddddddd-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'Cat B');

insert into public.teams (id, category_id, name, format, color, season) values
  ('bbbbb111-0000-0000-0000-000000000001', 'aaaaa111-0000-0000-0000-000000000001', 'Team A', 'F7', '#10B981', '2025-26'),
  ('bbbbb111-0000-0000-0000-000000000002', 'aaaaa111-0000-0000-0000-000000000002', 'Team B', 'F7', '#10B981', '2025-26');

insert into public.players (id, club_id, first_name, last_name, date_of_birth)
values
  ('00000000-aaaa-1111-0000-000000000001', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'Player', 'A1', '2015-04-12');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('11111111-bbbb-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-aph@test', now(), '{}'::jsonb, now(), now()),
  ('22222222-bbbb-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assist-aph@test', now(), '{}'::jsonb, now(), now()),
  ('33333333-bbbb-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assist-squad-aph@test', now(), '{}'::jsonb, now(), now()),
  ('44444444-bbbb-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-bph@test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (profile_id, club_id, role) values
  ('11111111-bbbb-1111-1111-111111111111', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'admin_club'),
  ('22222222-bbbb-2222-2222-222222222222', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'entrenador_ayudante'),
  ('33333333-bbbb-3333-3333-333333333333', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'entrenador_ayudante'),
  ('44444444-bbbb-4444-4444-444444444444', 'dddddddd-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'admin_club');

update public.capabilities
   set granted = true
 where capability_name = 'can_manage_squad'
   and membership_id = (select id from public.memberships
                       where profile_id = '33333333-bbbb-3333-3333-333333333333'
                         and club_id = 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0');

-- Seed: objeto preexistente en la carpeta del player A1 (insertado como
-- postgres, bypass RLS).
insert into storage.objects (bucket_id, name, owner, metadata)
values ('player-photos',
        '00000000-aaaa-1111-0000-000000000001/seed.webp',
        '11111111-bbbb-1111-1111-111111111111',
        '{}'::jsonb);

-- ─────────────────────────────────────────────────────────────────────────────
-- T1: anon NO puede SELECT (bucket privado)
-- ─────────────────────────────────────────────────────────────────────────────

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

do $$
declare cnt int;
begin
  select count(*) into cnt from storage.objects where bucket_id = 'player-photos';
  if cnt <> 0 then
    raise exception 'FAIL [T1]: anon no debería ver objetos privados (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T2: admin del club (miembro) SÍ puede SELECT
-- ─────────────────────────────────────────────────────────────────────────────

set local role authenticated;
set local "request.jwt.claims" = '{"sub":"11111111-bbbb-1111-1111-111111111111","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt
  from storage.objects
  where bucket_id = 'player-photos'
    and name = '00000000-aaaa-1111-0000-000000000001/seed.webp';
  if cnt <> 1 then
    raise exception 'FAIL [T2]: admin del club no ve seed (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T3: admin de OTRO club NO puede SELECT
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"44444444-bbbb-4444-4444-444444444444","role":"authenticated"}';

do $$
declare cnt int;
begin
  select count(*) into cnt
  from storage.objects
  where bucket_id = 'player-photos'
    and name = '00000000-aaaa-1111-0000-000000000001/seed.webp';
  if cnt <> 0 then
    raise exception 'FAIL [T3]: admin de otro club ve el objeto (cross-club, cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T4: admin del club PUEDE INSERT en carpeta del player
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"11111111-bbbb-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('player-photos',
          '00000000-aaaa-1111-0000-000000000001/admin-upload.webp',
          auth.uid(), '{}'::jsonb);
exception when others then
  raise exception 'FAIL [T4]: admin no pudo INSERT en carpeta del player: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T5: ayudante SIN can_manage_squad NO puede INSERT
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"22222222-bbbb-2222-2222-222222222222","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('player-photos',
            '00000000-aaaa-1111-0000-000000000001/no-cap.webp',
            auth.uid(), '{}'::jsonb);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T5]: ayudante sin can_manage_squad pudo INSERT';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T6: ayudante CON can_manage_squad SÍ puede INSERT
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"33333333-bbbb-3333-3333-333333333333","role":"authenticated"}';

do $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('player-photos',
          '00000000-aaaa-1111-0000-000000000001/with-cap.webp',
          auth.uid(), '{}'::jsonb);
exception when others then
  raise exception 'FAIL [T6]: ayudante con can_manage_squad no pudo INSERT: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T7: admin de OTRO club NO puede INSERT en player ajeno
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"44444444-bbbb-4444-4444-444444444444","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('player-photos',
            '00000000-aaaa-1111-0000-000000000001/cross.webp',
            auth.uid(), '{}'::jsonb);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T7]: admin cross-club pudo INSERT';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T8: admin puede UPDATE su propio upload
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"11111111-bbbb-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  update storage.objects
    set metadata = '{"v":2}'::jsonb
    where bucket_id = 'player-photos'
      and name = '00000000-aaaa-1111-0000-000000000001/admin-upload.webp';
  if not found then
    raise exception 'FAIL [T8]: admin no pudo UPDATE su upload';
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS de player-photos pasaron.'
\echo '──────────────────────────────────────────────'
