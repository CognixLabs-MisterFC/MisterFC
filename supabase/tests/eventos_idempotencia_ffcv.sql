-- La idempotencia del importador de la FFCV en `events`.
-- Verifica la migración 20261117000000_eventos_idempotencia_ffcv.sql.
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise 'FAIL[...]'; el rol y el
-- `auth.uid()` se cambian con set_config(…, true) DENTRO del bloque y se vuelve a
-- 'postgres' antes de afirmar, para que la aserción lea sin RLS.
--
-- Casos:
--   T1. Las dos columnas están y nacen NULL. La migración abre el hueco, no marca nada.
--   T2. El único MUERDE: el mismo `codacta` dos veces para el MISMO equipo. Es la
--       duplicación que toda esta loncha existe para impedir.
--   T3. EL DERBI, y es el caso que justifica el índice compuesto: el mismo `codacta` para
--       DOS equipos distintos SÍ se permite, porque un partido de la federación entre dos
--       equipos del mismo club tiene que producir un evento en el calendario de cada uno.
--       Si alguien "simplifica" el único a `(ffcv_match_code)` a secas, este caso cae.
--   T4. El único es PARCIAL: los eventos que no vienen de la FFCV (NULL) conviven.
--   T5. El CHECK de `team_id`, que es LO QUE HACE HERMÉTICO al único: un acta en un evento
--       de club (team_id NULL) se rechaza. Sin él, dos filas con team_id NULL tendrían
--       el mismo acta y esquivarían el índice las dos, porque en un único de Postgres los
--       NULL son distintos entre sí. El caso lo comprueba de las dos formas.
--   T6. El CHECK de formato, para la equivocación realista: 'Jornada 1' en la columna del
--       acta, rechazado; los 8 dígitos de un acta de verdad, aceptados.
--   T7. `ffcv_round`: sin acta, rechazada; cero, rechazada; con acta y 1, aceptada. La
--       dependencia es de UN sentido, así que NO se exige jornada para tener acta.
--   T8. ANTI-REGRESIÓN de permisos, sobre la puerta VIVA, que es la de O2
--       (20261042000000): admin_club/director club-wide, coordinador de ESE equipo, o
--       CUALQUIER staff activo del equipo —principal o ayudante—. El sistema de
--       capabilities (`can_manage_calendar`) lo eliminó esa migración, así que un ayudante
--       del equipo SÍ gestiona el calendario de serie. Tres medidas:
--         a) el admin escribe el evento de E1 → 1 fila. Esto prueba a la vez que el grant
--            de `events` para `authenticated` es POR TABLA y alcanza a las columnas nuevas
--            (si fuera por columna, como en `profiles`, daría 0).
--         b) el AYUDANTE, staff activo de E1, escribe el evento de E1 → 1 fila. Deja
--            fijada la decisión de O2: si alguien vuelve a exigir el principal, cae aquí.
--         c) ese mismo ayudante, que NO es staff de E2, escribe el evento de E2 → 0 filas.
--            El 0 es atribuible al alcance por equipo y no a un grant roto, precisamente
--            porque (b) ya demostró que este actor puede escribir; y el valor que intenta
--            poner es legal, así que tampoco es un CHECK.
\ir helpers/auth_users.sql

begin;

-- ── Usuarios ─────────────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('d1aa0000-0000-4000-8000-000000000001', 'iffcv-admin@test.local',    '{"full_name":"Admin"}'::jsonb);
select pg_temp.new_test_user('d1aa0000-0000-4000-8000-000000000002', 'iffcv-ayudante@test.local', '{"full_name":"Ayudante"}'::jsonb);

-- ── Club, categoría y DOS equipos (el derbi de T3 los necesita) ──────────────────────
insert into public.clubs (id, name, slug) values
  ('d1000000-0000-4000-8000-0000000000c1', 'Club IFFCV', 'club-iffcv');
insert into public.categories (id, club_id, name) values
  ('d1000000-0000-4000-8000-000000000ca1', 'd1000000-0000-4000-8000-0000000000c1', 'Cat IFFCV');
insert into public.teams (id, category_id, name, format, color, season) values
  ('d1000000-0000-4000-8000-000000000701', 'd1000000-0000-4000-8000-000000000ca1', 'Infantil A', 'F11', '#10B981', '2026-27'),
  ('d1000000-0000-4000-8000-000000000702', 'd1000000-0000-4000-8000-000000000ca1', 'Infantil B', 'F11', '#10B981', '2026-27');

insert into public.memberships (id, profile_id, club_id, role) values
  ('d1dd0000-0000-4000-8000-000000000001','d1aa0000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-0000000000c1','admin_club'),
  ('d1dd0000-0000-4000-8000-000000000002','d1aa0000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-0000000000c1','entrenador_ayudante');

