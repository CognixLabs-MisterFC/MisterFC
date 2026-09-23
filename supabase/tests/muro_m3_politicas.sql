-- MURO M-3 — el candado en las politicas (migracion 20261106000000).
--
-- LA FORMA DE EQUIVOCARSE AQUI no es dejar pasar a quien no paga: es RECORTARLE algo a
-- quien si paga. Por eso la asercion central es [2], y esta montada de la unica manera
-- que vale: se miden los recuentos de la MISMA familia dos veces —con el muro apagado y
-- con el muro encendido teniendo suscripcion viva— y tienen que salir IDENTICOS, tabla
-- por tabla. No "parecidos": identicos.
--
-- Cubre:
--   [1]  ESTRUCTURAL: las 18 tablas llevan la policy, y la lista de tablas con candado
--        es EXACTAMENTE la esperada. Si manana alguien anade una tabla de producto sin
--        candado, o le pone candado a una que debia quedar abierta, esto se pone rojo.
--   [2]  QUIEN PAGA NO PIERDE NADA. Recuentos identicos con el muro apagado y encendido.
--   [3]  Quien NO paga deja de ver el producto: cero en las 18.
--   [4]  Y sigue viendo lo que NO es producto: su perfil, su club, sus hijos, sus
--        consentimientos, los legales y SUS AVISOS.
--   [5]  EL STAFF NO SE ENTERA: el entrenador ve lo mismo con el muro encendido.
--   [6]  EL ESCAPE DE `players`: sin pagar ves a TUS hijos y dejas de ver a los demas.
--   [7]  LA VISTA YA NO ES PUERTA DE ATRAS: `players_sporting` corria sin
--        `security_invoker` y se saltaba la RLS de `players`.
--   [8]  APAGADO = EL MUNDO DE HOY: con el interruptor en false, quien no tiene
--        suscripcion ninguna ve exactamente lo mismo que antes de esta migracion.
--   [9]  Los consentimientos y el borrado de cuenta siguen funcionando sin pagar.
--   [10] El interruptor SIGUE APAGADO al final de la migracion.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final), no deja
-- rastro. Las aserciones LEEN con el rol de la sesion: las comprobaciones van como
-- postgres.
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture con contenido de verdad en las tablas de producto ───────────────
insert into public.clubs (id, name, slug) values
  ('cc700000-0000-4000-8000-000000000001', 'Club Muro3', 'club-muro3');
insert into public.seasons (id, club_id, label, status) values
  ('cc7c0000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001', '2026-27', 'active');
insert into public.categories (id, club_id, name) values
  ('cc7d0000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001', 'Cat Muro3');
insert into public.teams (id, category_id, name, format, color, season, club_id) values
  ('cc7e0000-0000-4000-8000-000000000001', 'cc7d0000-0000-4000-8000-000000000001', 'Equipo Muro3', 'F7', '#10B981', '2026-27', 'cc700000-0000-4000-8000-000000000001');

-- p1 = familia CON suscripcion viva · p0 = familia SIN nada · en = entrenador
select pg_temp.new_test_user('cc7a0000-0000-4000-8000-000000000001', 'p1@muro3.test', '{}'::jsonb);
select pg_temp.new_test_user('cc7a0000-0000-4000-8000-000000000000', 'p0@muro3.test', '{}'::jsonb);
select pg_temp.new_test_user('cc7a0000-0000-4000-8000-00000000000e', 'en@muro3.test', '{}'::jsonb);

insert into public.memberships (id, profile_id, club_id, role) values
  ('cc7f0000-0000-4000-8000-000000000001', 'cc7a0000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001', 'jugador'),
  ('cc7f0000-0000-4000-8000-000000000000', 'cc7a0000-0000-4000-8000-000000000000', 'cc700000-0000-4000-8000-000000000001', 'jugador'),
  ('cc7f0000-0000-4000-8000-00000000000e', 'cc7a0000-0000-4000-8000-00000000000e', 'cc700000-0000-4000-8000-000000000001', 'entrenador_principal');

