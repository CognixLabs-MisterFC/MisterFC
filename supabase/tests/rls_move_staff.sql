-- Tests F2.11 — Comportamiento del flow "Mover staff a otro equipo".
--
-- La acción de la app (moveStaffToTeam) hace dos pasos en SQL:
--   1. UPDATE team_staff SET left_at = today WHERE id = :current.
--   2. INSERT INTO team_staff (team_id, membership_id, staff_role) target.
--
-- Sin policy nueva. Reutiliza `team_staff_insert_admin` /
-- `team_staff_update_admin` de F2.6 y el índice parcial UNIQUE de principal.
--
-- Casos:
--   M1. UPDATE deja left_at = current_date en la fila origen.
--   M2. INSERT crea la fila destino con joined_at = current_date.
--   M3. Si el destino ya tiene principal activo y se intenta insertar otro
--       principal → 23505 (UNIQUE parcial).
--   M4. Si el actor es jugador → RLS rechaza UPDATE (42501).

begin;

-- Setup (uuids dedicados para no chocar con otros tests).
insert into public.clubs (id, name, slug) values
  ('11ff0000-0000-0000-0000-000000000001', 'Club Move', 'club-move');

insert into public.categories (id, club_id, name, season) values
  ('22ff0000-0000-0000-0000-000000000001', '11ff0000-0000-0000-0000-000000000001', 'Cat M', '2025-26');

insert into public.teams (id, category_id, name, format, color) values
  ('33ff0000-0000-0000-0000-000000000001', '22ff0000-0000-0000-0000-000000000001', 'Origin', 'F7', '#10B981'),
  ('33ff0000-0000-0000-0000-000000000002', '22ff0000-0000-0000-0000-000000000001', 'Target', 'F7', '#10B981');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44ff0000-aaaa-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-m@ts.test', now(), '{}'::jsonb, now(), now()),
  ('44ff0000-aaaa-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-m@ts.test', now(), '{}'::jsonb, now(), now()),
  ('44ff0000-aaaa-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'other-principal-m@ts.test', now(), '{}'::jsonb, now(), now()),
  ('44ff0000-aaaa-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador-m@ts.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55ff0000-aaaa-1111-1111-111111111111', '44ff0000-aaaa-1111-1111-111111111111', '11ff0000-0000-0000-0000-000000000001', 'admin_club'),
  ('55ff0000-aaaa-3333-3333-333333333333', '44ff0000-aaaa-3333-3333-333333333333', '11ff0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('55ff0000-aaaa-7777-7777-777777777777', '44ff0000-aaaa-7777-7777-777777777777', '11ff0000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('55ff0000-aaaa-9999-9999-999999999999', '44ff0000-aaaa-9999-9999-999999999999', '11ff0000-0000-0000-0000-000000000001', 'jugador');

-- Fila activa origen.
insert into public.team_staff (id, team_id, membership_id, staff_role) values
  ('66ff0000-0001-0000-0000-000000000001',
   '33ff0000-0000-0000-0000-000000000001',
   '55ff0000-aaaa-3333-3333-333333333333',
   'entrenador_principal');

-- ─────────────────────────────────────────────────────────────────────────────
-- M1. UPDATE deja left_at = current_date en la fila origen
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44ff0000-aaaa-1111-1111-111111111111';

do $$
begin
  update public.team_staff
    set left_at = current_date
    where id = '66ff0000-0001-0000-0000-000000000001'
      and left_at is null;
  if (select left_at from public.team_staff where id = '66ff0000-0001-0000-0000-000000000001')
       is distinct from current_date then
    raise exception 'FAIL [M1]: left_at no se fijó a current_date';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M2. INSERT crea la fila destino con joined_at = current_date
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare new_id uuid;
begin
  insert into public.team_staff (team_id, membership_id, staff_role) values
    ('33ff0000-0000-0000-0000-000000000002',
     '55ff0000-aaaa-3333-3333-333333333333',
     'entrenador_principal')
    returning id into new_id;
  if (select joined_at from public.team_staff where id = new_id) is distinct from current_date then
    raise exception 'FAIL [M2]: joined_at no es current_date';
  end if;
  if (select left_at from public.team_staff where id = new_id) is not null then
    raise exception 'FAIL [M2]: left_at debería ser NULL en la fila nueva';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- M3. Intentar insertar un SEGUNDO principal activo en el mismo team destino
--     → 23505 por el índice parcial UNIQUE de F2.6.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.team_staff (team_id, membership_id, staff_role) values
      ('33ff0000-0000-0000-0000-000000000002',
       '55ff0000-aaaa-7777-7777-777777777777',
       'entrenador_principal');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [M3]: segundo principal activo en el destino debería rechazarse (23505)';
  end if;
end $$;

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- M4. Como jugador, intentar el UPDATE de la fila destino → RLS rechaza.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '44ff0000-aaaa-9999-9999-999999999999';

do $$
declare touched int;
begin
  update public.team_staff
    set left_at = current_date
    where team_id = '33ff0000-0000-0000-0000-000000000002'
      and membership_id = '55ff0000-aaaa-3333-3333-333333333333';
  get diagnostics touched = row_count;
  if touched <> 0 then
    raise exception 'FAIL [M4]: jugador no debería poder cerrar staff (touched=%)', touched;
  end if;
end $$;

reset role;

rollback;
