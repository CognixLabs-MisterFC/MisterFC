-- Tests F3.1 — RLS, constraints y helpers de events.
--
-- Cubre los casos enumerados en docs/specs/3.0-calendario-eventos.md §7.1:
--   C1  INSERT con campos válidos y team_id del propio club, como admin_club.
--   C2  INSERT con team_id de OTRO club → trigger 23514.
--   C3  INSERT con team_id + category_id ambos → CHECK 23514.
--   C4  INSERT con ends_at < starts_at → CHECK 23514.
--   C5  INSERT con parent_event_id + recurrence_rule simultáneos → CHECK rechaza.
--   C6  INSERT con type fuera del enum → CHECK rechaza.
--   R1  SELECT como miembro del club → ve eventos del club.
--   R2  SELECT como miembro de OTRO club → 0 rows.
--   R3  INSERT como admin_club, evento de equipo → OK.
--   R4  INSERT como coordinador, evento de club (team y category NULL) → OK.
--   R5  INSERT como entrenador_principal con team_staff activo → OK.
--   R6  INSERT como entrenador_principal a OTRO equipo del club → rechazado.
--   R7  INSERT como entrenador_ayudante SIN can_manage_calendar → rechazado.
--   R8  INSERT como entrenador_ayudante CON can_manage_calendar y staff activo → OK.
--   R9  INSERT como entrenador_principal de evento a nivel club (team_id NULL) → rechazado.
--   R10 INSERT como jugador → rechazado.
--   R11 UPDATE como entrenador_principal de su equipo → OK.
--   R12 DELETE como jugador → rechazado.
--   R13 DELETE cascade: borrar parent borra children.
--   H1  user_can_manage_event() devuelve true/false según rol/cap/team.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.clubs (id, name, slug) values
  ('11ab0000-c0c0-0000-0000-000000000001', 'Club Alfa Events', 'alfa-events'),
  ('11ab0000-c1c1-0000-0000-000000000001', 'Club Beta Events', 'beta-events');

insert into public.categories (id, club_id, name) values
  ('22ab0000-0000-0000-0000-000000000001', '11ab0000-c0c0-0000-0000-000000000001', 'Cat A1'),
  ('22ab0000-0000-0000-0000-000000000002', '11ab0000-c0c0-0000-0000-000000000001', 'Cat A2'),
  ('22ab0000-0000-0000-0000-000000000099', '11ab0000-c1c1-0000-0000-000000000001', 'Cat Beta');

insert into public.teams (id, category_id, name, format, color, season) values
  ('33ab0000-0000-0000-0000-000000000001', '22ab0000-0000-0000-0000-000000000001', 'Team A1', 'F7', '#10B981', '2025-26'),
  ('33ab0000-0000-0000-0000-000000000002', '22ab0000-0000-0000-0000-000000000002', 'Team A2', 'F11', '#3B82F6', '2025-26'),
  ('33ab0000-0000-0000-0000-000000000099', '22ab0000-0000-0000-0000-000000000099', 'Team Beta', 'F7', '#EF4444', '2025-26');

insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('44ab0000-1111-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-2222-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-3333-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-a1@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-3333-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'principal-a2@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-4444-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'asst-cap@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-4444-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'asst-nocap@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-5555-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jugador@ev.test', now(), '{}'::jsonb, now(), now()),
  ('44ab0000-9999-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin-beta@ev.test', now(), '{}'::jsonb, now(), now());

insert into public.memberships (id, profile_id, club_id, role) values
  ('55ab0000-1111-0000-0000-000000000001', '44ab0000-1111-0000-0000-000000000001', '11ab0000-c0c0-0000-0000-000000000001', 'admin_club'),
  ('55ab0000-2222-0000-0000-000000000001', '44ab0000-2222-0000-0000-000000000001', '11ab0000-c0c0-0000-0000-000000000001', 'coordinador'),
  ('55ab0000-3333-0000-0000-000000000001', '44ab0000-3333-0000-0000-000000000001', '11ab0000-c0c0-0000-0000-000000000001', 'entrenador_principal'),
  ('55ab0000-3333-0000-0000-000000000002', '44ab0000-3333-0000-0000-000000000002', '11ab0000-c0c0-0000-0000-000000000001', 'entrenador_principal'),
  ('55ab0000-4444-0000-0000-000000000001', '44ab0000-4444-0000-0000-000000000001', '11ab0000-c0c0-0000-0000-000000000001', 'entrenador_ayudante'),
  ('55ab0000-4444-0000-0000-000000000002', '44ab0000-4444-0000-0000-000000000002', '11ab0000-c0c0-0000-0000-000000000001', 'entrenador_ayudante'),
  ('55ab0000-5555-0000-0000-000000000001', '44ab0000-5555-0000-0000-000000000001', '11ab0000-c0c0-0000-0000-000000000001', 'jugador'),
  ('55ab0000-9999-0000-0000-000000000001', '44ab0000-9999-0000-0000-000000000001', '11ab0000-c1c1-0000-0000-000000000001', 'admin_club');

-- Staff activo: principal-a1 en Team A1, principal-a2 en Team A2.
-- asst-cap en Team A1 (con can_manage_calendar), asst-nocap en Team A1 (sin cap).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('33ab0000-0000-0000-0000-000000000001', '55ab0000-3333-0000-0000-000000000001', 'entrenador_principal'),
  ('33ab0000-0000-0000-0000-000000000002', '55ab0000-3333-0000-0000-000000000002', 'entrenador_principal'),
  ('33ab0000-0000-0000-0000-000000000001', '55ab0000-4444-0000-0000-000000000001', 'entrenador_ayudante'),
  ('33ab0000-0000-0000-0000-000000000001', '55ab0000-4444-0000-0000-000000000002', 'entrenador_ayudante');

-- asst-cap recibe can_manage_calendar = true; asst-nocap NO.
update public.capabilities
   set granted = true
 where membership_id = '55ab0000-4444-0000-0000-000000000001'
   and capability_name = 'can_manage_calendar';

-- ─────────────────────────────────────────────────────────────────────────────
-- C1 — INSERT con campos válidos como admin_club
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare new_id uuid;
begin
  insert into public.events (
    club_id, team_id, type, title, starts_at, created_by
  ) values (
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001',
    'training',
    'Entrenamiento C1',
    '2026-05-12 18:00:00+02',
    '44ab0000-1111-0000-0000-000000000001'
  ) returning id into new_id;
  if new_id is null then
    raise exception 'FAIL [C1]: insert válido devolvió NULL';
  end if;
exception when others then
  if sqlstate <> '00000' then
    raise exception 'FAIL [C1]: insert válido falló: % (sqlstate=%)', sqlerrm, sqlstate;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C2 — team_id de OTRO club → trigger 23514
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (club_id, team_id, type, title, starts_at, created_by)
    values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000099', -- team del club Beta
      'training', 'Cross-club', '2026-05-12 18:00:00+02',
      '44ab0000-1111-0000-0000-000000000001'
    );
  exception when others then
    if sqlstate = '23514' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [C2]: cross-club team_id debería disparar 23514';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C3 — team_id + category_id ambos → CHECK events_target_at_most_one
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (
      club_id, team_id, category_id, type, title, starts_at, created_by
    ) values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000001',
      '22ab0000-0000-0000-0000-000000000001',
      'tournament', 'Ambos seteados', '2026-05-12 18:00:00+02',
      '44ab0000-1111-0000-0000-000000000001'
    );
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C3]: team_id+category_id simultáneos deberían rechazarse';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C4 — ends_at < starts_at → CHECK events_window_valid
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (
      club_id, team_id, type, title, starts_at, ends_at, created_by
    ) values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000001',
      'training', 'Mal rango',
      '2026-05-12 19:00:00+02',
      '2026-05-12 18:00:00+02',
      '44ab0000-1111-0000-0000-000000000001'
    );
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C4]: ends_at < starts_at debería rechazarse';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C5 — parent_event_id + recurrence_rule simultáneos
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare parent_id uuid; ok boolean := false;
begin
  insert into public.events (
    club_id, team_id, type, title, starts_at, recurrence_rule, created_by
  ) values (
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001',
    'training', 'Parent C5',
    '2026-05-12 18:00:00+02',
    '{"freq":"weekly","interval":1,"by_weekday":[1],"count":2}'::jsonb,
    '44ab0000-1111-0000-0000-000000000001'
  ) returning id into parent_id;

  begin
    insert into public.events (
      club_id, team_id, type, title, starts_at, parent_event_id, recurrence_rule, created_by
    ) values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000001',
      'training', 'Child con regla (mal)',
      '2026-05-19 18:00:00+02',
      parent_id,
      '{"freq":"weekly","interval":1,"by_weekday":[1],"count":2}'::jsonb,
      '44ab0000-1111-0000-0000-000000000001'
    );
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C5]: child con recurrence_rule debería rechazarse';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- C6 — type fuera del enum
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (club_id, team_id, type, title, starts_at, created_by)
    values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000001',
      'fiesta', 'Tipo libre',
      '2026-05-12 18:00:00+02',
      '44ab0000-1111-0000-0000-000000000001'
    );
  exception when check_violation then
    ok := true;
  end;
  if not ok then
    raise exception 'FAIL [C6]: type fuera del enum debería rechazarse';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R1 — SELECT como miembro del club ve eventos
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"44ab0000-5555-0000-0000-000000000001","role":"authenticated"}';
do $$
declare cnt int;
begin
  select count(*) into cnt from public.events
   where club_id = '11ab0000-c0c0-0000-0000-000000000001';
  if cnt = 0 then
    raise exception 'FAIL [R1]: jugador del club no ve ningún evento (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R2 — SELECT como miembro de OTRO club → 0 rows
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-9999-0000-0000-000000000001","role":"authenticated"}';
do $$
declare cnt int;
begin
  select count(*) into cnt from public.events
   where club_id = '11ab0000-c0c0-0000-0000-000000000001';
  if cnt <> 0 then
    raise exception 'FAIL [R2]: admin de otro club ve eventos cross-club (cnt=%)', cnt;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R3 — admin_club inserta evento de equipo → OK
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-1111-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.events (club_id, team_id, type, title, starts_at, created_by)
  values (
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001',
    'match', 'R3 partido',
    '2026-05-13 11:00:00+02',
    '44ab0000-1111-0000-0000-000000000001'
  );