insert into public.team_staff (team_id, membership_id, staff_role) values
  ('cc7e0000-0000-4000-8000-000000000001', 'cc7f0000-0000-4000-8000-00000000000e', 'entrenador_principal');

-- j1 = hijo de p1 · j0 = hijo de p0 · j2 = de nadie (mide el escape de players)
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('cc7b0000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001', 'Uno',  'Muro3', '2013-04-01'),
  ('cc7b0000-0000-4000-8000-000000000000', 'cc700000-0000-4000-8000-000000000001', 'Cero', 'Muro3', '2013-04-01'),
  ('cc7b0000-0000-4000-8000-000000000002', 'cc700000-0000-4000-8000-000000000001', 'Dos',  'Muro3', '2013-04-01');

insert into public.player_accounts (player_id, profile_id, relation) values
  ('cc7b0000-0000-4000-8000-000000000001', 'cc7a0000-0000-4000-8000-000000000001', 'parent'),
  ('cc7b0000-0000-4000-8000-000000000000', 'cc7a0000-0000-4000-8000-000000000000', 'parent');

insert into public.team_members (player_id, team_id, joined_at) values
  ('cc7b0000-0000-4000-8000-000000000001', 'cc7e0000-0000-4000-8000-000000000001', '2026-08-01'),
  ('cc7b0000-0000-4000-8000-000000000000', 'cc7e0000-0000-4000-8000-000000000001', '2026-08-01');

insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('cc740000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001', 'cc7e0000-0000-4000-8000-000000000001', 'match', 'Partido Muro3', '2026-09-20T10:00:00Z', 'cc7a0000-0000-4000-8000-00000000000e');

set local "request.jwt.claim.sub" to 'cc7a0000-0000-4000-8000-00000000000e';
insert into public.match_callup_meta (event_id, meeting_at, meeting_location, published_at)
  values ('cc740000-0000-4000-8000-000000000001', '2026-09-20T08:00:00Z', 'Sede', now());
reset "request.jwt.claim.sub";

insert into public.callup_decisions (event_id, player_id, decision, decided_by) values
  ('cc740000-0000-4000-8000-000000000001', 'cc7b0000-0000-4000-8000-000000000001',
   'called_up', 'cc7a0000-0000-4000-8000-00000000000e');

insert into public.match_state (event_id, club_id, status) values
  ('cc740000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001', 'live');
insert into public.match_periods (event_id, period, ordinal, running, last_started_at) values
  ('cc740000-0000-4000-8000-000000000001', 'first_half', 1, true, now());
insert into public.match_starters (event_id, player_id, position_code) values
  ('cc740000-0000-4000-8000-000000000001', 'cc7b0000-0000-4000-8000-000000000001', 'POR');

insert into public.lineups (id, event_id, name, formation_code, is_official, visibility, created_by) values
  ('cc710000-0000-4000-8000-000000000001', 'cc740000-0000-4000-8000-000000000001', 'Titular', '1-3-3', true, 'team', 'cc7a0000-0000-4000-8000-00000000000e');
insert into public.lineup_positions (lineup_id, player_id, location, position_code, x_pct, y_pct) values
  ('cc710000-0000-4000-8000-000000000001', 'cc7b0000-0000-4000-8000-000000000001', 'field', 'POR', 50, 10);

do $$
begin
  set local role authenticated;
  set local "request.jwt.claims" = '{"sub":"cc7a0000-0000-4000-8000-00000000000e","role":"authenticated"}';
  insert into public.match_events (id, event_id, side, type, player_id, clock_seconds) values
    (gen_random_uuid(), 'cc740000-0000-4000-8000-000000000001', 'own', 'goal',
     'cc7b0000-0000-4000-8000-000000000001', 120);
  reset role;
end $$;

