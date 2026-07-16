-- Tests F8.1 — triggers de coherencia y RLS de valoraciones
-- (migración 20260622000000_evaluations.sql).
--
-- Convención del repo (ver rls_match_live_capture.sql): psql con ON_ERROR_STOP=1; cada
-- bloque que DEBE fallar se envuelve en un DO con EXCEPTION capturando el SQLSTATE
-- esperado y un `raise exception 'FAIL [...]'` si NO falla. Todo en una transacción con
-- ROLLBACK final → no deja rastro en la BD remota. El barrido RLS completo es 8.6.
--
-- Casos:
--   Triggers / constraints (superuser, RLS bypass):
--     C1.  match + rating NULL (con comment)        → check_violation (rating_required_for_match).
--     C2.  match + is_mvp true + rating NULL         → check_violation (rating_required_for_match).
--     C3.  match + rating 7                          → OK; club_id/team_id/event_type derivados.
--     C4.  training + solo comment (rating NULL)     → OK (rating opcional en entreno).
--     C5.  training totalmente vacía                 → check_violation (empty_evaluation).
--     C6.  rating 11                                 → check_violation (CHECK rango).
--     C7.  player ajeno al team del evento           → check_violation (player_not_in_team_at_event).
--     C8.  dos MVP en el mismo evento                → unique_violation (índice parcial).
--     C9.  event_id inmutable en UPDATE              → check_violation.
--     C9b. created_by inmutable en UPDATE            → check_violation.
--     C10. post_match_done se resetea al reabrir      → status live ⇒ post_match_done=false.
--   Triggers evaluation_private_notes (independiente de evaluations, superuser):
--     CP1. nota privada en match SIN valoración previa  → OK; club/team derivados.
--     CP2. nota privada en entreno                      → check_violation (event_not_a_match).
--     CP3. nota privada jugador ajeno al team           → check_violation (player_not_in_team).
--   RLS evaluations (role-switched):
--     R1.  principal del team inserta                → OK; created_by forzado a auth.uid().
--     R2.  admin del club inserta                     → OK.
--     R3.  coordinador del club inserta               → OK.
--     R4.  jugador inserta                            → forbidden (42501).
--     R5.  staff de OTRO team inserta                 → forbidden (42501).
--     R6.  admin de OTRO club inserta                 → forbidden (42501).
--     R7.  flag OFF: jugador y familia ven 0 filas.
--     R8.  flag ON: jugador y familia ven SU valoración (1 fila).
--     R9.  flag ON: jugador NO ve la valoración de un compañero (player-scoped) → 0.
--     R10. staff ve la valoración con flag OFF (no depende del flag).
--     R18. flag ON: familia NO ve la de un compañero (player-scoped, D2) → 0.
--     R19. staff de OTRO equipo (mismo club) NO lee las valoraciones → 0.
--     R20. entrenador AYUDANTE (team_staff) actualiza               → OK (recorder).
--     R21. principal ACTUALIZA (staff CRUD - update)                → OK.
--     R22. jugador intenta actualizar su valoración                 → RLS filtra (0 filas).
--     R23. jugador intenta borrar su valoración                     → RLS filtra (0 filas).
--     R24. principal BORRA (staff CRUD - delete)                    → OK (1 fila).
--   RLS evaluation_private_notes:
--     R11. principal inserta nota privada            → OK; created_by forzado.
--     R12. jugador (flag ON) lee notas privadas       → 0 filas (NUNCA expuesta).
--     R12b. familia (flag ON) lee notas privadas      → 0 filas (NUNCA expuesta).
--     R13. jugador inserta nota privada               → forbidden (42501).
--     R25. staff de OTRO equipo lee la nota privada    → 0 filas.
--     R26. principal ACTUALIZA la nota privada         → OK (staff CRUD).
--     R27. principal BORRA la nota privada             → OK (staff CRUD).
--   RLS club_settings:
--     R14. admin upsert club_settings                 → OK.
--     R15. coordinador escribe club_settings          → forbidden (42501) (D10: solo admin).
--     R16. coordinador lee club_settings              → OK (1 fila).
--     R17. jugador lee club_settings                  → 0 filas.
--     R28. entrenador (staff no-admin) escribe el flag → RLS filtra (0 filas).
--     R29. entrenador lee club_settings                → 0 filas (SELECT solo admin+coord).
--     R30. jugador escribe el flag                     → RLS filtra (0 filas).
--     R31. el flag sigue en false tras R28/R30.
\ir helpers/auth_users.sql

