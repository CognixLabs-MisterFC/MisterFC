-- Tests F11.1 — RLS, máquina de estados y autoridad de `exercises`.
--
-- Cubre: INSERT (autor con capability, sin capability, principal vía team_staff,
-- coord, jugador, ajeno al club, no-Admin→published, Admin→published, →rejected);
-- SELECT por estado (draft/proposed/rejected/published) y por rol; transición
-- gateada por Admin (publicar/rechazar, motivo obligatorio); archivar vs borrar;
-- y el seed de la capability por el trigger ensure_assistant_capabilities.
--
-- Estilo: aserciones con raise exception (como el resto del repo). Transaccional.
\ir helpers/auth_users.sql

begin;

-- ── IDs ──────────────────────────────────────────────────────────────────────
-- club A = ...01, club B = ...02
-- users: admin a, coord b, principal c, ayudante(cap) d, ayudante(sin cap) e,
--        jugador f, adminB g.

insert into public.clubs (id, name, slug) values
  ('e0000000-0000-4000-8000-000000000001', 'Club Ej A', 'club-ej-a'),
  ('e0000000-0000-4000-8000-000000000002', 'Club Ej B', 'club-ej-b');

insert into public.categories (id, club_id, name) values
  ('e1000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'Cat A');

insert into public.teams (id, category_id, name, format, color, season) values
  ('e2000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', 'Team A', 'F11', '#10B981', '2025-26');

select pg_temp.new_test_user('ea000000-0000-4000-8000-00000000000a', 'admin@ej.test', '{}'::jsonb);
select pg_temp.new_test_user('ea000000-0000-4000-8000-00000000000b', 'coord@ej.test', '{}'::jsonb);
select pg_temp.new_test_user('ea000000-0000-4000-8000-00000000000c', 'principal@ej.test', '{}'::jsonb);
select pg_temp.new_test_user('ea000000-0000-4000-8000-00000000000d', 'ayud-cap@ej.test', '{}'::jsonb);
select pg_temp.new_test_user('ea000000-0000-4000-8000-00000000000e', 'ayud-nocap@ej.test', '{}'::jsonb);
select pg_temp.new_test_user('ea000000-0000-4000-8000-00000000000f', 'jugador@ej.test', '{}'::jsonb);
select pg_temp.new_test_user('eb000000-0000-4000-8000-00000000000a', 'adminB@ej.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('e5000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000001', 'admin_club'),
  ('e5000000-0000-4000-8000-00000000000b', 'ea000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-000000000001', 'coordinador'),
  ('e5000000-0000-4000-8000-00000000000c', 'ea000000-0000-4000-8000-00000000000c', 'e0000000-0000-4000-8000-000000000001', 'entrenador_principal'),
  ('e5000000-0000-4000-8000-00000000000d', 'ea000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('e5000000-0000-4000-8000-00000000000e', 'ea000000-0000-4000-8000-00000000000e', 'e0000000-0000-4000-8000-000000000001', 'entrenador_ayudante'),
  ('e5000000-0000-4000-8000-00000000000f', 'ea000000-0000-4000-8000-00000000000f', 'e0000000-0000-4000-8000-000000000001', 'jugador'),
  ('eb000000-0000-4000-8000-0000000000ba', 'eb000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000002', 'admin_club');

-- Principal en team_staff del Team A (autoridad de creación vía rol de team).
insert into public.team_staff (team_id, membership_id, staff_role) values
  ('e2000000-0000-4000-8000-000000000001', 'e5000000-0000-4000-8000-00000000000c', 'entrenador_principal');

-- ── H1: el trigger sembró can_create_exercises para los ayudantes ────────────
do $$
declare n int;
begin
  select count(*) into n from public.capabilities
   where membership_id = 'e5000000-0000-4000-8000-00000000000d'
     and capability_name = 'can_create_exercises';
  if n <> 1 then raise exception 'FAIL [H1]: el ayudante no tiene fila can_create_exercises'; end if;
end $$;

-- ayudante D: capability concedida; ayudante E: la dejamos en false (sin cap).
update public.capabilities set granted = true
  where membership_id = 'e5000000-0000-4000-8000-00000000000d' and capability_name = 'can_create_exercises';
update public.capabilities set granted = false
  where membership_id = 'e5000000-0000-4000-8000-00000000000e' and capability_name = 'can_create_exercises';

-- ─────────────────────────────────────────────────────────────────────────────
-- INSERT
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- I1: ayudante CON capability crea draft → OK
set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
do $$
begin
  insert into public.exercises (id, owner_profile_id, club_id, name, status)
  values ('e9000000-0000-4000-8000-000000000001', 'ea000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000001', 'Rondo', 'draft');
exception when others then
  raise exception 'FAIL [I1]: ayudante con cap no pudo crear draft: %', sqlerrm;
end $$;

-- I2: ayudante SIN capability crea → RLS lo rechaza
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000e","role":"authenticated"}';
  begin
    insert into public.exercises (owner_profile_id, club_id, name)
    values ('ea000000-0000-4000-8000-00000000000e', 'e0000000-0000-4000-8000-000000000001', 'No deberia');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I2]: ayudante sin cap pudo insertar'; end if;
end $$;

-- I3: principal (vía team_staff) crea proposed → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000c","role":"authenticated"}';
  insert into public.exercises (owner_profile_id, club_id, name, status)
  values ('ea000000-0000-4000-8000-00000000000c', 'e0000000-0000-4000-8000-000000000001', 'Salida B', 'proposed');
exception when others then
  raise exception 'FAIL [I3]: principal no pudo crear: %', sqlerrm;
end $$;

-- I4: coord crea draft → OK
do $$
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  insert into public.exercises (owner_profile_id, club_id, name)
  values ('ea000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-000000000001', 'Coord ej');
exception when others then
  raise exception 'FAIL [I4]: coord no pudo crear: %', sqlerrm;
end $$;

-- I5: jugador crea → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000f","role":"authenticated"}';
  begin
    insert into public.exercises (owner_profile_id, club_id, name)
    values ('ea000000-0000-4000-8000-00000000000f', 'e0000000-0000-4000-8000-000000000001', 'Jugador ej');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I5]: jugador pudo insertar'; end if;
end $$;

-- I6: admin de club B inserta en club A → rechazado
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"eb000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.exercises (owner_profile_id, club_id, name)
    values ('eb000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000001', 'Cross club');
  exception when insufficient_privilege then ok := true;
  end;
  if not ok then raise exception 'FAIL [I6]: admin ajeno pudo insertar en club A'; end if;
end $$;

-- I7: no-Admin (coord) intenta crear directo en published → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  begin
    insert into public.exercises (owner_profile_id, club_id, name, status)
    values ('ea000000-0000-4000-8000-00000000000b', 'e0000000-0000-4000-8000-000000000001', 'Coord pub', 'published');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [I7]: coord pudo crear published'; end if;
end $$;

-- I8: Admin crea directo en published → OK + auditoría sellada
do $$
declare v_by uuid; v_at timestamptz;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  insert into public.exercises (id, owner_profile_id, club_id, name, status)
  values ('e9000000-0000-4000-8000-000000000008', 'ea000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000001', 'Admin pub', 'published');
  select approved_by, approved_at into v_by, v_at from public.exercises where id = 'e9000000-0000-4000-8000-000000000008';
  if v_by <> 'ea000000-0000-4000-8000-00000000000a' or v_at is null then
    raise exception 'FAIL [I8]: published por admin no selló approved_by/at';
  end if;
exception when check_violation then
  raise exception 'FAIL [I8]: admin no pudo crear published';
end $$;

-- I9: crear directo en rejected → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    insert into public.exercises (owner_profile_id, club_id, name, status)
    values ('ea000000-0000-4000-8000-00000000000a', 'e0000000-0000-4000-8000-000000000001', 'Admin rej', 'rejected');
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [I9]: se pudo crear en rejected'; end if;
end $$;

reset role;

-- ── Semilla de filas en todos los estados (sin disparar reglas del trigger) ──
alter table public.exercises disable trigger trg_exercises_validate;
insert into public.exercises (id, owner_profile_id, club_id, name, status, rejection_reason) values
  ('e9000000-0000-4000-8000-0000000000d1', 'ea000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000001', 'Draft seed',    'draft',     null),
  ('e9000000-0000-4000-8000-0000000000e2', 'ea000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000001', 'Proposed seed', 'proposed',  null),
  ('e9000000-0000-4000-8000-0000000000b1', 'ea000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000001', 'Published seed','published', null),
  ('e9000000-0000-4000-8000-0000000000f1', 'ea000000-0000-4000-8000-00000000000d', 'e0000000-0000-4000-8000-000000000001', 'Rejected seed', 'rejected',  'faltan detalles');
alter table public.exercises enable trigger trg_exercises_validate;

-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT por estado / rol
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;

-- S1: draft → solo el autor (ayudante D). coord NO lo ve.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000d1';
  if n <> 1 then raise exception 'FAIL [S1a]: el autor no ve su draft'; end if;
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000d1';
  if n <> 0 then raise exception 'FAIL [S1b]: un no-autor ve el draft ajeno'; end if;
end $$;

-- S2: proposed → autor + Admin; coord (no-autor, no-admin) NO.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000e2';
  if n <> 1 then raise exception 'FAIL [S2a]: autor no ve su proposed'; end if;
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000e2';
  if n <> 1 then raise exception 'FAIL [S2b]: admin no ve el proposed'; end if;
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000e2';
  if n <> 0 then raise exception 'FAIL [S2c]: coord ve un proposed ajeno'; end if;
end $$;

-- S3: published → todo el staff (coord, principal, ayudante); jugador NO; ajeno NO.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000b1';
  if n <> 1 then raise exception 'FAIL [S3a]: coord no ve published'; end if;
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000f","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception 'FAIL [S3b]: jugador ve published'; end if;
  set local "request.jwt.claims" = '{"sub":"eb000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000b1';
  if n <> 0 then raise exception 'FAIL [S3c]: admin ajeno ve published de club A'; end if;
end $$;

-- S4: rejected → autor + Admin; coord NO.
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000f1';
  if n <> 1 then raise exception 'FAIL [S4a]: admin no ve rejected'; end if;
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select count(*) into n from public.exercises where id = 'e9000000-0000-4000-8000-0000000000f1';
  if n <> 0 then raise exception 'FAIL [S4b]: coord ve rejected ajeno'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- UPDATE / transiciones
-- ─────────────────────────────────────────────────────────────────────────────

-- U1: autor edita contenido de su draft → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.exercises set objective = 'mantener posesion' where id = 'e9000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U1]: autor no pudo editar su draft'; end if;
end $$;

-- U2: autor transiciona draft→proposed → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.exercises set status = 'proposed' where id = 'e9000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U2]: autor no pudo enviar a proposed'; end if;
end $$;

-- U3: autor intenta proposed→published → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  begin
    update public.exercises set status = 'published' where id = 'e9000000-0000-4000-8000-0000000000e2';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U3]: autor pudo publicar'; end if;