insert into public.announcements (club_id, team_id, author_profile_id, title, body) values
  ('cc700000-0000-4000-8000-000000000001', 'cc7e0000-0000-4000-8000-000000000001',
   'cc7a0000-0000-4000-8000-00000000000e', 'Aviso Muro3', 'Cuerpo');

insert into public.conversations (id, club_id, player_id, coach_profile_id) values
  ('cc720000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001',
   'cc7b0000-0000-4000-8000-000000000001', 'cc7a0000-0000-4000-8000-00000000000e'),
  ('cc720000-0000-4000-8000-000000000000', 'cc700000-0000-4000-8000-000000000001',
   'cc7b0000-0000-4000-8000-000000000000', 'cc7a0000-0000-4000-8000-00000000000e');
insert into public.messages (conversation_id, sender_profile_id, body) values
  ('cc720000-0000-4000-8000-000000000001', 'cc7a0000-0000-4000-8000-00000000000e', 'Hola'),
  ('cc720000-0000-4000-8000-000000000000', 'cc7a0000-0000-4000-8000-00000000000e', 'Hola 0');

insert into public.assessment_campaigns (club_id, season_id, period, due_date, created_by, status) values
  ('cc700000-0000-4000-8000-000000000001', 'cc7c0000-0000-4000-8000-000000000001',
   'inicial', '2026-12-01', 'cc7a0000-0000-4000-8000-00000000000e', 'published');

insert into public.team_development_reports (id, club_id, team_id, season_id, period, created_by, visibility) values
  ('cc730000-0000-4000-8000-000000000001', 'cc700000-0000-4000-8000-000000000001',
   'cc7e0000-0000-4000-8000-000000000001', 'cc7c0000-0000-4000-8000-000000000001',
   'inicial', 'cc7a0000-0000-4000-8000-00000000000e', 'team');
insert into public.development_reports (club_id, team_id, player_id, season_id, period, created_by, team_report_id, visibility) values
  ('cc700000-0000-4000-8000-000000000001', 'cc7e0000-0000-4000-8000-000000000001',
   'cc7b0000-0000-4000-8000-000000000001', 'cc7c0000-0000-4000-8000-000000000001',
   'inicial', 'cc7a0000-0000-4000-8000-00000000000e', 'cc730000-0000-4000-8000-000000000001', 'team');

-- p1 paga; p0 no tiene nada.
insert into public.subscription_entitlements (profile_id, expires_at) values
  ('cc7a0000-0000-4000-8000-000000000001', now() + interval '200 days');

-- ── Recolector ──────────────────────────────────────────────────────────────
create temp table _r(fase text, tabla text, filas bigint) on commit drop;
grant all on _r to authenticated;

