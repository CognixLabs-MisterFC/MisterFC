-- Tests — LOS TRES TIEMPOS (migración 20261121000000_los_tres_tiempos.sql).
--
-- Convención del repo: psql con ON_ERROR_STOP=1; cada bloque que DEBE fallar va
-- envuelto en un DO con EXCEPTION capturando el SQLSTATE esperado y un
-- `raise exception 'FAIL [...]'` si NO falla. Todo en una transacción con
-- ROLLBACK final → no deja rastro.
--
-- Constraints de tabla (no RLS): superuser, sin role-switch.
--
-- Casos:
--   T1. un periodo 'third_period' en el reloj → OK.
--   T2. LOS SEIS EN EL MISMO PARTIDO: 1ª, 2ª, tercer tiempo y las dos de
--       prórroga más la tanda, con ordinales 1..6. Esto importa porque
--       `match_periods` tiene UNIQUE(event_id, ordinal) y hoy en producción
--       `extra_first` va con ordinal 3 — justo el que ocupa el tercer tiempo. Un
--       partido de tres tiempos CON prórroga tiene que ser representable.
--   T3. un periodo inventado sigue rechazado → check_violation.
--   T4. un gol en 'third_period' se puede apuntar (segundo CHECK, otra tabla).
--   T5. un gol en un periodo inventado sigue rechazado → check_violation.
--   T6. `period_count` de una categoría nueva vale 2 → la migración NO cambia el
--       comportamiento de nadie al aplicarse.
--   T7. `period_count` = 3 entra; 1 y 4 no → el CHECK no deja guardar un estado
--       que el reloj no sabe pintar.
--   T8. tres tiempos de doce: period_count=3 con half_duration_minutes=12.

\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('33330000-0000-4000-8000-000000000001', 'Club 3T', 'club-3t');

insert into public.categories (id, club_id, name, kind) values
  ('33330000-0dd0-4000-8000-000000000001', '33330000-0000-4000-8000-000000000001', 'Querubín', 'querubin');

select pg_temp.new_test_user('33330000-aaaa-0001-0000-000000000000', 'coach-3t@ts.test', '{}'::jsonb);

insert into public.teams (id, category_id, club_id, name, format, season) values
  ('33330000-ee00-4000-8000-000000000001',
   '33330000-0dd0-4000-8000-000000000001',
   '33330000-0000-4000-8000-000000000001',
   'Querubines', 'F5', '2026-27');

-- `match_assert_event` exige type in ('match','friendly') y team_id no nulo.
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('33330000-ef00-4000-8000-000000000001',
   '33330000-0000-4000-8000-000000000001',
   '33330000-ee00-4000-8000-000000000001',
   'friendly', 'Amistoso de querubines', '2026-11-07 10:00:00+01',
   '33330000-aaaa-0001-0000-000000000000');

-- ── T1. El tercer tiempo entra en el reloj. ───────────────────────────────────
insert into public.match_periods (event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, ended)
values ('33330000-ef00-4000-8000-000000000001', 'third_period', 3, 0, 0, false, false);

do $$
declare n int;
begin
  select count(*) into n from public.match_periods
   where event_id = '33330000-ef00-4000-8000-000000000001' and period = 'third_period';
  if n <> 1 then raise exception 'FAIL [T1]: el tercer tiempo debería haber entrado (got %)', n; end if;
end $$;

-- ── T2. Los seis en el mismo partido, con ordinales 1..6. ─────────────────────
insert into public.match_periods (event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, ended)
values
  ('33330000-ef00-4000-8000-000000000001', 'first_half',   1, 0, 0, false, true),
  ('33330000-ef00-4000-8000-000000000001', 'second_half',  2, 0, 0, false, true),
  ('33330000-ef00-4000-8000-000000000001', 'extra_first',  4, 0, 0, false, false),
  ('33330000-ef00-4000-8000-000000000001', 'extra_second', 5, 0, 0, false, false),
  ('33330000-ef00-4000-8000-000000000001', 'penalties',    6, 0, 0, false, false);

