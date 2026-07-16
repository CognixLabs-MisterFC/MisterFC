-- Tests D1 — player_promotions: jerarquía (superioridad), trigger y RLS.
--
-- Casos:
--   P1. admin sube por DIVISIÓN (cadete segunda → cadete primera, match) → OK;
--       kind/team_id/club_id derivados, created_by forzado a auth.uid().
--   P2. mismo nivel (cadete segunda → cadete segunda) → promotion_target_not_superior.
--   P3. inferior (cadete → infantil) → promotion_target_not_superior.
--   P4. cross-categoría (cadete → juvenil, división PEOR pero categoría superior,
--       training) → OK; kind='train'.
--   P5. kind nulo en destino → promotion_target_not_superior.
--   P6. event.type='other' → event_type_not_promotable.
--   P7. cross-club (jugador club A → evento equipo club B) → player_cross_club.
--   P8. UNIQUE (player_id, event_id) — segundo INSERT → 23505.
--   S1. familia (player_accounts) VE la subida de su jugador.
--   S2. staff (principal team_staff) del equipo SUPERIOR INSERTA → OK.
--   S3. ajeno (admin de otro club) NO ve la subida.
--   S4. familia NO inserta (42501).
--   S5. admin/coord SÍ ve.
--   S6. staff del equipo BASE VE la subida.
\ir helpers/auth_users.sql

begin;

-- ── Clubs ────────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('a1000000-0000-0000-0000-000000000001', 'Club Promo A', 'club-promo-a'),
  ('a1000000-0000-0000-0000-000000000002', 'Club Promo B', 'club-promo-b');

