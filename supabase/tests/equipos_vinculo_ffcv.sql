-- El vínculo con la FFCV en `teams`.
-- Verifica la migración 20261116000000_equipos_vinculo_ffcv.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise 'FAIL[...]'; el rol y el
-- `auth.uid()` se cambian con set_config(…, true) DENTRO del bloque y se vuelve a
-- 'postgres' antes de afirmar, para que la aserción lea sin RLS.
--
-- LO QUE SE MIDE, y por qué cada caso existe:
--   T1. Las cuatro columnas están y nacen NULL. La migración abre el hueco, no vincula.
--   T2. El único MUERDE: dos equipos del mismo club y temporada no comparten código.
--       Es el error real que se quiere cazar (un mapeo cruzado al vincular a mano).
--   T3. El único es PARCIAL: varios equipos sin vincular (NULL) conviven. Sin esto, el
--       estado normal durante el vínculo manual sería imposible.
--   T4. El único es POR TEMPORADA: el mismo código en 2026-27 y 2027-28 se PERMITE. Es
--       la razón de ser del índice; si alguien lo "simplifica" a global, este caso cae y
--       el fallo se habría visto en junio, al crear la temporada siguiente, no hoy.
--   T5. El CHECK para la equivocación realista: el NOMBRE del equipo o el del grupo en
--       la columna del código, rechazados; un código numérico, aceptado.
--   T6. ANTI-REGRESIÓN de permisos, y mide DOS cosas a la vez: que el grant de
--       `authenticated` sobre `teams` es POR TABLA y alcanza a las columnas nuevas (si
--       fuera por columna, como en `profiles`, el admin daría 0 filas), y que la policy
--       `teams_write_admin_coord` sigue diciendo lo mismo. Lleva su propio control: se
--       comprueba que el ayudante SÍ VE la fila antes de que falle al escribirla, para
--       que el 0 sea atribuible a la escritura y no a una ceguera de SELECT.
--   T7. El único cruza clubes a propósito: un equipo de OTRO club no puede reclamar un
--       código ya usado en la misma temporada. Un equipo de la FFCV es de un solo club.
\ir helpers/auth_users.sql

begin;

-- ── Usuarios ─────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('c1aa0000-0000-4000-8000-000000000001', 'vffcv-admin@test.local',    '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('c1aa0000-0000-4000-8000-000000000002', 'vffcv-ayudante@test.local', '{"full_name":"Ayudante"}'::jsonb);

-- ── Dos clubes (T7 necesita el segundo), categorías y equipos ────────────────────────
insert into public.clubs (id, name, slug) values
  ('c1000000-0000-4000-8000-0000000000c1', 'Club VFFCV',   'club-vffcv'),
  ('c1000000-0000-4000-8000-0000000000c2', 'Club VFFCV 2', 'club-vffcv-2');
insert into public.categories (id, club_id, name) values
  ('c1000000-0000-4000-8000-000000000ca1', 'c1000000-0000-4000-8000-0000000000c1', 'Cat VFFCV'),
  ('c1000000-0000-4000-8000-000000000ca2', 'c1000000-0000-4000-8000-0000000000c2', 'Cat VFFCV 2');

-- Tres equipos del club 1 en 2026-27 y uno en 2027-28 (T4). Nombres distintos porque ya
-- existe teams_club_name_season_uniq (club_id, name, season).
-- `club_id` NO se pasa: lo deriva SIEMPRE el trigger trg_teams_derive_from_category
-- desde la categoría (denormalización autoritativa), igual que en los otros 24 fixtures.
-- Ese mismo trigger toca `season` SOLO si llega NULL, así que los UPDATE de T2/T4/T6 no
-- la reescriben y la 704 se queda en 2027-28 — que es justo lo que T4 necesita medir.
insert into public.teams (id, category_id, name, format, color, season) values
  ('c1000000-0000-4000-8000-000000000701', 'c1000000-0000-4000-8000-000000000ca1', 'Infantil A', 'F11', '#10B981', '2026-27'),
  ('c1000000-0000-4000-8000-000000000702', 'c1000000-0000-4000-8000-000000000ca1', 'Infantil B', 'F11', '#10B981', '2026-27'),
  ('c1000000-0000-4000-8000-000000000703', 'c1000000-0000-4000-8000-000000000ca1', 'Infantil C', 'F11', '#10B981', '2026-27'),
  ('c1000000-0000-4000-8000-000000000704', 'c1000000-0000-4000-8000-000000000ca1', 'Infantil B', 'F11', '#10B981', '2027-28'),
  ('c1000000-0000-4000-8000-000000000705', 'c1000000-0000-4000-8000-000000000ca2', 'Infantil B', 'F11', '#10B981', '2026-27');

insert into public.memberships (id, profile_id, club_id, role) values
  ('c1dd0000-0000-4000-8000-000000000001','c1aa0000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-0000000000c1','admin_club'),
  ('c1dd0000-0000-4000-8000-000000000002','c1aa0000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-0000000000c1','entrenador_ayudante');

-- ══════════ T1 · las cuatro columnas existen y nacen NULL ══════════
do $$
declare n int;
begin
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'teams'
     and column_name in ('ffcv_team_code','ffcv_season_code','ffcv_competition_code','ffcv_group_code');
  if n <> 4 then raise exception 'FAIL[T1]: faltan columnas del vinculo (encontradas=%)', n; end if;

  select count(*) into n from public.teams
   where ffcv_team_code is not null or ffcv_season_code is not null
      or ffcv_competition_code is not null or ffcv_group_code is not null;
  if n <> 0 then raise exception 'FAIL[T1]: la migracion no debia vincular a nadie (filas con codigo=%)', n; end if;
end $$;

-- ══════════ T2 · el único muerde dentro de la misma temporada ══════════
do $$
declare salto boolean := false;
begin
  update public.teams set ffcv_team_code = '15140'
   where id = 'c1000000-0000-4000-8000-000000000702';
  begin
    update public.teams set ffcv_team_code = '15140'
     where id = 'c1000000-0000-4000-8000-000000000701';
  exception when unique_violation then salto := true;
  end;
  if not salto then
    raise exception 'FAIL[T2]: dos equipos de la misma temporada han compartido el codigo 15140';
  end if;
end $$;

-- ══════════ T3 · el único es PARCIAL: los NULL conviven ══════════
do $$
declare n int;
begin
  -- 701 y 703 siguen sin vincular tras T2 (el intento de 701 saltó).
  select count(*) into n from public.teams
   where id in ('c1000000-0000-4000-8000-000000000701','c1000000-0000-4000-8000-000000000703')
     and ffcv_team_code is null;
  if n <> 2 then raise exception 'FAIL[T3]: los equipos sin vincular debian convivir (sin codigo=%)', n; end if;
end $$;

-- ══════════ T4 · el mismo código en OTRA temporada sí se permite ══════════
do $$
declare n int; v_season text;
begin
  -- Control del propio caso: si el trigger hubiera igualado las temporadas, este test
  -- diría "permitido" sin haber cruzado nada. Se comprueba que 702 y 704 siguen en
  -- temporadas DISTINTAS antes de afirmar.
  select season into v_season from public.teams where id = 'c1000000-0000-4000-8000-000000000704';
  if v_season <> '2027-28' then
    raise exception 'FAIL[T4]: la 704 debia seguir en 2027-28 y esta en % — el caso no mide nada', v_season;
  end if;

  update public.teams set ffcv_team_code = '15140'
   where id = 'c1000000-0000-4000-8000-000000000704';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T4]: el mismo codigo en otra temporada debia permitirse; el unico no puede ser global (filas=%)', n;
  end if;
