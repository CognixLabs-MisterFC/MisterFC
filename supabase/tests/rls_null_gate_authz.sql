-- F15-C1-fix — Gates imperativos NULL-safe: un usuario SIN membresías (externo)
-- no puede colarse por un `if not (<gate>)` donde el gate valía NULL.
--
-- Raíz: user_role_in_club devuelve NULL para no-miembros → helpers como
-- user_is_admin_or_director / user_can_approve_plays / user_can_manage_event
-- devolvían NULL → `not NULL = NULL` → `if NULL` NO entra → no lanzaba forbidden.
-- Fix (mig 20261026): los helpers hacen coalesce(...,false); audit_get_conversation
-- y set_session_shared pasan por el helper saneado; cinturón en get_player_medical.
--
-- Este test fija que un EXTERNO queda bloqueado en cada RPC afectada. El caso de
-- lectura médica por staff de otro equipo/club vive en rls_medical_consents (L4/L5).
\ir helpers/auth_users.sql

begin;

create or replace function pg_temp.set_auth(p_sub text) returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_sub, 'role', 'authenticated')::text, true);
end $$;

-- Ejecuta p_sql como p_sub; exige que lance un error que contenga p_expect.
-- Si NO lanza (gate pasado) → FAIL. Si lanza otro error → FAIL.
create or replace function pg_temp.assert_blocked(
  p_label text, p_sub text, p_sql text, p_expect text
) returns void language plpgsql as $$
declare v_passed boolean := false;
begin
  perform pg_temp.set_auth(p_sub);
  begin
    execute p_sql;
    v_passed := true;
  exception when others then
    if position(p_expect in sqlerrm) = 0 then
      raise exception 'FAIL [%]: error inesperado "%" (esperaba "%")', p_label, sqlerrm, p_expect;
    end if;
  end;
  if v_passed then
    raise exception 'FAIL [%]: el externo NO fue bloqueado (el gate dejó pasar)', p_label;
  end if;
end $$;

-- ── Scaffold ────────────────────────────────────────────────────────────────
insert into public.clubs (id,name,slug) values ('fed00000-cccc-0000-0000-000000000001','X','x-nullgate-authz');
insert into public.seasons (id,club_id,label,status) values ('fed00000-5ea5-0000-0000-0000000000a1','fed00000-cccc-0000-0000-000000000001','2025-26','active');
insert into public.categories (id,club_id,name,kind) values ('fed00000-ca70-0000-0000-0000000000a1','fed00000-cccc-0000-0000-000000000001','B','benjamin');
insert into public.teams (id,category_id,name,format,color,season) values ('fed00000-7ea0-0000-0000-0000000000a1','fed00000-ca70-0000-0000-0000000000a1','T1','F7','#10B981','2025-26');
insert into public.players (id,club_id,first_name,last_name,date_of_birth) values ('fed00000-0000-aaaa-0000-000000000001','fed00000-cccc-0000-0000-000000000001','P1','X','2015-04-12');
insert into public.team_members (player_id,team_id,joined_at) values ('fed00000-0000-aaaa-0000-000000000001','fed00000-7ea0-0000-0000-0000000000a1','2025-08-01');

select pg_temp.new_test_user('fed00000-c0ac-0000-0000-000000000001','coach-ng@ts.test','{}'::jsonb);
insert into public.memberships (profile_id,club_id,role) values ('fed00000-c0ac-0000-0000-000000000001','fed00000-cccc-0000-0000-000000000001','entrenador_principal');
-- ATACANTE externo: existe como usuario, pero SIN membresía en ningún club.
select pg_temp.new_test_user('fed00000-9999-0000-0000-000000000001','externo-ng@ts.test','{}'::jsonb);

-- Targets sobre los que intentará actuar el externo.
insert into public.events (id,club_id,team_id,type,title,starts_at,created_by,approval_status) values
  ('fed00000-e0e0-0000-0000-0000000000a1','fed00000-cccc-0000-0000-000000000001','fed00000-7ea0-0000-0000-0000000000a1','training','Appr','2026-03-01 10:00:00+00','fed00000-c0ac-0000-0000-000000000001','pending'),
  ('fed00000-e0e0-0000-0000-0000000000a2','fed00000-cccc-0000-0000-000000000001','fed00000-7ea0-0000-0000-0000000000a1','training','Can','2026-03-03 10:00:00+00','fed00000-c0ac-0000-0000-000000000001',null);
insert into public.sessions (id,club_id,team_id,owner_profile_id,is_template,visibility,session_date) values
  ('fed00000-5e55-0000-0000-0000000000a1','fed00000-cccc-0000-0000-000000000001','fed00000-7ea0-0000-0000-0000000000a1','fed00000-c0ac-0000-0000-000000000001',false,'staff','2026-03-10');
insert into public.holidays (id,club_id,date,reason) values
  ('fed00000-8041-0000-0000-0000000000a1','fed00000-cccc-0000-0000-000000000001','2026-12-24','Navidad');
insert into public.erasure_requests (id,player_id,club_id,requested_by,status) values
  ('fed00000-e4a5-0000-0000-0000000000a1','fed00000-0000-aaaa-0000-000000000001','fed00000-cccc-0000-0000-000000000001','fed00000-c0ac-0000-0000-000000000001','pending');
insert into public.conversations (id,club_id,player_id,coach_profile_id) values
  ('fed00000-c04e-0000-0000-0000000000a1','fed00000-cccc-0000-0000-000000000001','fed00000-0000-aaaa-0000-000000000001','fed00000-c0ac-0000-0000-000000000001');

-- ── El externo debe quedar BLOQUEADO en cada RPC ────────────────────────────
select pg_temp.assert_blocked('mark_holiday',        'fed00000-9999-0000-0000-000000000001',
  'select public.mark_holiday(''fed00000-cccc-0000-0000-000000000001'',''2026-11-01'',''forjado'')', 'forbidden');
select pg_temp.assert_blocked('unmark_holiday',      'fed00000-9999-0000-0000-000000000001',
  'select public.unmark_holiday(''fed00000-8041-0000-0000-0000000000a1'')', 'forbidden');
select pg_temp.assert_blocked('decide_event_approval','fed00000-9999-0000-0000-000000000001',
  'select public.decide_event_approval(''fed00000-e0e0-0000-0000-0000000000a1'',true,null)', 'forbidden');
select pg_temp.assert_blocked('cancel_event',        'fed00000-9999-0000-0000-000000000001',
  'select public.cancel_event(''fed00000-e0e0-0000-0000-0000000000a2'',''forjado'')', 'forbidden');
select pg_temp.assert_blocked('set_session_shared',  'fed00000-9999-0000-0000-000000000001',
  'select public.set_session_shared(''fed00000-5e55-0000-0000-0000000000a1'',true)', 'forbidden');
select pg_temp.assert_blocked('audit_get_conversation','fed00000-9999-0000-0000-000000000001',
  'select * from public.audit_get_conversation(''fed00000-c04e-0000-0000-0000000000a1'',''motivo auditoria'')', 'audit_requires_admin_or_director');
select pg_temp.assert_blocked('decide_player_erasure','fed00000-9999-0000-0000-000000000001',
  'select public.decide_player_erasure(''fed00000-e4a5-0000-0000-0000000000a1'',false,''forjado'')', 'forbidden');

reset role;
rollback;