-- El ayudante es staff ACTIVO de E1: así `events_select` le deja ver el evento (rama
-- user_is_staff_of_team) sin que `user_can_manage_event` le deje escribirlo. Es lo que
-- hace que el 0 de T8 sea atribuible a la escritura y no a una ceguera.
insert into public.team_staff (id, team_id, membership_id, staff_role, joined_at) values
  ('d1cc0000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000701','d1dd0000-0000-4000-8000-000000000002','entrenador_ayudante', date '2026-07-01');

-- ── Eventos. Todos los firma el admin; seis de equipo y uno de CLUB (team_id null) ───
insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  ('d1ee0000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-000000000701','match','J1 de E1','2026-10-18T08:30:00Z','d1aa0000-0000-4000-8000-000000000001'),
  ('d1ee0000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-000000000701','match','otro de E1','2026-10-25T14:00:00Z','d1aa0000-0000-4000-8000-000000000001'),
  ('d1ee0000-0000-4000-8000-000000000003','d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-000000000702','match','el mismo partido, visto por E2','2026-10-18T08:30:00Z','d1aa0000-0000-4000-8000-000000000001'),
  ('d1ee0000-0000-4000-8000-000000000004','d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-000000000701','training','entreno, no viene de la FFCV','2026-10-20T16:00:00Z','d1aa0000-0000-4000-8000-000000000001'),
  ('d1ee0000-0000-4000-8000-000000000005','d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-000000000701','match','para la jornada','2026-11-07T11:00:00Z','d1aa0000-0000-4000-8000-000000000001'),
  ('d1ee0000-0000-4000-8000-000000000006','d1000000-0000-4000-8000-0000000000c1', null,                                 'other','asamblea del club','2026-11-10T18:00:00Z','d1aa0000-0000-4000-8000-000000000001'),
  ('d1ee0000-0000-4000-8000-000000000007','d1000000-0000-4000-8000-0000000000c1','d1000000-0000-4000-8000-000000000701','match','el de los permisos','2026-11-14T15:00:00Z','d1aa0000-0000-4000-8000-000000000001');

-- ══════════ T1 · las dos columnas existen y nacen NULL ══════════
do $$
declare n int;
begin
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'events'
     and column_name in ('ffcv_match_code','ffcv_round');
  if n <> 2 then raise exception 'FAIL[T1]: faltan columnas del acta (encontradas=%)', n; end if;

  select count(*) into n from public.events
   where ffcv_match_code is not null or ffcv_round is not null;
  if n <> 0 then raise exception 'FAIL[T1]: la migracion no debia marcar ningun evento (marcados=%)', n; end if;
end $$;

-- ══════════ T2 · el único muerde: el mismo acta dos veces en el MISMO equipo ══════════
do $$
declare salto boolean := false;
begin
  update public.events set ffcv_match_code = '26539172'
   where id = 'd1ee0000-0000-4000-8000-000000000001';
  begin
    update public.events set ffcv_match_code = '26539172'
     where id = 'd1ee0000-0000-4000-8000-000000000002';   -- mismo equipo E1
  exception when unique_violation then salto := true;
  end;
  if not salto then
    raise exception 'FAIL[T2]: el mismo acta se ha duplicado dentro del mismo equipo';
  end if;
end $$;

-- ══════════ T3 · EL DERBI: el mismo acta en OTRO equipo sí se permite ══════════
do $$
declare n int; v_team uuid;
begin
  -- Control del propio caso: los dos eventos tienen que ser de equipos DISTINTOS, o esto
  -- estaria repitiendo T2 y saldria verde por el motivo contrario.
  select team_id into v_team from public.events where id = 'd1ee0000-0000-4000-8000-000000000003';
  if v_team <> 'd1000000-0000-4000-8000-000000000702' then
    raise exception 'FAIL[T3]: el evento del derbi debia ser de E2 y es de % — el caso no mide nada', v_team;
  end if;

  update public.events set ffcv_match_code = '26539172'
   where id = 'd1ee0000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T3]: un partido entre dos equipos del club debia dar DOS eventos; el unico no puede ser solo (ffcv_match_code) (filas=%)', n;
  end if;
end $$;

-- ══════════ T4 · el único es PARCIAL: los eventos ajenos a la FFCV conviven ══════════
do $$
declare n int;
begin
  select count(*) into n from public.events
   where id in ('d1ee0000-0000-4000-8000-000000000002','d1ee0000-0000-4000-8000-000000000004',
                'd1ee0000-0000-4000-8000-000000000005','d1ee0000-0000-4000-8000-000000000006',
                'd1ee0000-0000-4000-8000-000000000007')
     and ffcv_match_code is null;
  if n <> 5 then raise exception 'FAIL[T4]: los eventos sin acta debian convivir (sin acta=%)', n; end if;