do $$
declare n int;
begin
  select count(*) into n from public.match_periods
   where event_id = '33330000-ef00-4000-8000-000000000001';
  if n <> 6 then
    raise exception 'FAIL [T2]: un partido de tres tiempos con prórroga son 6 periodos (got %)', n;
  end if;
end $$;

-- ── T3. Un periodo inventado sigue rechazado. ─────────────────────────────────
do $$ begin
  begin
    insert into public.match_periods (event_id, period, ordinal, base_offset_seconds, accumulated_seconds, running, ended)
    values ('33330000-ef00-4000-8000-000000000001', 'fourth_period', 7, 0, 0, false, false);
    raise exception 'FAIL [T3]: un periodo fuera de la lista debería dar check_violation';
  exception when check_violation then null; end;
end $$;

-- ── T4. Un gol en el tercer tiempo se puede apuntar. ──────────────────────────
insert into public.match_events (event_id, club_id, side, type, period, clock_seconds, metadata, created_by)
values ('33330000-ef00-4000-8000-000000000001',
        '33330000-0000-4000-8000-000000000001',
        'rival', 'goal', 'third_period', 90, '{}'::jsonb,
        '33330000-aaaa-0001-0000-000000000000');

do $$
declare n int;
begin
  select count(*) into n from public.match_events
   where event_id = '33330000-ef00-4000-8000-000000000001' and period = 'third_period';
  if n <> 1 then
    raise exception 'FAIL [T4]: el gol del tercer tiempo debería haber entrado (got %)', n;
  end if;
end $$;

-- ── T5. Y uno en un periodo inventado, no. ────────────────────────────────────
do $$ begin
  begin
    insert into public.match_events (event_id, club_id, side, type, period, clock_seconds, metadata, created_by)
    values ('33330000-ef00-4000-8000-000000000001',
            '33330000-0000-4000-8000-000000000001',
            'rival', 'goal', 'cuarto_tiempo', 90, '{}'::jsonb,
            '33330000-aaaa-0001-0000-000000000000');
    raise exception 'FAIL [T5]: un gol en un periodo inventado debería dar check_violation';
  exception when check_violation then null; end;
end $$;

-- ── T6. Una categoría nueva nace con DOS periodos: nada cambia al aplicar. ────
do $$
declare v_count smallint;
begin
  insert into public.categories (club_id, name, kind)
    values ('33330000-0000-4000-8000-000000000001', 'Cadete', 'cadete')
    returning period_count into v_count;
  if v_count <> 2 then
    raise exception 'FAIL [T6]: por defecto son 2 periodos (got %)', v_count;
  end if;
end $$;

-- ── T7. 3 entra; 1 y 4 no (el reloj solo sabe colocar hasta el tercero). ──────
update public.categories set period_count = 3
 where id = '33330000-0dd0-4000-8000-000000000001';

do $$ begin
  begin
    update public.categories set period_count = 4
     where id = '33330000-0dd0-4000-8000-000000000001';
    raise exception 'FAIL [T7a]: period_count=4 debería dar check_violation';
  exception when check_violation then null; end;
end $$;

do $$ begin
  begin
    update public.categories set period_count = 1
     where id = '33330000-0dd0-4000-8000-000000000001';
    raise exception 'FAIL [T7b]: period_count=1 debería dar check_violation';
  exception when check_violation then null; end;
end $$;

-- ── T8. Tres tiempos de doce minutos, que es el caso real. ────────────────────
do $$
declare v_count smallint; v_dur int;
begin
  update public.categories
     set period_count = 3, half_duration_minutes = 12
   where id = '33330000-0dd0-4000-8000-000000000001'
   returning period_count, half_duration_minutes into v_count, v_dur;
  if v_count <> 3 or v_dur <> 12 then
    raise exception 'FAIL [T8]: esperaba 3 periodos de 12 (got % de %)', v_count, v_dur;
  end if;
end $$;

rollback;
