-- Tests F2.9 — RLS de INSERT batch en players (importación masiva)
--
-- La server action `importPlayers` recorre el array fila a fila y hace
-- INSERT con el client del JWT del usuario. La RLS de `players` debe:
--
--   I1. admin del club SÍ puede INSERT en su club.
--   I2. coordinador del club SÍ puede.
--   I3. entrenador_principal del club SÍ puede.
--   I4. ayudante con `can_manage_squad=true` SÍ puede.
--   I5. ayudante sin `can_manage_squad` NO puede.
--   I6. jugador NO puede.
--   I7. admin del club B NO puede insertar con club_id del club A.
--
-- Las capabilities las siembra el trigger F1.7 al crear la membership de
-- ayudante. Activamos `can_manage_squad` solo en I4 vía UPDATE directo
-- (saltando RLS de capabilities porque corremos como bootstrap superuser
-- en el setup; los UPDATEs reales en producción van por la action
-- toggleCapability).

begin;

-- Setup mínimo
insert into public.clubs (id, name, slug) values
  ('99aaaaaa-aaaa-0000-0000-000000000001', 'Club Import Alfa', 'alfa-import'),
  ('99aaaaaa-bbbb-0000-0000-000000000001', 'Club Import Beta', 'beta-import');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('99aaaaaa-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-imp@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99aaaaaa-aaaa-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-imp@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99aaaaaa-aaaa-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-imp@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99aaaaaa-aaaa-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assist-on@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99aaaaaa-aaaa-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'assist-off@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99aaaaaa-aaaa-6666-6666-666666666666', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jug-imp@ts.test', now(), '{}'::jsonb, now(), now()),
  ('99aaaaaa-bbbb-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-b-imp@ts.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('99aaaaaa-0a00-1111-1111-111111111111', '99aaaaaa-aaaa-1111-1111-111111111111', '99aaaaaa-aaaa-0000-0000-000000000001', 'admin_club'),
  ('99aaaaaa-0a00-2222-2222-222222222222', '99aaaaaa-aaaa-2222-2222-222222222222', '99aaaaaa-aaaa-0000-0000-000000000001', 'coordinador'),
  ('99aaaaaa-0a00-3333-3333-333333333333', '99aaaaaa-aaaa-3333-3333-333333333333', '99aaaaaa-aaaa-0000-0000-000000000001', 'entrenador_principal'),
  ('99aaaaaa-0a00-4444-4444-444444444444', '99aaaaaa-aaaa-4444-4444-444444444444', '99aaaaaa-aaaa-0000-0000-000000000001', 'entrenador_ayudante'),
  ('99aaaaaa-0a00-5555-5555-555555555555', '99aaaaaa-aaaa-5555-5555-555555555555', '99aaaaaa-aaaa-0000-0000-000000000001', 'entrenador_ayudante'),
  ('99aaaaaa-0a00-6666-6666-666666666666', '99aaaaaa-aaaa-6666-6666-666666666666', '99aaaaaa-aaaa-0000-0000-000000000001', 'jugador'),
  ('99aaaaaa-0a00-7777-7777-777777777777', '99aaaaaa-bbbb-7777-7777-777777777777', '99aaaaaa-bbbb-0000-0000-000000000001', 'admin_club');

-- Activar can_manage_squad solo en el ayudante "on" (I4)
update public.capabilities
   set granted = true
 where membership_id = '99aaaaaa-0a00-4444-4444-444444444444'
   and capability_name = 'can_manage_squad';

-- Helper para encapsular un INSERT de player como un user.
create or replace function pg_temp.try_insert_player(
  p_sub uuid, p_club uuid, p_first text, p_last text
) returns text language plpgsql as $$
declare
  v_id uuid;
  v_state text := 'unknown';
begin
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    '{"sub":"' || p_sub::text || '","role":"authenticated"}',
    true
  );
  begin
    insert into public.players (club_id, first_name, last_name, date_of_birth)
    values (p_club, p_first, p_last, '2010-01-01')
    returning id into v_id;
    v_state := 'ok';
  exception
    when insufficient_privilege then v_state := 'rls';
    when others then v_state := 'err:' || sqlstate;
  end;
  reset role;
  return v_state;
end $$;

-- I1: admin SÍ
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-aaaa-1111-1111-111111111111',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Admin', 'Imp');
  if s <> 'ok' then raise exception 'FAIL [I1]: admin no pudo INSERT (%)', s; end if;
end $$;

-- I2: coord SÍ
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-aaaa-2222-2222-222222222222',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Coord', 'Imp');
  if s <> 'ok' then raise exception 'FAIL [I2]: coord no pudo INSERT (%)', s; end if;
end $$;

-- I3: principal SÍ
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-aaaa-3333-3333-333333333333',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Principal', 'Imp');
  if s <> 'ok' then raise exception 'FAIL [I3]: principal no pudo INSERT (%)', s; end if;
end $$;

-- I4: ayudante con can_manage_squad SÍ
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-aaaa-4444-4444-444444444444',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Ayud', 'OnSquad');
  if s <> 'ok' then raise exception 'FAIL [I4]: ayudante can_manage_squad=true no pudo (%)', s; end if;
end $$;

-- I5: ayudante sin can_manage_squad NO puede.
-- La policy players_write_staff (F1.7) exige role∈{admin,coord,principal}
-- O capability can_manage_squad. El ayudante con cap=false cae fuera.
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-aaaa-5555-5555-555555555555',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Ayud', 'OffSquad');
  if s <> 'rls' then raise exception 'FAIL [I5]: ayudante sin can_manage_squad no debería poder (got=%)', s; end if;
end $$;

-- I6: jugador NO
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-aaaa-6666-6666-666666666666',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Jug', 'Imp');
  if s <> 'rls' then raise exception 'FAIL [I6]: jugador no debería poder INSERT (got=%)', s; end if;
end $$;

-- I7: admin del club B con club_id del club A → RLS bloquea
do $$
declare s text;
begin
  s := pg_temp.try_insert_player(
    '99aaaaaa-bbbb-7777-7777-777777777777',
    '99aaaaaa-aaaa-0000-0000-000000000001', 'Cross', 'Club');
  if s <> 'rls' then raise exception 'FAIL [I7]: admin de otro club no debería poder (got=%)', s; end if;
end $$;

rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS players import batch pasaron.'
\echo '──────────────────────────────────────────────'