begin;

-- ── Fixtures ────────────────────────────────────────────────────────────────
insert into public.clubs (id, name, slug) values
  ('88f80000-0000-0000-0000-000000000001', 'Club F8 A', 'club-f8-a'),
  ('88f80000-0000-0000-0000-000000000002', 'Club F8 B', 'club-f8-b');

select pg_temp.new_test_user('88f80000-aaaa-0001-0000-000000000000', 'admin-f8-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-aaaa-0002-0000-000000000000', 'principal-f8-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-aaaa-0003-0000-000000000000', 'coord-f8-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-aaaa-0004-0000-000000000000', 'jugador-f8-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-aaaa-0005-0000-000000000000', 'familia-f8-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-aaaa-0006-0000-000000000000', 'staff-team2-f8@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-aaaa-0007-0000-000000000000', 'ayudante-f8-a@ts.test', '{}'::jsonb);
select pg_temp.new_test_user('88f80000-bbbb-0001-0000-000000000000', 'admin-f8-b@ts.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('88f80000-5550-0001-0000-000000000000', '88f80000-aaaa-0001-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'admin_club'),
  ('88f80000-5550-0002-0000-000000000000', '88f80000-aaaa-0002-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('88f80000-5550-0003-0000-000000000000', '88f80000-aaaa-0003-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'coordinador'),
  ('88f80000-5550-0004-0000-000000000000', '88f80000-aaaa-0004-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'jugador'),
  ('88f80000-5550-0005-0000-000000000000', '88f80000-aaaa-0005-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'jugador'),
  ('88f80000-5550-0006-0000-000000000000', '88f80000-aaaa-0006-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'entrenador_principal'),
  ('88f80000-5550-0008-0000-000000000000', '88f80000-aaaa-0007-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'entrenador_ayudante'),
  ('88f80000-5550-0007-0000-000000000000', '88f80000-bbbb-0001-0000-000000000000', '88f80000-0000-0000-0000-000000000002', 'admin_club');

insert into public.categories (id, club_id, name) values
  ('88f80000-0dd0-0001-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'Cat F8 A');

insert into public.teams (id, category_id, name, format, color, season) values
  ('88f80000-0ee1-0001-0000-000000000000', '88f80000-0dd0-0001-0000-000000000000', 'Team 1', 'F7', '#0EA5E9', '2025-26'),
  ('88f80000-0ee1-0002-0000-000000000000', '88f80000-0dd0-0001-0000-000000000000', 'Team 2', 'F7', '#F59E0B', '2025-26');

-- principal + ayudante → team1; staff-team2 → team2.
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('88f80000-0ee1-0001-0000-000000000000', '88f80000-5550-0002-0000-000000000000', 'entrenador_principal'),
  ('88f80000-0ee1-0001-0000-000000000000', '88f80000-5550-0008-0000-000000000000', 'entrenador_ayudante'),
  ('88f80000-0ee1-0002-0000-000000000000', '88f80000-5550-0006-0000-000000000000', 'entrenador_principal');

-- players: p1, p2 en team1; pX solo en team2 (ajeno al roster de team1).
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('88f80000-0c00-0001-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'Pau',  'Uno', '2010-01-01'),
  ('88f80000-0c00-0002-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'Dani', 'Dos', '2010-02-02'),
  ('88f80000-0c00-0003-0000-000000000000', '88f80000-0000-0000-0000-000000000001', 'Iker', 'Tres','2010-03-03');

insert into public.team_members (player_id, team_id, joined_at) values
  ('88f80000-0c00-0001-0000-000000000000', '88f80000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('88f80000-0c00-0002-0000-000000000000', '88f80000-0ee1-0001-0000-000000000000', '2025-08-01'),
  ('88f80000-0c00-0003-0000-000000000000', '88f80000-0ee1-0002-0000-000000000000', '2025-08-01');

-- cuentas: jugador-f8-a = self de p1; familia-f8-a = parent de p1.
insert into public.player_accounts (player_id, profile_id, relation) values
  ('88f80000-0c00-0001-0000-000000000000', '88f80000-aaaa-0004-0000-000000000000', 'self'),
  ('88f80000-0c00-0001-0000-000000000000', '88f80000-aaaa-0005-0000-000000000000', 'parent');

-- events: match + training (team1).
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0000-0000-0000-000000000001', '88f80000-0ee1-0001-0000-000000000000', 'match',    'Partido liga', '2026-03-01 10:00:00+00', '88f80000-aaaa-0002-0000-000000000000'),
  ('88f80000-0ee0-0002-0000-000000000000', '88f80000-0000-0000-0000-000000000001', '88f80000-0ee1-0001-0000-000000000000', 'training', 'Entreno',      '2026-03-05 18:00:00+00', '88f80000-aaaa-0002-0000-000000000000');

-- ── Triggers / constraints (superuser, RLS bypass) ───────────────────────────

-- C1. match + rating NULL (con comment) → check_violation.
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, comment, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 'buen partido', '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C1]: match con rating NULL debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C2. match + is_mvp true + rating NULL → check_violation.
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, is_mvp, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', true, '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C2]: match con MVP sin rating debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C3. match + rating 7 → OK; club_id/team_id/event_type derivados (ignora lo pasado).
do $$
declare v_club uuid; v_team uuid; v_type text;
begin
  insert into public.evaluations (event_id, player_id, club_id, team_id, event_type, rating, created_by)
    values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000',
            '88f80000-0000-0000-0000-000000000002', '88f80000-0ee1-0002-0000-000000000000', 'training', 7, '88f80000-aaaa-0002-0000-000000000000')
    returning club_id, team_id, event_type into v_club, v_team, v_type;
  if v_club <> '88f80000-0000-0000-0000-000000000001'
     or v_team <> '88f80000-0ee1-0001-0000-000000000000'
     or v_type <> 'match' then
    raise exception 'FAIL [C3]: club_id/team_id/event_type deberían derivarse del evento (got %, %, %)', v_club, v_team, v_type;
  end if;
exception when others then
  if sqlstate <> 'P0001' then raise exception 'FAIL [C3]: match con rating 7 debería permitirse: %', sqlerrm; else raise; end if;
end $$;

-- C4. training + solo comment (rating NULL) → OK.
do $$ begin
  insert into public.evaluations (event_id, player_id, comment, created_by)
    values ('88f80000-0ee0-0002-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 'gran actitud', '88f80000-aaaa-0002-0000-000000000000');
exception when check_violation then
  raise exception 'FAIL [C4]: training con solo comentario debería permitirse';
end $$;

-- C5. training totalmente vacía → check_violation (empty_evaluation).
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, created_by)
      values ('88f80000-0ee0-0002-0000-000000000000', '88f80000-0c00-0002-0000-000000000000', '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C5]: valoración vacía debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C6. rating 11 → check_violation.
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, rating, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0002-0000-000000000000', 11, '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C6]: rating 11 debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C7. player ajeno al team del evento (pX de team2 en match de team1) → check_violation.
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, rating, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0003-0000-000000000000', 6, '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C7]: player ajeno al team debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- C8. dos MVP en el mismo evento → unique_violation.
do $$ begin
  -- la fila de C3 (p1, match) NO es MVP; creamos p2 MVP, luego p1 MVP → choca.
  update public.evaluations set is_mvp = true
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  begin
    insert into public.evaluations (event_id, player_id, rating, is_mvp, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0002-0000-000000000000', 8, true, '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [C8]: segundo MVP en el mismo evento debería rechazarse';
  exception when unique_violation then null; end;
  -- restaurar para no afectar a casos siguientes
  update public.evaluations set is_mvp = false
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
end $$;

-- C9. event_id inmutable en UPDATE → check_violation.
do $$ begin
  begin
    update public.evaluations set event_id = '88f80000-0ee0-0002-0000-000000000000'
      where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
    raise exception 'FAIL [C9]: event_id no debería poder cambiar';
  exception when check_violation then null; end;
end $$;

-- C9b. created_by inmutable en UPDATE → check_violation.
do $$ begin
  begin
    update public.evaluations set created_by = '88f80000-aaaa-0003-0000-000000000000'
      where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
    raise exception 'FAIL [C9b]: created_by no debería poder cambiar';
  exception when check_violation then null; end;
end $$;

-- C10. post_match_done se resetea al reabrir (status vuelve a live).
do $$
declare v_done boolean;
begin
  insert into public.match_state (event_id, status, post_match_done)
    values ('88f80000-0ee0-0001-0000-000000000000', 'closed', true);
  update public.match_state set status = 'live'
    where event_id = '88f80000-0ee0-0001-0000-000000000000'
    returning post_match_done into v_done;
  if v_done is distinct from false then
    raise exception 'FAIL [C10]: post_match_done debería resetearse a false al reabrir (got %)', v_done;
  end if;
  delete from public.match_state where event_id = '88f80000-0ee0-0001-0000-000000000000';
end $$;

-- ── Triggers / constraints evaluation_private_notes (superuser, RLS bypass) ──
-- La nota privada es INDEPENDIENTE de evaluations (sin FK): la integridad la
-- impone su propio trigger (partido + jugador en roster + deriva club/team).

-- CP1. nota privada en match SIN valoración individual previa del jugador → OK;
--      club_id/team_id derivados (ignora lo pasado). Prueba la independencia.
do $$
declare v_club uuid; v_team uuid; n int;
begin
  -- p2 NO tiene fila en evaluations para este evento.
  select count(*) into n from public.evaluations
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0002-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [CP1 setup]: p2 no debería tener valoración previa (got %)', n; end if;

  insert into public.evaluation_private_notes (event_id, player_id, note, club_id, team_id, created_by)
    values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0002-0000-000000000000', 'apunte interno sin nota individual',
            '88f80000-0000-0000-0000-000000000002', '88f80000-0ee1-0002-0000-000000000000', '88f80000-aaaa-0002-0000-000000000000')
    returning club_id, team_id into v_club, v_team;
  if v_club <> '88f80000-0000-0000-0000-000000000001'
     or v_team <> '88f80000-0ee1-0001-0000-000000000000' then
    raise exception 'FAIL [CP1]: club_id/team_id deberían derivarse del evento (got %, %)', v_club, v_team;
  end if;
  delete from public.evaluation_private_notes
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0002-0000-000000000000';
end $$;

-- CP2. nota privada en un ENTRENO → check_violation (event_not_a_match): solo partidos.
do $$ begin
  begin
    insert into public.evaluation_private_notes (event_id, player_id, note, club_id, team_id, created_by)
      values ('88f80000-0ee0-0002-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 'en entreno no',
              '88f80000-0000-0000-0000-000000000001', '88f80000-0ee1-0001-0000-000000000000', '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [CP2]: nota privada en entreno debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- CP3. nota privada para jugador ajeno al team del evento (p3/team2) → check_violation.
do $$ begin
  begin
    insert into public.evaluation_private_notes (event_id, player_id, note, club_id, team_id, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0003-0000-000000000000', 'jugador ajeno',
              '88f80000-0000-0000-0000-000000000001', '88f80000-0ee1-0001-0000-000000000000', '88f80000-aaaa-0002-0000-000000000000');
    raise exception 'FAIL [CP3]: nota privada para jugador ajeno al team debería rechazarse';
  exception when check_violation then null; end;
end $$;

-- limpiar la valoración sembrada en C3/C4 para empezar la sección RLS en limpio.
delete from public.evaluations;

-- ── RLS evaluations (role-switched) ──────────────────────────────────────────

-- R1. principal del team inserta → OK; created_by forzado a auth.uid().
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare v_by uuid;
begin
  insert into public.evaluations (event_id, player_id, rating, comment, created_by)
    values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 8, 'crack', '00000000-0000-0000-0000-000000000000')
    returning created_by into v_by;
  if v_by <> '88f80000-aaaa-0002-0000-000000000000' then
    raise exception 'FAIL [R1]: created_by debería forzarse a auth.uid() (got %)', v_by;
  end if;
exception when insufficient_privilege then
  raise exception 'FAIL [R1]: principal debería poder insertar';
end $$;
reset role;

-- R2. admin del club inserta (p2) → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0001-0000-000000000000';
do $$ begin
  insert into public.evaluations (event_id, player_id, rating, created_by)
    values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0002-0000-000000000000', 6, '00000000-0000-0000-0000-000000000000');
exception when insufficient_privilege then
  raise exception 'FAIL [R2]: admin debería poder insertar';
end $$;
reset role;

-- R3. coordinador inserta (training, p1) → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0003-0000-000000000000';
do $$ begin
  insert into public.evaluations (event_id, player_id, comment, created_by)
    values ('88f80000-0ee0-0002-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 'buen entreno', '00000000-0000-0000-0000-000000000000');
exception when insufficient_privilege then
  raise exception 'FAIL [R3]: coordinador debería poder insertar';
end $$;
reset role;

-- R4. jugador inserta → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, rating, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 9, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R4]: jugador no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R5. staff de OTRO team inserta → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0006-0000-000000000000';
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, rating, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 5, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R5]: staff de otro team no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R6. admin de OTRO club inserta → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-bbbb-0001-0000-000000000000';
do $$ begin
  begin
    insert into public.evaluations (event_id, player_id, rating, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 5, '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R6]: admin de otro club no debería poder insertar';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R7. flag OFF (sin fila club_settings): jugador y familia ven 0 filas de evaluations.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '88f80000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R7]: jugador no debería ver valoraciones con flag OFF (got %)', n; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0005-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '88f80000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R7]: familia no debería ver valoraciones con flag OFF (got %)', n; end if;
end $$;
reset role;

-- activar visibilidad (como admin del club).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0001-0000-000000000000';
do $$ begin
  insert into public.club_settings (club_id, evaluations_player_visibility)
    values ('88f80000-0000-0000-0000-000000000001', true);
exception when insufficient_privilege then
  raise exception 'FAIL [setup R8]: admin debería poder activar la visibilidad';
end $$;
reset role;

-- R8. flag ON: jugador y familia ven SUS valoraciones (p1: match + training = 2 filas).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '88f80000-0c00-0001-0000-000000000000';
  if n <> 2 then raise exception 'FAIL [R8]: jugador debería ver sus 2 valoraciones con flag ON (got %)', n; end if;
end $$;
reset role;
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0005-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '88f80000-0c00-0001-0000-000000000000';
  if n <> 2 then raise exception 'FAIL [R8]: familia debería ver las 2 valoraciones de su jugador con flag ON (got %)', n; end if;
end $$;
reset role;

-- R9. flag ON: jugador (de p1) NO ve la valoración de p2 (player-scoped).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '88f80000-0c00-0002-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R9]: jugador no debería ver valoraciones de un compañero (got %)', n; end if;
end $$;
reset role;

-- R10. staff (principal) ve todas las valoraciones del partido (no depende del flag).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where event_id = '88f80000-0ee0-0001-0000-000000000000';
  if n <> 2 then raise exception 'FAIL [R10]: staff debería ver las 2 valoraciones del partido (got %)', n; end if;
end $$;
reset role;

-- R18. familia (flag ON) NO ve la valoración de un compañero (player-scoped, D2).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0005-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where player_id = '88f80000-0c00-0002-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R18]: familia no debería ver valoraciones de un compañero (got %)', n; end if;
end $$;
reset role;

-- R19. staff de OTRO equipo (mismo club) NO lee las valoraciones del partido de team1
--      (no es recorder de ese evento ni cuenta de sus jugadores). Independiente del flag.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0006-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluations
    where event_id = '88f80000-0ee0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R19]: staff de otro equipo no debería ver las valoraciones (got %)', n; end if;
end $$;
reset role;

-- R20. entrenador AYUDANTE del team (team_staff activo) es recorder → puede ACTUALIZAR.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0007-0000-000000000000';
do $$
declare n int;
begin
  update public.evaluations set comment = 'ajuste del ayudante'
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [R20]: el ayudante debería poder actualizar (filas afectadas %)', n; end if;
exception when insufficient_privilege then
  raise exception 'FAIL [R20]: el ayudante (team_staff) debería ser recorder';
end $$;
reset role;

-- R21. principal ACTUALIZA la valoración (staff CRUD - update) → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  update public.evaluations set rating = 9
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [R21]: principal debería poder actualizar (filas %)', n; end if;
end $$;
reset role;

-- R22. jugador intenta ACTUALIZAR su valoración → la RLS filtra (0 filas, sin efecto).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  update public.evaluations set rating = 1
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [R22]: jugador no debería poder actualizar su valoración (filas %)', n; end if;
exception when insufficient_privilege then null; end $$;
reset role;

-- R23. jugador intenta BORRAR su valoración → la RLS filtra (0 filas, sin efecto).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  delete from public.evaluations
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [R23]: jugador no debería poder borrar su valoración (filas %)', n; end if;
exception when insufficient_privilege then null; end $$;
reset role;

-- R24. principal BORRA una valoración (staff CRUD - delete) → OK (1 fila).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  delete from public.evaluations
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0002-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [R24]: principal debería poder borrar (filas %)', n; end if;
end $$;
reset role;

-- ── RLS evaluation_private_notes ─────────────────────────────────────────────

-- R11. principal inserta nota privada (event match, p1) → OK; created_by forzado.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare v_by uuid;
begin
  insert into public.evaluation_private_notes (event_id, player_id, note, created_by)
    values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 'no decirle aun lo del puesto', '00000000-0000-0000-0000-000000000000')
    returning created_by into v_by;
  if v_by <> '88f80000-aaaa-0002-0000-000000000000' then
    raise exception 'FAIL [R11]: created_by de la nota privada debería forzarse (got %)', v_by;
  end if;
exception when insufficient_privilege then
  raise exception 'FAIL [R11]: principal debería poder insertar nota privada';
end $$;
reset role;

-- R12. jugador (flag ON) lee notas privadas → 0 filas (NUNCA expuesta).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where player_id = '88f80000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R12]: jugador NUNCA debería leer notas privadas (got %)', n; end if;
end $$;
reset role;
-- R12b. familia (flag ON) lee notas privadas → 0 filas (NUNCA expuesta).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0005-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where player_id = '88f80000-0c00-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R12b]: familia NUNCA debería leer notas privadas (got %)', n; end if;
end $$;
reset role;

-- R13. jugador inserta nota privada → forbidden.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$ begin
  begin
    insert into public.evaluation_private_notes (event_id, player_id, note, created_by)
      values ('88f80000-0ee0-0001-0000-000000000000', '88f80000-0c00-0001-0000-000000000000', 'hack', '00000000-0000-0000-0000-000000000000');
    raise exception 'FAIL [R13]: jugador no debería poder insertar nota privada';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R25. staff de OTRO equipo (mismo club) NO lee la nota privada de team1 → 0.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0006-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.evaluation_private_notes
    where event_id = '88f80000-0ee0-0001-0000-000000000000';
  if n <> 0 then raise exception 'FAIL [R25]: staff de otro equipo no debería leer la nota privada (got %)', n; end if;
end $$;
reset role;

-- R26. principal ACTUALIZA la nota privada (staff CRUD) → OK (1 fila).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  update public.evaluation_private_notes set note = 'actualizada'
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [R26]: principal debería poder actualizar la nota privada (filas %)', n; end if;
end $$;
reset role;

-- R27. principal BORRA la nota privada (staff CRUD) → OK (1 fila).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  delete from public.evaluation_private_notes
    where event_id = '88f80000-0ee0-0001-0000-000000000000' and player_id = '88f80000-0c00-0001-0000-000000000000';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [R27]: principal debería poder borrar la nota privada (filas %)', n; end if;
end $$;
reset role;

-- ── RLS club_settings ────────────────────────────────────────────────────────

-- R14. admin upsert club_settings → OK.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0001-0000-000000000000';
do $$ begin
  update public.club_settings set evaluations_player_visibility = false
    where club_id = '88f80000-0000-0000-0000-000000000001';
exception when insufficient_privilege then
  raise exception 'FAIL [R14]: admin debería poder escribir club_settings';
end $$;
reset role;

-- R15. coordinador escribe club_settings → forbidden (D10).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0003-0000-000000000000';
do $$ begin
  begin
    update public.club_settings set evaluations_player_visibility = true
      where club_id = '88f80000-0000-0000-0000-000000000001';
    -- si no afecta filas por RLS, el UPDATE no lanza; comprobamos abajo en R16 que sigue false.
    if not found then null; end if;
  exception when insufficient_privilege then null; end;
end $$;
reset role;

-- R16. coordinador lee club_settings → OK (1 fila) y sigue en false (R15 no la cambió).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0003-0000-000000000000';
do $$
declare n int; v boolean;
begin
  select count(*), bool_or(evaluations_player_visibility) into n, v
    from public.club_settings where club_id = '88f80000-0000-0000-0000-000000000001';
  if n <> 1 then raise exception 'FAIL [R16]: coordinador debería leer club_settings (got % filas)', n; end if;
  if v is distinct from false then raise exception 'FAIL [R16/R15]: coordinador no debería haber podido poner el flag a true'; end if;
end $$;
reset role;

-- R17. jugador lee club_settings → 0 filas.
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.club_settings where club_id = '88f80000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL [R17]: jugador no debería leer club_settings (got %)', n; end if;
end $$;
reset role;

-- R28. entrenador principal (staff, no admin) escribe club_settings → la RLS filtra
--      (0 filas; el flag sigue false). Solo el admin escribe (D10).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  update public.club_settings set evaluations_player_visibility = true
    where club_id = '88f80000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [R28]: el staff no-admin no debería poder cambiar el flag (filas %)', n; end if;
exception when insufficient_privilege then null; end $$;
reset role;

-- R29. entrenador principal lee club_settings → 0 filas (SELECT solo admin+coord).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0002-0000-000000000000';
do $$
declare n int;
begin
  select count(*) into n from public.club_settings where club_id = '88f80000-0000-0000-0000-000000000001';
  if n <> 0 then raise exception 'FAIL [R29]: el entrenador no debería leer club_settings (got %)', n; end if;
end $$;
reset role;

-- R30. jugador escribe club_settings → la RLS filtra (0 filas; sigue false).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0004-0000-000000000000';
do $$
declare n int;
begin
  update public.club_settings set evaluations_player_visibility = true
    where club_id = '88f80000-0000-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [R30]: el jugador no debería poder cambiar el flag (filas %)', n; end if;
exception when insufficient_privilege then null; end $$;
reset role;

-- R31. tras R28/R30, el flag sigue en false (nadie no-admin lo cambió).
set local role authenticated;
set local "request.jwt.claim.sub" to '88f80000-aaaa-0001-0000-000000000000';
do $$
declare v boolean;
begin
  select evaluations_player_visibility into v from public.club_settings
    where club_id = '88f80000-0000-0000-0000-000000000001';
  if v is distinct from false then raise exception 'FAIL [R31]: el flag debería seguir en false (got %)', v; end if;
end $$;
reset role;

rollback;
