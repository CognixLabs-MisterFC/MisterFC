-- Tests F2.2 — RLS del bucket privado `player-photos`
--
-- Verifica que:
--   T1. anon NO puede SELECT — bucket privado.
--   T2. Cualquier miembro del club del jugador puede SELECT.
--   T3. User de otro club NO puede SELECT (aislamiento multi-tenant).
--   T4. admin del club NO puede INSERT (F14-3b: escritura solo del tutor).
--   T5. ayudante sin can_manage_squad NO puede INSERT.
--   T6. ayudante con can_manage_squad TAMPOCO puede INSERT (F14-3b).
--   T7. admin de otro club NO puede INSERT en player ajeno.
--   T8. admin NO puede UPDATE (F14-3b: UPDATE también tutor-only).
--   T9. el TUTOR del jugador SÍ puede INSERT (caso positivo F14-3b).
--
-- Nota: DELETE no se prueba aquí (storage.protect_delete() lo bloquea
-- desde SQL puro; smoke E2E desde la app valida la Storage API).
-- F15-A2: F14-3b (mig 20260904) movió la ESCRITURA de player-photos de staff a
-- tutor (player_accounts parent/guardian). T4/T6/T8 se invirtieron a "no puede" y
-- se añadieron T9/T10 (el tutor sí). SELECT (T1-T3) intacto.
\ir helpers/auth_users.sql

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

select pg_temp.new_test_user('11111111-bbbb-1111-1111-111111111111', 'admin-aph@test', '{}'::jsonb);
select pg_temp.new_test_user('22222222-bbbb-2222-2222-222222222222', 'assist-aph@test', '{}'::jsonb);
select pg_temp.new_test_user('33333333-bbbb-3333-3333-333333333333', 'assist-squad-aph@test', '{}'::jsonb);
select pg_temp.new_test_user('44444444-bbbb-4444-4444-444444444444', 'admin-bph@test', '{}'::jsonb);
-- F15-A2: tutor (parent) del player A1. Desde F14-3b (mig 20260904) la ESCRITURA
-- de player-photos es SOLO del tutor vinculado (player_accounts parent/guardian).
select pg_temp.new_test_user('55555555-bbbb-5555-5555-555555555555', 'tutor-aph@test', '{}'::jsonb);
-- Extensión self (mig 20261038): el jugador adulto vinculado como relation='self'
-- gestiona TAMBIÉN su propia foto. Usuario self del player A1 (T11).
select pg_temp.new_test_user('66666666-bbbb-6666-6666-666666666666', 'self-aph@test', '{}'::jsonb);

insert into public.memberships (profile_id, club_id, role) values
  ('11111111-bbbb-1111-1111-111111111111', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'admin_club'),
  ('22222222-bbbb-2222-2222-222222222222', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'entrenador_ayudante'),
  ('33333333-bbbb-3333-3333-333333333333', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'entrenador_ayudante'),
  ('44444444-bbbb-4444-4444-444444444444', 'dddddddd-d1d1-d1d1-d1d1-d1d1d1d1d1d1', 'admin_club'),
  ('66666666-bbbb-6666-6666-666666666666', 'dddddddd-d0d0-d0d0-d0d0-d0d0d0d0d0d0', 'jugador');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('00000000-aaaa-1111-0000-000000000001', '55555555-bbbb-5555-5555-555555555555', 'parent'),
  ('00000000-aaaa-1111-0000-000000000001', '66666666-bbbb-6666-6666-666666666666', 'self');

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
-- T4: admin del club NO puede INSERT en carpeta del player
-- F15-A2 (EXPECTATIVA invertida, confirmada por Jose): desde F14-3b (mig 20260904)
-- la ESCRITURA de player-photos es SOLO del tutor; admin y staff perdieron el INSERT
-- (conservan SELECT). Antes T4 esperaba que el admin SÍ pudiera insertar.
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"11111111-bbbb-1111-1111-111111111111","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('player-photos',
            '00000000-aaaa-1111-0000-000000000001/admin-upload.webp',
            auth.uid(), '{}'::jsonb);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T4]: admin NO debería poder INSERT foto de player (F14-3b: solo tutor)';
  end if;
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
-- T6: ayudante CON can_manage_squad TAMPOCO puede INSERT
-- F15-A2 (EXPECTATIVA invertida, confirmada por Jose): F14-3b dejó la escritura de
-- fotos SOLO al tutor, sin importar can_manage_squad. Antes T6 esperaba que sí.
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"33333333-bbbb-3333-3333-333333333333","role":"authenticated"}';

do $$
declare ok boolean := false;
begin
  begin
    insert into storage.objects (bucket_id, name, owner, metadata)
    values ('player-photos',
            '00000000-aaaa-1111-0000-000000000001/with-cap.webp',
            auth.uid(), '{}'::jsonb);
  exception when others then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T6]: ayudante con can_manage_squad NO debería poder INSERT foto (F14-3b: solo tutor)';
  end if;
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
-- T8: admin NO puede UPDATE una foto (F14-3b: UPDATE también es solo del tutor)
-- F15-A2 (EXPECTATIVA invertida, confirmada por Jose): F14-3b cambió INSERT, UPDATE
-- y DELETE de player-photos a tutor-only. La RLS filtra el UPDATE del admin → 0 filas
-- (not found). Antes T8 esperaba que el admin sí pudiera actualizar su upload.
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"11111111-bbbb-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  update storage.objects
    set metadata = '{"v":2}'::jsonb
    where bucket_id = 'player-photos'
      and name = '00000000-aaaa-1111-0000-000000000001/seed.webp';
  if found then
    raise exception 'FAIL [T8]: admin NO debería poder UPDATE foto de player (F14-3b: solo tutor)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T9: el TUTOR del player SÍ puede INSERT en su carpeta (caso positivo de F14-3b)
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"55555555-bbbb-5555-5555-555555555555","role":"authenticated"}';

do $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('player-photos',
          '00000000-aaaa-1111-0000-000000000001/tutor-upload.webp',
          auth.uid(), '{}'::jsonb);
exception when others then
  raise exception 'FAIL [T9]: el tutor no pudo INSERT la foto de su hijo: %', sqlerrm;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- T11: el jugador adulto self del player SÍ puede INSERT su foto (extensión
--      mig 20261038 — relation='self' cuenta como gestor).
-- ─────────────────────────────────────────────────────────────────────────────

set local "request.jwt.claims" = '{"sub":"66666666-bbbb-6666-6666-666666666666","role":"authenticated"}';

do $$
begin
  insert into storage.objects (bucket_id, name, owner, metadata)
  values ('player-photos',
          '00000000-aaaa-1111-0000-000000000001/self-upload.webp',
          auth.uid(), '{}'::jsonb);
exception when others then
  raise exception 'FAIL [T11]: el jugador self no pudo INSERT su propia foto: %', sqlerrm;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS de player-photos pasaron.'
\echo '──────────────────────────────────────────────'
