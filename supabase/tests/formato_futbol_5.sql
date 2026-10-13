-- Tests — EL FÚTBOL 5 EXISTE (migración 20261120000000_el_futbol_5_existe.sql).
--
-- Convención del repo: psql con ON_ERROR_STOP=1; cada bloque que DEBE fallar va
-- envuelto en un DO con EXCEPTION capturando el SQLSTATE esperado y un
-- `raise exception 'FAIL [...]'` si NO falla. Todo en una transacción con
-- ROLLBACK final → no deja rastro.
--
-- Son constraints y un trigger de tabla (no RLS): superuser, sin role-switch.
--
-- Casos:
--   T1. equipo con format 'F5' → OK (antes de la migración: check_violation).
--   T2. 'F7', 'F8' y 'F11' siguen entrando → la lista se amplió, no se cambió.
--   T3. un formato inventado ('F6') sigue rechazado → check_violation.
--   T4. formación propia F5 con 5 posiciones → OK (el CHECK de coach_formations
--       es el SEGUNDO sitio: sin él el equipo existiría y su entrenador no podría
--       guardar formación).
--   T5. EL AGUJERO QUE ESTO CIERRA: formación F5 con ONCE posiciones →
--       check_violation. Con el `case` sin `else`, 'F5' dejaba `v_expected` en
--       NULL, la comparación de la cuenta valía NULL (que no es TRUE) y la
--       validación desaparecía sin avisar: esto habría ENTRADO.
--   T6. formación F8 con 7 posiciones sigue rechazada → sin regresión en lo que
--       ya funcionaba.
--   T7. FALLA CERRADO: con el CHECK del formato relajado dentro de la
--       transacción, un formato que el trigger no conoce lo para el TRIGGER.
--       Es la red para el próximo que amplíe el CHECK y se olvide del trigger.

\ir helpers/auth_users.sql

begin;

insert into public.clubs (id, name, slug) values
  ('f5f50000-0000-4000-8000-000000000001', 'Club F5', 'club-f5');

insert into public.categories (id, club_id, name, kind) values
  ('f5f50000-0dd0-4000-8000-000000000001', 'f5f50000-0000-4000-8000-000000000001', 'Querubín', 'querubin');

select pg_temp.new_test_user('f5f50000-aaaa-0001-0000-000000000000', 'coach-f5@ts.test', '{}'::jsonb);

-- ── T1. El equipo de fútbol 5 se puede crear. ─────────────────────────────────
insert into public.teams (id, category_id, club_id, name, format, season) values
  ('f5f50000-ee00-4000-8000-000000000001',
   'f5f50000-0dd0-4000-8000-000000000001',
   'f5f50000-0000-4000-8000-000000000001',
   'Querubines', 'F5', '2026-27');

do $$
declare v_fmt text;
begin
  select format into v_fmt from public.teams
   where id = 'f5f50000-ee00-4000-8000-000000000001';
  if v_fmt is distinct from 'F5' then
    raise exception 'FAIL [T1]: el equipo debería haber quedado en F5 (got %)', v_fmt;
  end if;
end $$;

-- ── T2. Los tres de siempre siguen entrando. ──────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['F7','F8','F11'] loop
    insert into public.teams (category_id, club_id, name, format, season)
      values ('f5f50000-0dd0-4000-8000-000000000001',
              'f5f50000-0000-4000-8000-000000000001',
              'Equipo ' || f, f, '2026-27');
  end loop;
end $$;

do $$
declare n int;
begin
  select count(*) into n from public.teams
   where club_id = 'f5f50000-0000-4000-8000-000000000001'
     and format in ('F5','F7','F8','F11');
  if n <> 4 then
    raise exception 'FAIL [T2]: esperaba los 4 formatos, hay % equipos', n;
  end if;
end $$;

-- ── T3. Un formato inventado sigue rechazado. ─────────────────────────────────
do $$ begin
  begin
    insert into public.teams (category_id, club_id, name, format, season)
      values ('f5f50000-0dd0-4000-8000-000000000001',
              'f5f50000-0000-4000-8000-000000000001',
              'Equipo F6', 'F6', '2026-27');
    raise exception 'FAIL [T3]: un formato fuera de la lista debería dar check_violation';
  exception when check_violation then null; end;
