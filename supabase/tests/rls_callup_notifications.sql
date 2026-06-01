-- Tests F6 Lote B' (Bug D/G) — soporte de notificaciones de convocatoria.
-- Verifica el modelo del que dependen callup_published / callup_updated:
--   D1. el enum notification_type incluye 'callup_updated' (migración
--       20260609000001) y 'callup_published'.
--   D2. un user authenticated NO puede INSERT en notifications (42501): solo
--       el bus (service_role) escribe. (Política: sin policy INSERT.)
--   D3. la resolución de destinatarios evento→team_members→player_accounts
--       devuelve al profile vinculado del roster activo.
--
-- Convención: psql ON_ERROR_STOP=1; BEGIN/ROLLBACK; SQLSTATE esperado en los
-- bloques que deben fallar.

begin;

-- ── D1: enum tiene callup_updated y callup_published ─────────────────────────
do $$
declare n int;
begin
  select count(*) into n from pg_enum e
    join pg_type t on t.oid = e.enumtypid
   where t.typname = 'notification_type'
     and e.enumlabel in ('callup_updated', 'callup_published');
  if n <> 2 then
    raise exception 'FAIL [D1]: faltan valores del enum notification_type (n=%)', n;
  end if;
end $$;

-- Setup mínimo para D2/D3.
insert into public.clubs (id, name, slug) values
  ('66ee0000-c000-0000-0000-000000000001', 'Club Notif', 'club-notif');
insert into public.categories (id, club_id, name, season) values
  ('66ee0000-c100-0000-0000-000000000001', '66ee0000-c000-0000-0000-000000000001', 'Cat Notif', '2025-26');
insert into public.teams (id, category_id, name, format, color) values
  ('66ee0000-c200-0000-0000-000000000001', '66ee0000-c100-0000-0000-000000000001', 'Team Notif', 'F8', '#0EA5E9');
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66ee0000-c300-0000-0000-00000000000A', '66ee0000-c000-0000-0000-000000000001', 'Ana', 'Roster', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('66ee0000-c200-0000-0000-000000000001', '66ee0000-c300-0000-0000-00000000000A', '2025-09-01');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('66ee0000-ca00-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'notif-jug@ts.test', now(), '{}'::jsonb, now(), now());
insert into public.memberships (id, profile_id, club_id, role) values
  ('66ee0000-c500-0001-0000-000000000000', '66ee0000-ca00-0001-0000-000000000000', '66ee0000-c000-0000-0000-000000000001', 'jugador');
insert into public.player_accounts (player_id, profile_id, relation) values
  ('66ee0000-c300-0000-0000-00000000000A', '66ee0000-ca00-0001-0000-000000000000', 'self');
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('66ee0000-c600-0001-0000-000000000000', '66ee0000-c000-0000-0000-000000000001', '66ee0000-c200-0000-0000-000000000001', 'match', 'Partido Notif', '2026-09-20 10:00:00+00', '66ee0000-ca00-0001-0000-000000000000');

-- ── D2: authenticated NO puede insertar notifications (42501) ────────────────
set local role authenticated;
set local "request.jwt.claim.sub" to '66ee0000-ca00-0001-0000-000000000000';
do $$
begin
  begin
    insert into public.notifications (user_id, type, channel, payload, dedupe_key)
      values ('66ee0000-ca00-0001-0000-000000000000', 'callup_updated', 'in_app', '{}'::jsonb, 'x:notif:1');
    raise exception 'FAIL [D2]: authenticated no debería poder insertar notifications';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ── D3: resolución de destinatarios (evento → roster activo → player_accounts) ─
do $$
declare uid uuid;
begin
  select pa.profile_id into uid
    from public.events e
    join public.team_members tm
      on tm.team_id = e.team_id and tm.left_at is null
    join public.player_accounts pa on pa.player_id = tm.player_id
   where e.id = '66ee0000-c600-0001-0000-000000000000';
  if uid is distinct from '66ee0000-ca00-0001-0000-000000000000' then
    raise exception 'FAIL [D3]: destinatario resuelto incorrecto (uid=%)', uid;
  end if;
end $$;

rollback;