end $$;

-- ══════════ T5 · el CHECK para la equivocación realista ══════════
do $$
declare n int; salto boolean;
begin
  salto := false;
  begin
    update public.teams set ffcv_team_code = 'U.D. Fonteta ''B'''
     where id = 'c1000000-0000-4000-8000-000000000703';
  exception when check_violation then salto := true;
  end;
  if not salto then raise exception 'FAIL[T5]: el NOMBRE del equipo no debia caber en ffcv_team_code'; end if;

  salto := false;
  begin
    update public.teams set ffcv_group_code = 'Grup - 12'
     where id = 'c1000000-0000-4000-8000-000000000703';
  exception when check_violation then salto := true;
  end;
  if not salto then raise exception 'FAIL[T5]: el NOMBRE del grupo no debia caber en ffcv_group_code'; end if;

  update public.teams
     set ffcv_season_code = '22', ffcv_competition_code = '905431987', ffcv_group_code = '905432005'
   where id = 'c1000000-0000-4000-8000-000000000702';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL[T5]: los codigos numericos de verdad debian entrar (filas=%)', n; end if;
end $$;

-- ══════════ T6 · permisos: el admin escribe, el ayudante no ══════════
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"c1aa0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  update public.teams set ffcv_team_code = '900463025'
   where id = 'c1000000-0000-4000-8000-000000000703';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T6]: el admin_club debia poder escribir el vinculo; si da 0, el grant de teams es POR COLUMNA y no alcanza a las nuevas (filas=%)', n;
  end if;

  -- CONTROL del negativo: el ayudante SÍ ve la fila. Sin esto, el 0 de abajo podría ser
  -- ceguera de SELECT y no la policy de escritura.
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"c1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  select count(*) into n from public.teams where id = 'c1000000-0000-4000-8000-000000000703';
  perform set_config('role', 'postgres', true);
  if n <> 1 then raise exception 'FAIL[T6]: el ayudante debia VER el equipo (filas=%); el negativo no mediria la escritura', n; end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"c1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.teams set ffcv_team_code = '99999999'
   where id = 'c1000000-0000-4000-8000-000000000703';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then raise exception 'FAIL[T6]: el entrenador_ayudante no debia poder escribir el vinculo (filas=%)', n; end if;
end $$;

-- ══════════ T7 · el único cruza clubes: un código es de un solo club ══════════
do $$
declare salto boolean := false;
begin
  begin
    update public.teams set ffcv_team_code = '15140'
     where id = 'c1000000-0000-4000-8000-000000000705';   -- OTRO club, misma temporada
  exception when unique_violation then salto := true;
  end;
  if not salto then
    raise exception 'FAIL[T7]: un equipo de otro club ha reclamado un codigo ya usado en la misma temporada';
  end if;
end $$;

rollback;