create or replace function pg_temp.medir(p_fase text, p_uid uuid) returns void
language plpgsql as $$
declare r record; n bigint;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  for r in select unnest(array[
      'events','match_state','match_events','match_periods','match_starters',
      'callup_decisions','match_callup_meta','lineups','lineup_positions',
      'team_members','team_staff','conversations','messages','announcements',
      'assessment_campaigns','development_reports','team_development_reports','players',
      'players_sporting',
      'profiles','memberships','clubs','player_accounts','consents','legal_documents',
      'notifications','seasons','categories','teams','invitations'
    ]) as t
  loop
    execute format('select count(*) from public.%I', r.t) into n;
    perform set_config('role', 'postgres', true);
    insert into _r values (p_fase, r.t, n);
    perform set_config('role', 'authenticated', true);
  end loop;
  perform set_config('role', 'postgres', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [10] El interruptor nace y sigue APAGADO tras la migracion.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
begin
  if (select enabled from public.subscription_wall where id) then
    raise exception 'FAIL [10]: la migracion dejo el muro ENCENDIDO';
  end if;
end $$;

-- ── Fase A: el mundo de hoy (muro apagado) ──────────────────────────────────
select pg_temp.medir('A_apagado_p1', 'cc7a0000-0000-4000-8000-000000000001');
select pg_temp.medir('A_apagado_p0', 'cc7a0000-0000-4000-8000-000000000000');
select pg_temp.medir('A_apagado_en', 'cc7a0000-0000-4000-8000-00000000000e');

-- ── Se enciende ─────────────────────────────────────────────────────────────
update public.subscription_wall set enabled = true, enabled_at = now() where id;

select pg_temp.medir('B_encendido_p1', 'cc7a0000-0000-4000-8000-000000000001');
select pg_temp.medir('B_encendido_p0', 'cc7a0000-0000-4000-8000-000000000000');
select pg_temp.medir('B_encendido_en', 'cc7a0000-0000-4000-8000-00000000000e');

-- ─────────────────────────────────────────────────────────────────────────────
-- [1] ESTRUCTURAL: la lista de tablas con candado, exacta.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_falta text; v_sobra text;
begin
  with esperadas as (select unnest(array[
      'events','match_state','match_events','match_periods','match_starters',
      'callup_decisions','match_callup_meta','lineups','lineup_positions',
      'team_members','team_staff','conversations','messages','announcements',
      'assessment_campaigns','development_reports','team_development_reports','players'
    ]) t),
  puestas as (
    select tablename t from pg_policies
     where schemaname='public' and permissive='RESTRICTIVE'
       and coalesce(qual,'') like '%has_paid_access%'
  )
  select (select string_agg(t, ', ') from (select t from esperadas except select t from puestas) x),
         (select string_agg(t, ', ') from (select t from puestas except select t from esperadas) y)
    into v_falta, v_sobra;
  if v_falta is not null then
    raise exception 'FAIL [1]: estas tablas debian llevar candado y no lo llevan: %', v_falta;
  end if;
  if v_sobra is not null then
    raise exception 'FAIL [1]: estas tablas llevan candado y NO debian — se cerro algo que tenia que quedar abierto: %', v_sobra;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [2] QUIEN PAGA NO PIERDE NADA. La asercion central.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record; v_n integer := 0;
begin
  for r in
    select a.tabla, a.filas antes, b.filas despues
      from _r a join _r b on b.tabla = a.tabla
     where a.fase = 'A_apagado_p1' and b.fase = 'B_encendido_p1'
       and a.filas is distinct from b.filas
  loop
    raise exception 'FAIL [2]: a quien PAGA le cambio % — veia % filas y ahora ve %. El muro le esta recortando producto',
      r.tabla, r.antes, r.despues;
  end loop;
  -- Control positivo: si el fixture estuviera vacio, lo de arriba pasaria sin medir nada.
  select count(*) into v_n from _r where fase='A_apagado_p1' and filas > 0
     and tabla in ('events','lineups','lineup_positions','callup_decisions','team_members',
                   'match_starters','messages','announcements','development_reports');
  if v_n < 9 then
    raise exception 'FAIL [2]: el fixture no tiene contenido en las 9 tablas de control (solo % con filas): [2] no estaria comprobando nada', v_n;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [5] EL STAFF NO SE ENTERA.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select a.tabla, a.filas antes, b.filas despues
      from _r a join _r b on b.tabla = a.tabla
     where a.fase = 'A_apagado_en' and b.fase = 'B_encendido_en'
       and a.filas is distinct from b.filas
  loop
    raise exception 'FAIL [5]: al ENTRENADOR le cambio % — veia % y ahora ve %', r.tabla, r.antes, r.despues;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [3] Quien no paga deja de ver el producto. [8] y antes veia.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tabla, filas from _r
     where fase = 'B_encendido_p0'
       and tabla in ('events','match_state','match_events','match_periods','match_starters',
                     'callup_decisions','match_callup_meta','lineups','lineup_positions',
                     'team_members','team_staff','conversations','messages','announcements',
                     'assessment_campaigns','development_reports','team_development_reports')
       and filas <> 0
  loop
    raise exception 'FAIL [3]: quien no paga sigue viendo % (% filas)', r.tabla, r.filas;
  end loop;
  -- [8] APAGADO = el mundo de hoy: antes de encender SI veia esas tablas.
  if (select count(*) from _r where fase='A_apagado_p0' and filas > 0
        and tabla in ('events','lineups','team_members','announcements')) < 4 then
    raise exception 'FAIL [8]: con el muro apagado la familia sin suscripcion ya no veia el producto — el fixture o el candado estan mal';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [4] Y sigue viendo lo que NO es producto.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select tabla, filas from _r
     where fase = 'B_encendido_p0'
       and tabla in ('profiles','memberships','clubs','player_accounts',
                     'legal_documents','seasons','categories','teams')
       and filas = 0
  loop
    raise exception 'FAIL [4]: el muro cerro %, que tenia que quedar abierta: sin ella no hay ni pantalla de muro ni borrado de cuenta', r.tabla;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [6] EL ESCAPE DE `players`. [7] LA VISTA.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare v_players bigint; v_vista bigint; v_ve_suyo boolean; v_ve_ajeno boolean; v_vista_ajeno boolean;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    '{"sub":"cc7a0000-0000-4000-8000-000000000000","role":"authenticated"}', true);
  select count(*) into v_players from public.players;
  select count(*) into v_vista   from public.players_sporting;
  select exists (select 1 from public.players_sporting where id = 'cc7b0000-0000-4000-8000-000000000002')
    into v_vista_ajeno;
  select exists (select 1 from public.players where id = 'cc7b0000-0000-4000-8000-000000000000')
    into v_ve_suyo;
  select exists (select 1 from public.players where id = 'cc7b0000-0000-4000-8000-000000000002')
    into v_ve_ajeno;
  perform set_config('role', 'postgres', true);

  if not v_ve_suyo then
    raise exception 'FAIL [6]: sin pagar ha dejado de ver a SU PROPIO hijo — se rompen consentimientos y borrado';
  end if;
  if v_ve_ajeno then
    raise exception 'FAIL [6]: sin pagar sigue viendo a un jugador que no es suyo: la plantilla del club es producto';
  end if;
  -- La vista tiene que decir lo MISMO que la tabla, ni mas ni menos. No se le exige
  -- cero: el escape de `players` deja ver a los hijos propios, y la vista, ya en
  -- `security_invoker`, hereda ese mismo escape. Lo que no puede es ensenar a los
  -- ajenos, que es lo que hacia cuando corria como su duena.
  if v_vista <> v_players then
    raise exception 'FAIL [7]: players_sporting ensena % filas y players %. La vista y la tabla tienen que decir lo mismo', v_vista, v_players;
  end if;
  if v_vista_ajeno then
    raise exception 'FAIL [7]: players_sporting sigue ensenando un jugador ajeno — la vista es la puerta de atras de players';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- [9] Consentimientos y borrado de cuenta, sin pagar y con el muro encendido.
-- ─────────────────────────────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"cc7a0000-0000-4000-8000-000000000000","role":"authenticated"}';
do $$
declare v_n integer;
begin
  begin
    select count(*) into v_n from public.preview_account_deletion();
  exception when others then
    raise exception 'FAIL [9]: el muro rompio el preview del borrado de cuenta (%)', sqlerrm;
  end;
  begin
    select count(*) into v_n from public.get_tutor_consents('cc700000-0000-4000-8000-000000000001');
  exception when others then
    raise exception 'FAIL [9]: el muro rompio la lectura de consentimientos (%)', sqlerrm;
  end;
  begin
    select count(*) into v_n from public.my_subscription_status();
  exception when others then
    raise exception 'FAIL [9]: el muro rompio my_subscription_status — la pantalla del muro no podria pintarse (%)', sqlerrm;
  end;
end $$;

reset role;
rollback;
