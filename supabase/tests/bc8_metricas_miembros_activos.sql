-- BC-8 — la consola de plataforma ve los clubes SIN administrador
-- (migracion 20261062000000). Cubre:
--   [1] un club cuyo unico admin_club esta DE BAJA aparece con admin_club = 0.
--   [2] `members_total` cuenta solo miembros ACTIVOS.
--   [3] el caso normal no se rompe: con el admin activo vuelve a contar 1.
--   [4] CANDADO: las metricas siguen siendo solo para superadmin.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja rastro.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug)
values ('bc800000-0000-4000-8000-000000000001', 'Club BC8', 'club-bc8');

select pg_temp.new_test_user('bc8a0000-0000-4000-8000-00000000000a', 'adminbaja@bc8.test', '{}'::jsonb);
select pg_temp.new_test_user('bc8a0000-0000-4000-8000-00000000000b', 'super@bc8.test',     '{}'::jsonb);
select pg_temp.new_test_user('bc8a0000-0000-4000-8000-00000000000c', 'jugador@bc8.test',   '{}'::jsonb);

insert into public.platform_admins (profile_id) values ('bc8a0000-0000-4000-8000-00000000000b');

-- El unico admin del club se fue ayer. Un jugador sigue activo.
insert into public.memberships (profile_id, club_id, role, left_at) values
  ('bc8a0000-0000-4000-8000-00000000000a','bc800000-0000-4000-8000-000000000001','admin_club', current_date - 1),
  ('bc8a0000-0000-4000-8000-00000000000c','bc800000-0000-4000-8000-000000000001','jugador',    null);


-- ── [1]-[2] ──────────────────────────────────────────────────────────────────
do $$
declare v_admins int; v_total int;
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc8a0000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select m.admin_club, m.members_total into v_admins, v_total
    from public.platform_club_metrics() m
   where m.club_id = 'bc800000-0000-4000-8000-000000000001';
  reset role;

  -- Esto es lo que sostiene el aviso que BC-7 manda a plataforma: el aviso avisa una
  -- vez, la consola lo sostiene.
  if v_admins <> 0 then
    raise exception 'FAIL [1]: la consola ve % admins en un club que no tiene ninguno', v_admins;
  end if;
  if v_total <> 1 then
    raise exception 'FAIL [2]: members_total = % (esperaba 1: solo el jugador activo)', v_total;
  end if;
end $$;


-- ── [3] · el caso normal sigue intacto ───────────────────────────────────────
do $$
declare v_admins int;
begin
  update public.memberships set left_at = null
   where club_id = 'bc800000-0000-4000-8000-000000000001' and role = 'admin_club';

  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"bc8a0000-0000-4000-8000-00000000000b","role":"authenticated"}';
  select m.admin_club into v_admins
    from public.platform_club_metrics() m
   where m.club_id = 'bc800000-0000-4000-8000-000000000001';
  reset role;

  if v_admins <> 1 then raise exception 'FAIL [3]: admin_club = % (esperaba 1)', v_admins; end if;
end $$;


-- ── [4] · candado de acceso ──────────────────────────────────────────────────
do $$
declare v_msg text;
begin
  begin
    set local role authenticated;
    set local "request.jwt.claims" = '{"sub":"bc8a0000-0000-4000-8000-00000000000c","role":"authenticated"}';
    perform * from public.platform_club_metrics();
    reset role;
    raise exception 'FAIL [4]: un no-superadmin pudo leer las metricas de plataforma';
  exception when others then
    get stacked diagnostics v_msg = message_text;
    reset role;
    if v_msg <> 'forbidden' then
      raise exception 'FAIL [4]: esperaba forbidden, obtuve %', v_msg;
    end if;
  end;
end $$;


\echo ''
\echo '───────────────────────────────────────────────'
\echo '✅ Tests BC-8 (consola: clubes sin administrador): 4 bloques pasaron.'
\echo '───────────────────────────────────────────────'

rollback;
