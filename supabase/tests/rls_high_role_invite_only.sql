-- F1B-2b — Tests: los roles ALTOS (director/admin_club) NO se alcanzan por
-- cambio de rol (admin_update_staff_role), para NADIE ni el owner. Solo por
-- invitación. Degradar a un director sigue siendo potestad del owner.
--
-- Estilo house: begin … set local jwt.claims … do $$ raise on fail $$ … rollback.

begin;

-- ── Setup: club A con owner + admin no-owner + director + coordinador + peón ──
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('f1b2b000-0001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner@f1b2b.test',  now(), '{}'::jsonb, now(), now()),
  ('f1b2b000-0002-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin2@f1b2b.test', now(), '{}'::jsonb, now(), now()),
  ('f1b2b000-0003-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dir@f1b2b.test',    now(), '{}'::jsonb, now(), now()),
  ('f1b2b000-0004-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'coord@f1b2b.test',  now(), '{}'::jsonb, now(), now()),
  ('f1b2b000-0005-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pawn@f1b2b.test',   now(), '{}'::jsonb, now(), now());

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('f1b2b000-aaaa-0000-0000-000000000001', 'Club F1B2b', 'club-f1b2b', 'f1b2b000-0001-0000-0000-000000000001');

insert into public.memberships (id, profile_id, club_id, role) values
  ('f1b2b000-5001-0000-0000-000000000001', 'f1b2b000-0001-0000-0000-000000000001', 'f1b2b000-aaaa-0000-0000-000000000001', 'admin_club'),   -- owner
  ('f1b2b000-5002-0000-0000-000000000001', 'f1b2b000-0002-0000-0000-000000000001', 'f1b2b000-aaaa-0000-0000-000000000001', 'admin_club'),   -- admin2 (no-owner)
  ('f1b2b000-5003-0000-0000-000000000001', 'f1b2b000-0003-0000-0000-000000000001', 'f1b2b000-aaaa-0000-0000-000000000001', 'director'),     -- dir
  ('f1b2b000-5004-0000-0000-000000000001', 'f1b2b000-0004-0000-0000-000000000001', 'f1b2b000-aaaa-0000-0000-000000000001', 'coordinador'),  -- coord
  ('f1b2b000-5005-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'f1b2b000-aaaa-0000-0000-000000000001', 'jugador');      -- pawn

set local role authenticated;

-- ═════════════════════════════════════════════════════════════════════════════
-- D. DIRECTOR caller — mueve roles bajos; NUNCA sube a alto.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b2b000-0003-0000-0000-000000000001","role":"authenticated"}';

-- D1 — dir cambia peón jugador→coordinador → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'coordinador');
  select role into r from public.memberships where profile_id='f1b2b000-0005-0000-0000-000000000001' and club_id='f1b2b000-aaaa-0000-0000-000000000001';
  if r <> 'coordinador' then raise exception 'FAIL [D1]: rol bajo no cambió (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [D1]: director no pudo mover rol bajo: % (%).', sqlerrm, sqlstate;
end $$;

-- D2 — dir cambia peón coordinador→entrenador_ayudante → OK (bajo↔bajo).
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'entrenador_ayudante');
  select role into r from public.memberships where profile_id='f1b2b000-0005-0000-0000-000000000001' and club_id='f1b2b000-aaaa-0000-0000-000000000001';
  if r <> 'entrenador_ayudante' then raise exception 'FAIL [D2]: bajo↔bajo no cambió (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [D2]: director no pudo mover bajo↔bajo: % (%).', sqlerrm, sqlstate;
end $$;

-- D3 — dir intenta subir peón A DIRECTOR → high_role_invite_only.
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'director');
  raise exception 'FAIL [D3]: director pudo subir a director por cambio de rol';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [D3]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- D4 — dir intenta subir peón A ADMIN_CLUB → high_role_invite_only.
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'admin_club');
  raise exception 'FAIL [D4]: director pudo subir a admin por cambio de rol';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [D4]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- A. ADMIN no-owner caller — mueve bajos; no sube a alto; no degrada a un director.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b2b000-0002-0000-0000-000000000001","role":"authenticated"}';

-- A1 — admin no-owner cambia coord coordinador→entrenador_principal → OK.
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0004-0000-0000-000000000001', 'entrenador_principal');
  select role into r from public.memberships where profile_id='f1b2b000-0004-0000-0000-000000000001' and club_id='f1b2b000-aaaa-0000-0000-000000000001';
  if r <> 'entrenador_principal' then raise exception 'FAIL [A1]: bajo↔bajo no cambió (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [A1]: admin no pudo mover rol bajo: % (%).', sqlerrm, sqlstate;
end $$;

-- A2 — admin no-owner intenta subir coord A DIRECTOR → high_role_invite_only.
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0004-0000-0000-000000000001', 'director');
  raise exception 'FAIL [A2]: admin pudo subir a director';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [A2]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- A3 — admin no-owner intenta degradar al DIRECTOR → forbidden_requires_owner
--      (degradar un alto sigue siendo potestad del owner; regla F1B-2 intacta).
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0003-0000-0000-000000000001', 'entrenador_principal');
  raise exception 'FAIL [A3]: admin no-owner degradó a un director';
exception when others then
  if sqlerrm not like '%forbidden_requires_owner%' then raise exception 'FAIL [A3]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- O. OWNER caller — TAMPOCO sube a alto; pero SÍ degrada a un director.
-- ═════════════════════════════════════════════════════════════════════════════
set local "request.jwt.claims" = '{"sub":"f1b2b000-0001-0000-0000-000000000001","role":"authenticated"}';

-- O1 — owner intenta subir peón A DIRECTOR → high_role_invite_only (¡ni el owner!).
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'director');
  raise exception 'FAIL [O1]: el owner pudo subir a director por cambio de rol';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [O1]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- O2 — owner intenta subir peón A ADMIN_CLUB → high_role_invite_only (¡ni el owner!).
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0005-0000-0000-000000000001', 'admin_club');
  raise exception 'FAIL [O2]: el owner pudo subir a admin por cambio de rol';
exception when others then
  if sqlerrm not like '%high_role_invite_only%' then raise exception 'FAIL [O2]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

-- O3 — owner DEGRADA al director → entrenador_principal → OK (potestad del owner).
do $$
declare r text;
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0003-0000-0000-000000000001', 'entrenador_principal');
  select role into r from public.memberships where profile_id='f1b2b000-0003-0000-0000-000000000001' and club_id='f1b2b000-aaaa-0000-0000-000000000001';
  if r <> 'entrenador_principal' then raise exception 'FAIL [O3]: owner no degradó al director (%).', r; end if;
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise exception 'FAIL [O3]: owner no pudo degradar a un director: % (%).', sqlerrm, sqlstate;
end $$;

-- O4 — owner sigue inmutable: no puede degradarse a sí mismo → owner_immutable.
do $$
begin
  perform public.admin_update_staff_role('f1b2b000-aaaa-0000-0000-000000000001', 'f1b2b000-0001-0000-0000-000000000001', 'coordinador');
  raise exception 'FAIL [O4]: el owner pudo degradarse a sí mismo';
exception when others then
  if sqlerrm not like '%owner_immutable%' then raise exception 'FAIL [O4]: inesperado: % (%).', sqlerrm, sqlstate; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ F1B-2b: nadie sube a director/admin por cambio de rol; degradar director = owner.'
\echo '──────────────────────────────────────────────'
