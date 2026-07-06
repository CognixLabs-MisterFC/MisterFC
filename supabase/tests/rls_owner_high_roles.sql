-- F1B-2 — Tests RLS: la gestión de roles ALTOS (director/admin_club) es del owner.
--
--   OWNER puede: invitar director/admin, promover a director, degradar/eliminar
--     a un director.
--   DIRECTOR no puede: invitar director/admin, promover a nadie a director/admin,
--     editar/eliminar a un director o admin. PERO sí invita/gestiona roles bajos.
--   ADMIN_CLUB NO-owner no puede gestionar directores/admins.
--   OWNER inmutable: no se puede degradar ni eliminar.
--   Aislamiento: owner de A no gestiona nada de B.
--
-- Estilo house: begin … set local jwt.claims … do $$ raise on fail $$ … rollback.

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Setup — auth.users PRIMERO (owner_profile_id de clubs referencia profiles).
-- ─────────────────────────────────────────────────────────────────────────────
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('f1b20000-0001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-a@f1b2.test',  now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0002-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2-a@f1b2.test', now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0003-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dir-a@f1b2.test',    now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0004-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord-a@f1b2.test',  now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0005-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jug-a@f1b2.test',    now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0006-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pawn-a@f1b2.test',   now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0007-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner-b@f1b2.test',  now(), '{}'::jsonb, now(), now()),
  ('f1b20000-0008-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dir-b@f1b2.test',    now(), '{}'::jsonb, now(), now());

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('f1b20000-aaaa-0000-0000-000000000001', 'Club A F1B2', 'club-a-f1b2', 'f1b20000-0001-0000-0000-000000000001'),
  ('f1b20000-bbbb-0000-0000-000000000001', 'Club B F1B2', 'club-b-f1b2', 'f1b20000-0007-0000-0000-000000000001');

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1b20000-5001-0000-0000-000000000001', 'f1b20000-0001-0000-0000-000000000001', 'f1b20000-aaaa-0000-0000-000000000001', 'admin_club'),   -- ownerA
  ('f1b20000-5002-0000-0000-000000000001', 'f1b20000-0002-0000-0000-000000000001', 'f1b20000-aaaa-0000-0000-000000000001', 'admin_club'),   -- admin2A (no-owner)
  ('f1b20000-5003-0000-0000-000000000001', 'f1b20000-0003-0000-0000-000000000001', 'f1b20000-aaaa-0000-0000-000000000001', 'director'),     -- dirA
  ('f1b20000-5004-0000-0000-000000000001', 'f1b20000-0004-0000-0000-000000000001', 'f1b20000-aaaa-0000-0000-000000000001', 'coordinador'),  -- coordA
  ('f1b20000-5005-0000-0000-000000000001', 'f1b20000-0005-0000-0000-000000000001', 'f1b20000-aaaa-0000-0000-000000000001', 'jugador'),      -- jugA
  ('f1b20000-5006-0000-0000-000000000001', 'f1b20000-0006-0000-0000-000000000001', 'f1b20000-aaaa-0000-0000-000000000001', 'jugador'),      -- pawnA
  ('f1b20000-5007-0000-0000-000000000001', 'f1b20000-0007-0000-0000-000000000001', 'f1b20000-bbbb-0000-0000-000000000001', 'admin_club'),   -- ownerB
  ('f1b20000-5008-0000-0000-000000000001', 'f1b20000-0008-0000-0000-000000000001', 'f1b20000-bbbb-0000-0000-000000000001', 'director');     -- dirB

set local role authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- D. DIRECTOR — gestiona roles BAJOS; NO toca director/admin.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b20000-0003-0000-0000-000000000001","role":"authenticated"}';

-- D1 — director invita rol BAJO (coordinador) → OK.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-aaaa-0000-0000-000000000001', 'nuevo-coord@f1b2.test', 'coordinador', 'f1b20000-0003-0000-0000-000000000001');
exception when others then
  raise exception 'FAIL [D1]: director no pudo invitar coordinador: % (%).', sqlerrm, sqlstate;
