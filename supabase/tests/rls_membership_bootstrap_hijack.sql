-- F15-C2-fix — memberships_insert_bootstrap_or_admin SIN la rama bootstrap.
--
-- Contexto: la rama bootstrap permitía a un authenticated con CERO membresías
-- insertarse como admin_club de cualquier club SIN admin (la ventana entre
-- platform_create_club y que el admin invitado acepte) → secuestro de club.
-- Migración 20261027 la elimina. Aquí se fija, a nivel RLS:
--   T1  ataque: 0-membresías, SIN invitación → INSERT admin_club RECHAZADO (era el agujero).
--   T2  rama-invitación intacta: 0-membresías CON invitación pendiente que casa → PERMITIDO.
--   T3  rama-invitación: rol distinto al invitado → RECHAZADO (no se escala el rol).
--   T4  rama-invitación: invitación caducada → RECHAZADO.
--   T5  rama-admin/owner intacta: el owner del club da de alta un rol → PERMITIDO;
--       un no-miembro NO puede → RECHAZADO.
--
-- Nota: el alta REAL de producción (accept_pending_invitations) es SECURITY DEFINER
-- y BYPASSA esta policy, así que es inmune a este cambio; se demostró end-to-end en
-- prod (admin + director) en la entrega del PR. Aquí se prueba la capa RLS, que es
-- lo único que la migración toca.
\ir helpers/auth_users.sql

begin;

-- Club SIN admin y SIN owner: exactamente el estado post-platform_create_club
-- (la ventana explotable). Insertado como postgres → bypass RLS.
insert into public.clubs (id, name, slug, owner_profile_id)
  values ('cb000000-0000-4000-8000-000000000001', 'Club Ventana', 'club-ventana-hijack', null);
insert into public.seasons (id, club_id, label, status)
  values ('cb000000-5ea5-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', '2025-26', 'active');

-- Atacante e invitados: todos con CERO membresías.
select pg_temp.new_test_user('cb000000-a77a-4000-8000-000000000001', 'atacante@hijack.test', '{}'::jsonb);
select pg_temp.new_test_user('cb000000-1a71-4000-8000-000000000001', 'invadmin@hijack.test', '{}'::jsonb);
select pg_temp.new_test_user('cb000000-d132-4000-8000-000000000001', 'invdir@hijack.test', '{}'::jsonb);
select pg_temp.new_test_user('cb000000-0075-4000-8000-000000000001', 'forastero@hijack.test', '{}'::jsonb);

-- Invitaciones PENDIENTES que casan por email/club/rol (para la rama 2).
insert into public.invitations (token, club_id, email, role, created_by, expires_at) values
  ('cb000000-c1c1-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'invadmin@hijack.test', 'admin_club', 'cb000000-1a71-4000-8000-000000000001', now() + interval '7 days'),
  ('cb000000-c1c1-4000-8000-000000000002', 'cb000000-0000-4000-8000-000000000001', 'invdir@hijack.test',   'director',   'cb000000-1a71-4000-8000-000000000001', now() + interval '7 days'),
  -- invitación CADUCADA para el atacante (no debe habilitar nada).
  ('cb000000-c1c1-4000-8000-000000000003', 'cb000000-0000-4000-8000-000000000001', 'atacante@hijack.test', 'admin_club', 'cb000000-1a71-4000-8000-000000000001', now() - interval '1 day');

set local role authenticated;

-- ── T1: ATAQUE — 0-membresías, SIN invitación válida → admin_club RECHAZADO ──────
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"cb000000-a77a-4000-8000-000000000001","role":"authenticated"}';
  begin
    insert into public.memberships (profile_id, club_id, role)
      values ('cb000000-a77a-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin_club');
  exception when others then ok := true;
  end;
  if not ok then
    raise exception 'FAIL [T1]: SECUESTRO — un usuario sin invitación se insertó como admin_club (rama bootstrap viva)';
  end if;
end $$;

-- ── T2: rama-invitación intacta — invitado admin CON invitación que casa → OK ────
do $$
declare v_cnt int;
begin
  set local "request.jwt.claims" = '{"sub":"cb000000-1a71-4000-8000-000000000001","role":"authenticated"}';
  insert into public.memberships (profile_id, club_id, role)
    values ('cb000000-1a71-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin_club');
  select count(*) into v_cnt from public.memberships
    where profile_id = 'cb000000-1a71-4000-8000-000000000001' and role = 'admin_club';
  if v_cnt <> 1 then raise exception 'FAIL [T2]: el invitado admin NO pudo darse de alta (rama invitación rota)'; end if;
end $$;

-- ── T3: rama-invitación — pedir un rol DISTINTO al invitado → RECHAZADO ──────────
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"cb000000-d132-4000-8000-000000000001","role":"authenticated"}';
  begin
    -- invitado como 'director', intenta colarse como 'admin_club'
    insert into public.memberships (profile_id, club_id, role)
      values ('cb000000-d132-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin_club');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL [T3]: se escaló el rol por encima de la invitación'; end if;
end $$;

-- ── T4: rama-invitación — invitación CADUCADA → RECHAZADO ────────────────────────
do $$
declare ok boolean := false;
begin
  set local "request.jwt.claims" = '{"sub":"cb000000-a77a-4000-8000-000000000001","role":"authenticated"}';
  begin
    insert into public.memberships (profile_id, club_id, role)
      values ('cb000000-a77a-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'admin_club');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL [T4]: una invitación caducada permitió el alta'; end if;
end $$;

-- ── T5: rama-admin/owner intacta ────────────────────────────────────────────────
-- Tras T2 el club ya tiene owner (trigger f14b_5b: el invitado admin es el owner).
-- Un rol BAJO dado por el owner → OK; un no-miembro dando un rol → RECHAZADO.
do $$
declare v_cnt int; ok boolean := false;
begin
  -- (a) owner (invadmin) da de alta a 'invdir' como 'entrenador_ayudante' (rol bajo) → OK
  set local "request.jwt.claims" = '{"sub":"cb000000-1a71-4000-8000-000000000001","role":"authenticated"}';
  insert into public.memberships (profile_id, club_id, role)
    values ('cb000000-d132-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'entrenador_ayudante');
  select count(*) into v_cnt from public.memberships
    where profile_id = 'cb000000-d132-4000-8000-000000000001' and role = 'entrenador_ayudante';
  if v_cnt <> 1 then raise exception 'FAIL [T5a]: el owner no pudo dar de alta un rol bajo'; end if;

  -- (b) un forastero (no-miembro, sin invitación) intenta dar de alta a alguien → RECHAZADO
  set local "request.jwt.claims" = '{"sub":"cb000000-0075-4000-8000-000000000001","role":"authenticated"}';
  begin
    insert into public.memberships (profile_id, club_id, role)
      values ('cb000000-0075-4000-8000-000000000001', 'cb000000-0000-4000-8000-000000000001', 'entrenador_ayudante');
  exception when others then ok := true;
  end;
  if not ok then raise exception 'FAIL [T5b]: un no-miembro pudo insertar una membership'; end if;
end $$;

reset role;
rollback;

\echo '──────────────────────────────────────────────'
\echo '✅ F15-C2-fix: rama bootstrap eliminada — secuestro bloqueado; invitación y admin/owner intactos.'
\echo '──────────────────────────────────────────────'
