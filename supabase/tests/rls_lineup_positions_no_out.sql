-- Tests F6 Lote B' (rediseño) — lineup_positions ya NO admite location='out'
-- ni la columna out_reason (migración 20260609000000_lineup_no_out_redesign.sql).
--
-- Convención: psql ON_ERROR_STOP=1; bloques que DEBEN fallar capturan el
-- SQLSTATE esperado; todo en BEGIN/ROLLBACK (no deja rastro).
--
-- Casos:
--   N1. INSERT location='out' → check_violation (location in field/bench).
--   N2. la columna out_reason no existe en el schema.
--   N3. INSERT bench válido (sin out_reason) → OK.
--   N4. INSERT field válido → OK.

begin;

insert into public.clubs (id, name, slug) values
  ('66ee0000-9000-0000-0000-000000000001', 'Club NoOut', 'club-no-out');
insert into public.categories (id, club_id, name) values
  ('66ee0000-9100-0000-0000-000000000001', '66ee0000-9000-0000-0000-000000000001', 'Cat NoOut');
insert into public.teams (id, category_id, name, format, color, season) values
  ('66ee0000-9200-0000-0000-000000000001', '66ee0000-9100-0000-0000-000000000001', 'Team NoOut', 'F7', '#0EA5E9', '2025-26');
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('66ee0000-9300-0000-0000-000000000001', '66ee0000-9000-0000-0000-000000000001', 'Uno', 'Campo', '2012-01-01');
insert into public.team_members (team_id, player_id, joined_at) values
  ('66ee0000-9200-0000-0000-000000000001', '66ee0000-9300-0000-0000-000000000001', '2025-09-01');
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at) values
  ('66ee0000-9a00-0001-0000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'noout@ts.test', now(), '{}'::jsonb, now(), now());
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('66ee0000-9600-0001-0000-000000000000', '66ee0000-9000-0000-0000-000000000001', '66ee0000-9200-0000-0000-000000000001', 'match', 'Partido NoOut', '2026-09-20 10:00:00+00', '66ee0000-9a00-0001-0000-000000000000');
insert into public.lineups (id, event_id, name, formation_code, created_by) values
  ('66ee0000-9700-0001-0000-000000000000', '66ee0000-9600-0001-0000-000000000000', 'Titular', '1-3-3', '66ee0000-9a00-0001-0000-000000000000');

-- ── N1: location='out' rechazado ────────────────────────────────────────────
do $$
begin
  begin
    insert into public.lineup_positions (lineup_id, player_id, location)
      values ('66ee0000-9700-0001-0000-000000000000', '66ee0000-9300-0000-0000-000000000001', 'out');
    raise exception 'FAIL [N1]: location=out debería rechazarse';
  exception when check_violation then null;
  end;
end $$;

-- ── N2: la columna out_reason ya no existe ───────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from information_schema.columns
   where table_schema = 'public' and table_name = 'lineup_positions'
     and column_name = 'out_reason';
  if n <> 0 then raise exception 'FAIL [N2]: out_reason todavía existe (n=%)', n; end if;
end $$;

-- ── N3: bench válido ─────────────────────────────────────────────────────────
insert into public.lineup_positions (lineup_id, player_id, location)
  values ('66ee0000-9700-0001-0000-000000000000', '66ee0000-9300-0000-0000-000000000001', 'bench');
do $$
declare n int;
begin
  select count(*) into n from public.lineup_positions
   where lineup_id = '66ee0000-9700-0001-0000-000000000000' and location = 'bench';
  if n <> 1 then raise exception 'FAIL [N3]: bench válido no se insertó (n=%)', n; end if;
end $$;

-- ── N4: field válido (mueve al jugador al campo) ─────────────────────────────
update public.lineup_positions
   set location = 'field', position_code = 'GK', x_pct = 50, y_pct = 94
 where lineup_id = '66ee0000-9700-0001-0000-000000000000'
   and player_id = '66ee0000-9300-0000-0000-000000000001';
do $$
declare n int;
begin
  select count(*) into n from public.lineup_positions
   where lineup_id = '66ee0000-9700-0001-0000-000000000000'
     and location = 'field' and position_code = 'GK';
  if n <> 1 then raise exception 'FAIL [N4]: field válido no quedó (n=%)', n; end if;
end $$;

rollback;