-- ── Categorías (kind fija la edad; división va en el equipo) ──────────────────
insert into public.categories (id, club_id, name, kind) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Cadete',   'cadete'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'Juvenil',  'juvenil'),
  ('a2000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'Infantil', 'infantil'),
  ('a2000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'SinKind',  null),
  ('a2000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000002', 'Cadete B', 'cadete');

-- ── Equipos (season explícita; club_id lo deriva el trigger; división explícita) ─
insert into public.teams (id, category_id, name, format, color, season, division) values
  -- club A
  ('a3000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'Cadete Segunda',  'F11', '#10B981', '2025-26', 'segunda'),   -- BASE
  ('a3000000-0000-0000-0000-000000000002', 'a2000000-0000-0000-0000-000000000001', 'Cadete Primera',  'F11', '#10B981', '2025-26', 'primera'),   -- superior por división
  ('a3000000-0000-0000-0000-000000000003', 'a2000000-0000-0000-0000-000000000001', 'Cadete Segunda 2','F11', '#10B981', '2025-26', 'segunda'),   -- mismo nivel
  ('a3000000-0000-0000-0000-000000000004', 'a2000000-0000-0000-0000-000000000002', 'Juvenil Tercera', 'F11', '#10B981', '2025-26', 'tercera'),   -- superior por categoría (división peor)
  ('a3000000-0000-0000-0000-000000000005', 'a2000000-0000-0000-0000-000000000003', 'Infantil Segunda','F11', '#10B981', '2025-26', 'segunda'),   -- inferior
  ('a3000000-0000-0000-0000-000000000006', 'a2000000-0000-0000-0000-000000000004', 'Sin Kind',        'F11', '#10B981', '2025-26', null),         -- kind nulo destino
  -- club B
  ('a3000000-0000-0000-0000-000000000007', 'a2000000-0000-0000-0000-000000000005', 'Cadete Primera B','F11', '#10B981', '2025-26', 'primera');

-- ── Usuarios ─────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('a4000000-0000-0000-0000-0000000000a1', 'admin-a@promo.test', '{}'::jsonb);
select pg_temp.new_test_user('a4000000-0000-0000-0000-0000000000a2', 'principal-sup@promo.test', '{}'::jsonb);
select pg_temp.new_test_user('a4000000-0000-0000-0000-0000000000a3', 'principal-base@promo.test', '{}'::jsonb);
select pg_temp.new_test_user('a4000000-0000-0000-0000-0000000000a4', 'familia@promo.test', '{}'::jsonb);
select pg_temp.new_test_user('a4000000-0000-0000-0000-0000000000b1', 'admin-b@promo.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('a5000000-0000-0000-0000-0000000000a1', 'a4000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000001', 'admin_club'),
  ('a5000000-0000-0000-0000-0000000000a2', 'a4000000-0000-0000-0000-0000000000a2', 'a1000000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('a5000000-0000-0000-0000-0000000000a3', 'a4000000-0000-0000-0000-0000000000a3', 'a1000000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('a5000000-0000-0000-0000-0000000000a4', 'a4000000-0000-0000-0000-0000000000a4', 'a1000000-0000-0000-0000-000000000001', 'jugador'),
  ('a5000000-0000-0000-0000-0000000000b1', 'a4000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-000000000002', 'admin_club');

-- principal_sup = team_staff del equipo SUPERIOR (Cadete Primera).
-- principal_base = team_staff del equipo BASE (Cadete Segunda).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('a3000000-0000-0000-0000-000000000002', 'a5000000-0000-0000-0000-0000000000a2', 'entrenador_principal'),
  ('a3000000-0000-0000-0000-000000000001', 'a5000000-0000-0000-0000-0000000000a3', 'entrenador_principal');

-- ── Jugador (club A) en el equipo BASE (Cadete Segunda) ──────────────────────
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('a6000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Marc', 'Promo', '2010-03-01');

insert into public.team_members (team_id, player_id, joined_at) values
  ('a3000000-0000-0000-0000-000000000001', 'a6000000-0000-0000-0000-000000000001', (current_date - interval '90 days')::date);

-- Familia vinculada (relation self).
insert into public.player_accounts (player_id, profile_id, relation) values
  ('a6000000-0000-0000-0000-000000000001', 'a4000000-0000-0000-0000-0000000000a4', 'self');

-- ── Eventos (en los equipos destino) ─────────────────────────────────────────
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  -- superiores/objetivo (club A)
  ('a7000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'match',    'Cadete1 partido',  current_timestamp + interval '3 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000003', 'match',    'Cadete2b partido', current_timestamp + interval '3 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000005', 'match',    'Infantil partido', current_timestamp + interval '3 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000004', 'training', 'Juvenil entreno',  current_timestamp + interval '2 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000005', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000006', 'match',    'SinKind partido',  current_timestamp + interval '3 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000006', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'other',    'Cadete1 otro',     current_timestamp + interval '4 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000007', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'match',    'Cadete1 partido2', current_timestamp + interval '5 days', 'a4000000-0000-0000-0000-0000000000a1'),
  ('a7000000-0000-0000-0000-000000000008', 'a1000000-0000-0000-0000-000000000001', 'a3000000-0000-0000-0000-000000000002', 'match',    'Cadete1 partido3', current_timestamp + interval '6 days', 'a4000000-0000-0000-0000-0000000000a1'),
  -- club B (cross-club)
  ('a7000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-000000000002', 'a3000000-0000-0000-0000-000000000007', 'match',    'Cadete B partido', current_timestamp + interval '3 days', 'a4000000-0000-0000-0000-0000000000b1');

-- ═════════════════════════════════════════════════════════════════════════════
-- P1: admin sube por DIVISIÓN → OK; derivaciones + created_by forzado.
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claim.sub" to 'a4000000-0000-0000-0000-0000000000a1';

do $$
declare v_id uuid; r public.player_promotions%rowtype;
begin
  insert into public.player_promotions (player_id, event_id, team_id, kind, club_id, created_by)
  values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001',
          -- valores "basura" a propósito: el trigger debe sobreescribirlos.
          'a3000000-0000-0000-0000-000000000005', 'train', 'a1000000-0000-0000-0000-000000000002',
          'a4000000-0000-0000-0000-0000000000b1')
  returning id into v_id;

  select * into r from public.player_promotions where id = v_id;
  if r.kind <> 'match' then raise exception 'FAIL [P1]: kind no derivado a match (%)', r.kind; end if;
  if r.team_id <> 'a3000000-0000-0000-0000-000000000002' then raise exception 'FAIL [P1]: team_id no derivado'; end if;
  if r.club_id <> 'a1000000-0000-0000-0000-000000000001' then raise exception 'FAIL [P1]: club_id no derivado'; end if;
  if r.created_by is distinct from 'a4000000-0000-0000-0000-0000000000a1'::uuid then raise exception 'FAIL [P1]: created_by no forzado a auth.uid()'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P2: mismo nivel → promotion_target_not_superior.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000002',
            'a3000000-0000-0000-0000-000000000003', 'match', 'a1000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%promotion_target_not_superior%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [P2]: mismo nivel debería rechazarse'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P3: inferior (categoría) → promotion_target_not_superior.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000003',
            'a3000000-0000-0000-0000-000000000005', 'match', 'a1000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%promotion_target_not_superior%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [P3]: inferior debería rechazarse'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P4: cross-categoría (división peor, categoría superior, training) → OK; kind=train.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare v_id uuid; k text;
begin
  insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
  values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000004',
          'a3000000-0000-0000-0000-000000000004', 'match', 'a1000000-0000-0000-0000-000000000001')
  returning id into v_id;
  select kind into k from public.player_promotions where id = v_id;
  if k <> 'train' then raise exception 'FAIL [P4]: kind debería ser train (training) — got %', k; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P5: kind nulo en destino → promotion_target_not_superior.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000005',
            'a3000000-0000-0000-0000-000000000006', 'match', 'a1000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%promotion_target_not_superior%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [P5]: kind nulo en destino debería rechazarse'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P6: event.type='other' → event_type_not_promotable.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000006',
            'a3000000-0000-0000-0000-000000000002', 'match', 'a1000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlerrm like '%event_type_not_promotable%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [P6]: event.type=other debería rechazarse'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P7: cross-club → player_cross_club.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-0000000000b1',
            'a3000000-0000-0000-0000-000000000007', 'match', 'a1000000-0000-0000-0000-000000000002');
  exception when others then
    if sqlerrm like '%player_cross_club%' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [P7]: cross-club debería rechazarse'; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P8: UNIQUE (player_id, event_id) → 23505 (re-inserta la de P1).
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000001',
            'a3000000-0000-0000-0000-000000000002', 'match', 'a1000000-0000-0000-0000-000000000001');
  exception when unique_violation then
    ok := true;
  end;
  if not ok then raise exception 'FAIL [P8]: duplicado (player,event) debería 23505'; end if;
end $$;

reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- S1: familia VE la subida de su jugador.
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claim.sub" to 'a4000000-0000-0000-0000-0000000000a4';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.player_promotions
   where player_id = 'a6000000-0000-0000-0000-000000000001';
  if cnt < 2 then raise exception 'FAIL [S1]: familia no ve las subidas de su jugador (cnt=%)', cnt; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- S4: familia NO inserta → 42501.
-- ═════════════════════════════════════════════════════════════════════════════
do $$
declare ok boolean := false;
begin
  begin
    insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
    values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000007',
            'a3000000-0000-0000-0000-000000000002', 'match', 'a1000000-0000-0000-0000-000000000001');
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then raise exception 'FAIL [S4]: familia no debería poder insertar subidas'; end if;
end $$;

reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- S2: staff (principal) del equipo SUPERIOR INSERTA → OK.
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claim.sub" to 'a4000000-0000-0000-0000-0000000000a2';

do $$
declare v_id uuid;
begin
  insert into public.player_promotions (player_id, event_id, team_id, kind, club_id)
  values ('a6000000-0000-0000-0000-000000000001', 'a7000000-0000-0000-0000-000000000007',
          'a3000000-0000-0000-0000-000000000002', 'match', 'a1000000-0000-0000-0000-000000000001')
  returning id into v_id;
  if v_id is null then raise exception 'FAIL [S2]: principal del equipo superior no insertó'; end if;
end $$;

reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- S3: ajeno (admin de otro club) NO ve.
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claim.sub" to 'a4000000-0000-0000-0000-0000000000b1';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.player_promotions
   where player_id = 'a6000000-0000-0000-0000-000000000001';
  if cnt <> 0 then raise exception 'FAIL [S3]: admin de otro club ve la subida (cnt=%)', cnt; end if;
end $$;

reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- S5: admin/coord SÍ ve.
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claim.sub" to 'a4000000-0000-0000-0000-0000000000a1';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.player_promotions
   where player_id = 'a6000000-0000-0000-0000-000000000001';
  if cnt < 3 then raise exception 'FAIL [S5]: admin no ve las subidas (cnt=%)', cnt; end if;
end $$;

reset role;

-- ═════════════════════════════════════════════════════════════════════════════
-- S6: staff del equipo BASE VE la subida.
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claim.sub" to 'a4000000-0000-0000-0000-0000000000a3';

do $$
declare cnt int;
begin
  select count(*) into cnt from public.player_promotions
   where player_id = 'a6000000-0000-0000-0000-000000000001';
  if cnt < 1 then raise exception 'FAIL [S6]: staff del equipo base no ve la subida (cnt=%)', cnt; end if;
end $$;

reset role;

rollback;