end $$;

-- U4: Admin publica un proposed → OK + auditoría
do $$
declare v_by uuid;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.exercises set status = 'published' where id = 'e9000000-0000-4000-8000-0000000000e2';
  select approved_by into v_by from public.exercises where id = 'e9000000-0000-4000-8000-0000000000e2';
  if v_by <> 'ea000000-0000-4000-8000-00000000000a' then raise exception 'FAIL [U4]: publicar no selló approved_by'; end if;
end $$;

-- U5: Admin rechaza SIN motivo → trigger lo bloquea
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    update public.exercises set status = 'rejected', rejection_reason = null where id = 'e9000000-0000-4000-8000-0000000000d1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U5]: se pudo rechazar sin motivo'; end if;
end $$;

-- U6: Admin rechaza CON motivo → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.exercises set status = 'rejected', rejection_reason = 'mejorar reglas' where id = 'e9000000-0000-4000-8000-0000000000d1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [U6]: admin no pudo rechazar con motivo'; end if;
end $$;

-- U7: no-autor no-admin (coord) edita un draft ajeno → 0 filas (RLS)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000b","role":"authenticated"}';
  update public.exercises set name = 'hack' where id = 'e9000000-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U7]: coord editó fila ajena'; end if;
end $$;

-- U8: el autor NO puede editar un published suyo → 0 filas (RLS)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  update public.exercises set objective = 'x' where id = 'e9000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [U8]: el autor editó un published'; end if;
end $$;