end $$;

-- ── T4. La formación propia de F5, con sus cinco posiciones. ──────────────────
insert into public.coach_formations
  (id, owner_profile_id, club_id, name, format, positions)
values
  ('f5f50000-ff00-4000-8000-000000000001',
   'f5f50000-aaaa-0001-0000-000000000000',
   'f5f50000-0000-4000-8000-000000000001',
   '1-2-2', 'F5',
   '[{"position_code":"GK","x_pct":50,"y_pct":94},
     {"position_code":"DF1","x_pct":30,"y_pct":70},
     {"position_code":"DF2","x_pct":70,"y_pct":70},
     {"position_code":"FW1","x_pct":30,"y_pct":34},
     {"position_code":"FW2","x_pct":70,"y_pct":34}]'::jsonb);

do $$
declare n int;
begin
  select jsonb_array_length(positions) into n from public.coach_formations
   where id = 'f5f50000-ff00-4000-8000-000000000001';
  if n <> 5 then
    raise exception 'FAIL [T4]: la formación F5 debería tener 5 posiciones (got %)', n;
  end if;
end $$;

-- ── T5. EL AGUJERO: once posiciones en F5 NO entran. ──────────────────────────
do $$
declare v_pos jsonb;
begin
  select jsonb_agg(jsonb_build_object('position_code', 'P' || i, 'x_pct', 50, 'y_pct', 50))
    into v_pos from generate_series(1, 11) i;
  begin
    insert into public.coach_formations
      (owner_profile_id, club_id, name, format, positions)
    values ('f5f50000-aaaa-0001-0000-000000000000',
            'f5f50000-0000-4000-8000-000000000001',
            'once en efe cinco', 'F5', v_pos);
    raise exception 'FAIL [T5]: 11 posiciones en F5 deberían dar check_violation (el case sin else las dejaba pasar)';
  exception when check_violation then null; end;
end $$;

-- ── T6. Lo que ya funcionaba sigue funcionando: 7 posiciones en F8, no. ───────
do $$
declare v_pos jsonb;
begin
  select jsonb_agg(jsonb_build_object('position_code', 'P' || i, 'x_pct', 50, 'y_pct', 50))
    into v_pos from generate_series(1, 7) i;
  begin
    insert into public.coach_formations
      (owner_profile_id, club_id, name, format, positions)
    values ('f5f50000-aaaa-0001-0000-000000000000',
            'f5f50000-0000-4000-8000-000000000001',
            'siete en efe ocho', 'F8', v_pos);
    raise exception 'FAIL [T6]: 7 posiciones en F8 deberían seguir dando check_violation';
  exception when check_violation then null; end;
end $$;

-- ── T7. FALLA CERRADO: sin el CHECK delante, el trigger para el formato que no
--       conoce. Esto es lo que protege al próximo que amplíe la lista y se olvide
--       del trigger: en vez de perder la validación de la cuenta, no inserta.
--       El CHECK se quita DENTRO de la transacción; el rollback lo devuelve.
-- ─────────────────────────────────────────────────────────────────────────────
alter table public.coach_formations drop constraint coach_formations_format_check;

do $$
declare v_pos jsonb;
begin
  select jsonb_agg(jsonb_build_object('position_code', 'P' || i, 'x_pct', 50, 'y_pct', 50))
    into v_pos from generate_series(1, 9) i;
  begin
    insert into public.coach_formations
      (owner_profile_id, club_id, name, format, positions)
    values ('f5f50000-aaaa-0001-0000-000000000000',
            'f5f50000-0000-4000-8000-000000000001',
            'formato del futuro', 'F99', v_pos);
    raise exception 'FAIL [T7]: un formato desconocido debería pararlo el TRIGGER, no colarse sin validar la cuenta';
  exception when check_violation then null; end;
end $$;

rollback;