exception when others then
  raise exception 'FAIL [R3]: admin no pudo INSERT: % (sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R4 — coordinador inserta evento de club (team y category NULL) → OK
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-2222-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.events (club_id, type, title, starts_at, created_by)
  values (
    '11ab0000-c0c0-0000-0000-000000000001',
    'other', 'R4 gala anual',
    '2026-06-30 19:00:00+02',
    '44ab0000-2222-0000-0000-000000000001'
  );
exception when others then
  raise exception 'FAIL [R4]: coord no pudo INSERT evento de club: % (sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R5 — entrenador_principal con team_staff activo → OK (en SU equipo)
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-3333-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.events (club_id, team_id, type, title, starts_at, created_by)
  values (
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001',
    'training', 'R5 entreno principal',
    '2026-05-14 18:00:00+02',
    '44ab0000-3333-0000-0000-000000000001'
  );
exception when others then
  raise exception 'FAIL [R5]: principal de Team A1 no pudo INSERT en su equipo: % (sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R6 — entrenador_principal a OTRO equipo del mismo club → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (club_id, team_id, type, title, starts_at, created_by)
    values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000002', -- principal-a1 NO es staff de A2
      'training', 'R6 cross-team',
      '2026-05-14 18:00:00+02',
      '44ab0000-3333-0000-0000-000000000001'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R6]: principal de A1 pudo INSERT en A2 (no debería)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R7 — ayudante SIN can_manage_calendar → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-4444-0000-0000-000000000002","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (club_id, team_id, type, title, starts_at, created_by)
    values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000001',
      'training', 'R7 ayudante sin cap',
      '2026-05-14 18:00:00+02',
      '44ab0000-4444-0000-0000-000000000002'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R7]: ayudante sin can_manage_calendar pudo INSERT';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R8 — ayudante CON can_manage_calendar y staff activo → OK
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-4444-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  insert into public.events (club_id, team_id, type, title, starts_at, created_by)
  values (
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001',
    'training', 'R8 ayudante con cap',
    '2026-05-14 18:30:00+02',
    '44ab0000-4444-0000-0000-000000000001'
  );
exception when others then
  raise exception 'FAIL [R8]: ayudante con can_manage_calendar no pudo INSERT: % (sqlstate=%)', sqlerrm, sqlstate;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R9 — entrenador_principal de evento a nivel club (team_id NULL) → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-3333-0000-0000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (club_id, type, title, starts_at, created_by)
    values (
      '11ab0000-c0c0-0000-0000-000000000001',
      'other', 'R9 club-wide del principal',
      '2026-07-01 19:00:00+02',
      '44ab0000-3333-0000-0000-000000000001'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R9]: principal pudo INSERT evento a nivel club (no debería)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R10 — jugador INSERT → rechazado
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-5555-0000-0000-000000000001","role":"authenticated"}';
do $$
declare ok boolean := false;
begin
  begin
    insert into public.events (club_id, team_id, type, title, starts_at, created_by)
    values (
      '11ab0000-c0c0-0000-0000-000000000001',
      '33ab0000-0000-0000-0000-000000000001',
      'training', 'R10 jugador',
      '2026-05-14 18:00:00+02',
      '44ab0000-5555-0000-0000-000000000001'
    );
  exception when others then
    if sqlstate = '42501' then ok := true; end if;
  end;
  if not ok then
    raise exception 'FAIL [R10]: jugador pudo INSERT';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R11 — UPDATE como entrenador_principal de su equipo → OK
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-3333-0000-0000-000000000001","role":"authenticated"}';
do $$
declare upd int;
begin
  update public.events
     set title = title || ' [edit R11]'
   where team_id = '33ab0000-0000-0000-0000-000000000001'
     and title = 'R5 entreno principal';
  get diagnostics upd = row_count;
  if upd = 0 then
    raise exception 'FAIL [R11]: principal no pudo UPDATE evento de su equipo (rows=0)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R12 — DELETE como jugador → rechazado (rows = 0, no llega a tocar policy con WHERE válido)