-- U9: Admin archiva un published → OK
do $$
declare v timestamptz;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  update public.exercises set archived_at = now() where id = 'e9000000-0000-4000-8000-0000000000b1';
  select archived_at into v from public.exercises where id = 'e9000000-0000-4000-8000-0000000000b1';
  if v is null then raise exception 'FAIL [U9]: admin no pudo archivar published'; end if;
end $$;

-- U10: archivar un NO-published → trigger lo bloquea (admin sobre proposed)
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  begin
    update public.exercises set archived_at = now() where id = 'e9000000-0000-4000-8000-0000000000f1';
  exception when check_violation then ok := true;
  end;
  if not ok then raise exception 'FAIL [U10]: se archivó un no-published'; end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE
-- ─────────────────────────────────────────────────────────────────────────────

-- D1: autor borra su proposed (no publicado) → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000d","role":"authenticated"}';
  delete from public.exercises where id = 'e9000000-0000-4000-8000-000000000001'; -- el draft de I1
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D1]: autor no pudo borrar su no-publicado'; end if;
end $$;

-- D2: Admin borra un rejected (no publicado) → OK
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  delete from public.exercises where id = 'e9000000-0000-4000-8000-0000000000f1';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D2]: admin no pudo borrar un rejected'; end if;
end $$;

-- D3: nadie borra un published → 0 filas (se archiva, no se borra)
do $$
declare n int;
begin
  set local "request.jwt.claims" = '{"sub":"ea000000-0000-4000-8000-00000000000a","role":"authenticated"}';
  delete from public.exercises where id = 'e9000000-0000-4000-8000-0000000000b1';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [D3]: se borró (hard) un published'; end if;
end $$;

reset role;

rollback;