end $$;

-- ══════════ T5 · el CHECK de team_id, que hace hermético al único ══════════
do $$
declare salto boolean := false; v_team uuid;
begin
  select team_id into v_team from public.events where id = 'd1ee0000-0000-4000-8000-000000000006';
  if v_team is not null then
    raise exception 'FAIL[T5]: el evento de club debia tener team_id NULL — el caso no mide nada';
  end if;

  begin
    update public.events set ffcv_match_code = '26539999'
     where id = 'd1ee0000-0000-4000-8000-000000000006';
  exception when check_violation then salto := true;
  end;
  if not salto then
    raise exception 'FAIL[T5]: un acta en un evento sin equipo abriria el hueco: dos NULL esquivarian el unico';
  end if;
end $$;

-- ══════════ T6 · el CHECK de formato ══════════
do $$
declare n int; salto boolean := false;
begin
  begin
    update public.events set ffcv_match_code = 'Jornada 1'
     where id = 'd1ee0000-0000-4000-8000-000000000002';
  exception when check_violation then salto := true;
  end;
  if not salto then raise exception 'FAIL[T6]: un texto no debia caber en ffcv_match_code'; end if;

  update public.events set ffcv_match_code = '26539186'
   where id = 'd1ee0000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL[T6]: un acta de verdad debia entrar (filas=%)', n; end if;
end $$;

-- ══════════ T7 · ffcv_round: exige acta, y positiva ══════════
do $$
declare n int; salto boolean;
begin
  salto := false;
  begin
    update public.events set ffcv_round = 4
     where id = 'd1ee0000-0000-4000-8000-000000000005';   -- sin acta
  exception when check_violation then salto := true;
  end;
  if not salto then raise exception 'FAIL[T7]: una jornada sin acta no debia permitirse'; end if;

  salto := false;
  begin
    update public.events set ffcv_match_code = '26539194', ffcv_round = 0
     where id = 'd1ee0000-0000-4000-8000-000000000005';
  exception when check_violation then salto := true;
  end;
  if not salto then raise exception 'FAIL[T7]: la jornada 0 no debia permitirse'; end if;

  update public.events set ffcv_match_code = '26539194', ffcv_round = 4
   where id = 'd1ee0000-0000-4000-8000-000000000005';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL[T7]: acta + jornada debian entrar juntas (filas=%)', n; end if;

  -- La dependencia es de UN sentido: acta SIN jornada se permite (copa sin numerar).
  select count(*) into n from public.events
   where id = 'd1ee0000-0000-4000-8000-000000000002' and ffcv_match_code is not null and ffcv_round is null;
  if n <> 1 then raise exception 'FAIL[T7]: un acta sin jornada debia seguir siendo valida (filas=%)', n; end if;
end $$;

-- ══════════ T8 · permisos sobre la puerta viva (O2) ══════════
do $$
declare n int; v_team uuid;
begin
  -- (a) el admin del club escribe el evento de E1
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"d1aa0000-0000-4000-8000-000000000001","role":"authenticated"}', true);
  update public.events set ffcv_match_code = '26539201', ffcv_round = 5
   where id = 'd1ee0000-0000-4000-8000-000000000007';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T8a]: el admin_club debia poder escribir el acta; si da 0, el grant de events es POR COLUMNA y no alcanza a las nuevas (filas=%)', n;
  end if;

  -- (b) el ayudante, staff ACTIVO de E1, tambien: es la decision de O2
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"d1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.events set ffcv_round = 9
   where id = 'd1ee0000-0000-4000-8000-000000000007';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 1 then
    raise exception 'FAIL[T8b]: todo staff ACTIVO del equipo gestiona el calendario de serie desde O2 (20261042000000); si da 0, alguien ha vuelto a exigir el principal (filas=%)', n;
  end if;

  -- (c) pero NO el evento de E2, donde no es staff. Control del propio caso: que el
  -- evento sea de OTRO equipo, o esto repetiria (b).
  select team_id into v_team from public.events where id = 'd1ee0000-0000-4000-8000-000000000003';
  if v_team <> 'd1000000-0000-4000-8000-000000000702' then
    raise exception 'FAIL[T8c]: el evento objetivo debia ser de E2 y es de % — el caso no mide nada', v_team;
  end if;

  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"d1aa0000-0000-4000-8000-000000000002","role":"authenticated"}', true);
  update public.events set ffcv_round = 9
   where id = 'd1ee0000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  perform set_config('role', 'postgres', true);
  if n <> 0 then
    raise exception 'FAIL[T8c]: el staff de E1 no debia poder escribir un evento de E2 (filas=%)', n;
  end if;
end $$;

rollback;