-- Hacemos DELETE explícito por id existente: el jugador VE las filas pero RLS DELETE
-- no debería permitir borrarlas. row_count tras DELETE filtrado = 0.
-- ─────────────────────────────────────────────────────────────────────────────
set local "request.jwt.claims" = '{"sub":"44ab0000-5555-0000-0000-000000000001","role":"authenticated"}';
do $$
declare del int;
begin
  delete from public.events
   where club_id = '11ab0000-c0c0-0000-0000-000000000001'
     and title = 'R5 entreno principal [edit R11]';
  get diagnostics del = row_count;
  if del <> 0 then
    raise exception 'FAIL [R12]: jugador pudo DELETE (rows=%)', del;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- R13 — DELETE cascade: borrar parent borra children
-- ─────────────────────────────────────────────────────────────────────────────
reset role;
do $$
declare parent_id uuid; remaining int;
begin
  insert into public.events (
    club_id, team_id, type, title, starts_at,
    recurrence_rule, created_by
  ) values (
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001',
    'training', 'R13 parent',
    '2026-05-19 18:00:00+02',
    '{"freq":"weekly","interval":1,"by_weekday":[1],"count":2}'::jsonb,
    '44ab0000-1111-0000-0000-000000000001'
  ) returning id into parent_id;

  insert into public.events (
    club_id, team_id, type, title, starts_at, parent_event_id, created_by
  ) values
  ('11ab0000-c0c0-0000-0000-000000000001', '33ab0000-0000-0000-0000-000000000001',
   'training', 'R13 child 1', '2026-05-26 18:00:00+02', parent_id,
   '44ab0000-1111-0000-0000-000000000001'),
  ('11ab0000-c0c0-0000-0000-000000000001', '33ab0000-0000-0000-0000-000000000001',
   'training', 'R13 child 2', '2026-06-02 18:00:00+02', parent_id,
   '44ab0000-1111-0000-0000-000000000001');

  delete from public.events where id = parent_id;

  select count(*) into remaining from public.events where parent_event_id = parent_id;
  if remaining <> 0 then
    raise exception 'FAIL [R13]: children no se borraron en cascade (remaining=%)', remaining;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- H1 — user_can_manage_event helper
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
do $$
declare got boolean;
begin
  -- admin → siempre true
  perform set_config('request.jwt.claims',
    '{"sub":"44ab0000-1111-0000-0000-000000000001","role":"authenticated"}', true);
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001'
  ) into got;
  if got is not true then
    raise exception 'FAIL [H1.a]: admin debería poder manage';
  end if;

  -- principal en su equipo → true
  perform set_config('request.jwt.claims',
    '{"sub":"44ab0000-3333-0000-0000-000000000001","role":"authenticated"}', true);
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001'
  ) into got;
  if got is not true then
    raise exception 'FAIL [H1.b]: principal en su equipo debería poder manage';
  end if;

  -- principal en OTRO equipo → false
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000002'
  ) into got;
  if got is not false then
    raise exception 'FAIL [H1.c]: principal de A1 no debería poder manage A2 (got=%)', got;
  end if;

  -- ayudante con cap en su equipo → true
  perform set_config('request.jwt.claims',
    '{"sub":"44ab0000-4444-0000-0000-000000000001","role":"authenticated"}', true);
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001'
  ) into got;
  if got is not true then
    raise exception 'FAIL [H1.d]: ayudante con can_manage_calendar debería poder manage su equipo';
  end if;

  -- ayudante sin cap en su equipo → false
  perform set_config('request.jwt.claims',
    '{"sub":"44ab0000-4444-0000-0000-000000000002","role":"authenticated"}', true);
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001'
  ) into got;
  if got is not false then
    raise exception 'FAIL [H1.e]: ayudante sin cap no debería poder manage (got=%)', got;
  end if;

  -- jugador → false
  perform set_config('request.jwt.claims',
    '{"sub":"44ab0000-5555-0000-0000-000000000001","role":"authenticated"}', true);
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    '33ab0000-0000-0000-0000-000000000001'
  ) into got;
  if got is not false then
    raise exception 'FAIL [H1.f]: jugador no debería poder manage (got=%)', got;
  end if;

  -- evento a nivel club: solo admin/coord (sin team_id)
  perform set_config('request.jwt.claims',
    '{"sub":"44ab0000-3333-0000-0000-000000000001","role":"authenticated"}', true);
  select public.user_can_manage_event(
    '11ab0000-c0c0-0000-0000-000000000001',
    NULL
  ) into got;
  if got is not false then
    raise exception 'FAIL [H1.g]: principal no debería poder manage evento de club (got=%)', got;
  end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ Tests RLS events + capability + helper pasaron.'
\echo '──────────────────────────────────────────────'