end $$;

-- D2 — director invita DIRECTOR → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-aaaa-0000-0000-000000000001', 'x-dir@f1b2.test', 'director', 'f1b20000-0003-0000-0000-000000000001');
  raise exception 'FAIL [D2]: director pudo invitar a un director';
exception when insufficient_privilege or check_violation then null; end $$;

-- D3 — director invita ADMIN_CLUB → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-aaaa-0000-0000-000000000001', 'x-adm@f1b2.test', 'admin_club', 'f1b20000-0003-0000-0000-000000000001');
  raise exception 'FAIL [D3]: director pudo invitar a un admin';
exception when insufficient_privilege or check_violation then null; end $$;

-- D4 — director cambia rol BAJO (jugA jugador→coordinador) vía RPC → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0005-0000-0000-000000000001', 'coordinador');
  select role into r from public.memberships where profile_id='f1b20000-0005-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  if r <> 'coordinador' then raise exception 'FAIL [D4]: rol bajo no cambió (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [D4]: director no pudo cambiar rol bajo: % (%).', sqlerrm, sqlstate;
end $$;

-- D5 — director promueve pawnA a DIRECTOR → forbidden_requires_owner.
do $$
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0006-0000-0000-000000000001', 'director');
  raise exception 'FAIL [D5]: director pudo promover a director';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then
    raise exception 'FAIL [D5]: error inesperado: % (%).', sqlerrm, sqlstate;
  end if;
end $$;

-- D6 — director degrada a admin2A (admin_club→coordinador) → forbidden_requires_owner.
do $$
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0002-0000-0000-000000000001', 'coordinador');
  raise exception 'FAIL [D6]: director pudo degradar a un admin';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then
    raise exception 'FAIL [D6]: error inesperado: % (%).', sqlerrm, sqlstate;
  end if;
end $$;

-- D7 — director ELIMINA una membership de admin (alto) → RLS bloquea (0 filas).
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b20000-0002-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [D7]: director eliminó una membership de admin (% filas)', n; end if;
end $$;

-- D8 — director ELIMINA una membership BAJA (coordA) → OK (1 fila).
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b20000-0004-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [D8]: director no eliminó una membership baja (% filas)', n; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- N. ADMIN_CLUB NO-OWNER — tampoco gestiona directores/admins.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b20000-0002-0000-0000-000000000001","role":"authenticated"}';

-- N1 — admin no-owner invita DIRECTOR → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-aaaa-0000-0000-000000000001', 'n1@f1b2.test', 'director', 'f1b20000-0002-0000-0000-000000000001');
  raise exception 'FAIL [N1]: admin no-owner pudo invitar a un director';
exception when insufficient_privilege or check_violation then null; end $$;

-- N2 — admin no-owner promueve pawnA a director → forbidden_requires_owner.
do $$
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0006-0000-0000-000000000001', 'director');
  raise exception 'FAIL [N2]: admin no-owner pudo promover a director';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then raise exception 'FAIL [N2]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- N3 — admin no-owner degrada al director dirA → forbidden_requires_owner.
do $$
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0003-0000-0000-000000000001', 'jugador');
  raise exception 'FAIL [N3]: admin no-owner pudo degradar a un director';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then raise exception 'FAIL [N3]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- O. OWNER — sí gestiona roles altos.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b20000-0001-0000-0000-000000000001","role":"authenticated"}';

-- O1 — owner invita DIRECTOR → OK.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-aaaa-0000-0000-000000000001', 'o1-dir@f1b2.test', 'director', 'f1b20000-0001-0000-0000-000000000001');
exception when others then raise exception 'FAIL [O1]: owner no pudo invitar director: % (%).', sqlerrm, sqlstate; end $$;

-- O2 — owner invita ADMIN_CLUB → OK.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-aaaa-0000-0000-000000000001', 'o2-adm@f1b2.test', 'admin_club', 'f1b20000-0001-0000-0000-000000000001');
exception when others then raise exception 'FAIL [O2]: owner no pudo invitar admin: % (%).', sqlerrm, sqlstate; end $$;

-- O3 — owner promueve pawnA a DIRECTOR → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0006-0000-0000-000000000001', 'director');
  select role into r from public.memberships where profile_id='f1b20000-0006-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  if r <> 'director' then raise exception 'FAIL [O3]: owner no promovió a director (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [O3]: owner no pudo promover a director: % (%).', sqlerrm, sqlstate;
end $$;

-- O4 — owner degrada al recién-director pawnA → jugador (cambiar DESDE alto) → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0006-0000-0000-000000000001', 'jugador');
  select role into r from public.memberships where profile_id='f1b20000-0006-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  if r <> 'jugador' then raise exception 'FAIL [O4]: owner no degradó al director (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [O4]: owner no pudo degradar a un director: % (%).', sqlerrm, sqlstate;
end $$;

-- O5 — owner ELIMINA la membership del director dirA → OK (1 fila).
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b20000-0003-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL [O5]: owner no eliminó al director (% filas)', n; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- P. PROTECCIÓN DEL OWNER — inmutable (ni degradable ni eliminable).
-- ═════════════════════════════════════════════════════════════════════════════

-- P1 — el owner no puede degradarse a sí mismo vía RPC → owner_immutable.
set local "request.jwt.claims" = '{"sub":"f1b20000-0001-0000-0000-000000000001","role":"authenticated"}';
do $$
begin
  perform public.admin_update_staff_role('f1b20000-aaaa-0000-0000-000000000001', 'f1b20000-0001-0000-0000-000000000001', 'coordinador');
  raise exception 'FAIL [P1]: el owner pudo degradarse a sí mismo';
exception when others then
  if sqlerrm not like '%owner_immutable%' then raise exception 'FAIL [P1]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- P2 — un admin no-owner NO puede eliminar la membership del owner → 0 filas.
set local "request.jwt.claims" = '{"sub":"f1b20000-0002-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  delete from public.memberships where profile_id='f1b20000-0001-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [P2]: se eliminó la membership del owner (% filas)', n; end if;
end $$;

-- P3 — ni el propio owner puede editar (degradar) su membership vía RLS → 0 filas.
set local "request.jwt.claims" = '{"sub":"f1b20000-0001-0000-0000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  update public.memberships set role='coordinador'
   where profile_id='f1b20000-0001-0000-0000-000000000001' and club_id='f1b20000-aaaa-0000-0000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL [P3]: el owner editó su propia membership (% filas)', n; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- I. AISLAMIENTO — owner de A no gestiona roles de B.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b20000-0001-0000-0000-000000000001","role":"authenticated"}';

-- I1 — owner de A invita un director en el club B → RLS rechaza.
do $$
begin
  insert into public.invitations (club_id, email, role, created_by)
  values ('f1b20000-bbbb-0000-0000-000000000001', 'i1@f1b2.test', 'director', 'f1b20000-0001-0000-0000-000000000001');
  raise exception 'FAIL [I1]: owner de A invitó un director en B';
exception when insufficient_privilege or check_violation then null; end $$;

-- I2 — owner de A cambia el rol de dirB (club B) vía RPC → forbidden (no es miembro de B).
do $$
begin
  perform public.admin_update_staff_role('f1b20000-bbbb-0000-0000-000000000001', 'f1b20000-0008-0000-0000-000000000001', 'jugador');
  raise exception 'FAIL [I2]: owner de A gestionó un rol de B';
exception when others then
  if sqlerrm not like '%forbidden%' then raise exception 'FAIL [I2]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ F1B-2: solo el owner gestiona directores/admins; owner inmutable; aislado.'
\echo '──────────────────────────────────────────────'
