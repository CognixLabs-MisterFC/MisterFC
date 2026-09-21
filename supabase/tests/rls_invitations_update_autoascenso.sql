-- El INVITADO no puede reescribir su propia invitación (mig 20261089000000).
--
-- Antes de esa migración, `invitations_update_invited_or_admin` autorizaba el UPDATE
-- al propio invitado (`email ilike current_user_email()`) y su WITH CHECK no traía la
-- regla de rol alto que sí tiene el INSERT. Con una sesión y nada más, el invitado
-- podía ascenderse, apuntarse a otro menor y estirarse la caducidad. Los tres se
-- reprodujeron a mano contra producción dentro de BEGIN…ROLLBACK antes de escribir
-- la migración; esta suite es la red para que no vuelvan.
--
-- Cubre:
--   [1] El invitado NO se asciende el rol (bajo → director).
--   [2] El invitado NO se cambia a OTRO menor del club. El peor de los tres: el
--       vínculo familiar sale de `invitations.player_id` al aceptar. Lo prueba OTRO
--       invitado, con una invitación de tutor: ver la nota del fixture.
--   [3] El invitado NO se estira la caducidad.
--   [4] CONTROL de que la puerta de delante sigue cerrada: el invitado tampoco
--       puede CREAR una invitación, ni de rol alto ni de rol bajo (42501). Esto ya
--       era así; está aquí para que el test diga la verdad sobre el conjunto.
--   [5] El ADMIN del club sigue renovando (token nuevo + caducidad).
--   [6] El DIRECTOR sigue renovando. Es lo que arregló la mig 20261036000000 y lo
--       que esta no puede romper.
--   [7] El CASE de rol alto, copiado del INSERT: el director NO puede dejar una
--       invitación en rol alto (42501); el OWNER sí.
--
-- Nota sobre las formas de fallar, que son dos y NO son lo mismo:
--   · si la fila no pasa el USING, el UPDATE afecta 0 filas y NO da error → los
--     casos [1][2][3] se comprueban contando filas, no capturando excepciones;
--   · si la fila pasa el USING pero el resultado no pasa el WITH CHECK, salta 42501
--     → el caso [7] sí captura.
-- Un test que solo capturara excepciones daría verde sin comprobar nada.
--
-- Estilo: aserciones con raise exception. Transaccional (rollback al final).
\pset pager off
\set ON_ERROR_STOP on
\ir helpers/auth_users.sql

begin;

-- ── Fixture ──────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('a5c00000-0000-4000-8000-000000000001', 'owner@asc.test');
select pg_temp.new_test_user('a5c00000-0000-4000-8000-000000000002', 'director@asc.test');
select pg_temp.new_test_user('a5c00000-0000-4000-8000-000000000003', 'invitado@asc.test');
select pg_temp.new_test_user('a5c00000-0000-4000-8000-000000000004', 'tutor@asc.test');

insert into public.clubs (id, name, slug, owner_profile_id) values
  ('a5c10000-0000-4000-8000-000000000001', 'Club Ascenso', 'club-ascenso',
   'a5c00000-0000-4000-8000-000000000001');

insert into public.memberships (profile_id, club_id, role) values
  ('a5c00000-0000-4000-8000-000000000001', 'a5c10000-0000-4000-8000-000000000001', 'admin_club'),
  ('a5c00000-0000-4000-8000-000000000002', 'a5c10000-0000-4000-8000-000000000001', 'director');

-- Dos menores del club: el suyo y el de otra familia.
insert into public.players (id, club_id, first_name, last_name, date_of_birth) values
  ('a5c20000-0000-4000-8000-000000000001', 'a5c10000-0000-4000-8000-000000000001', 'Hijo', 'Propio', '2014-03-01'),
  ('a5c20000-0000-4000-8000-000000000002', 'a5c10000-0000-4000-8000-000000000001', 'Hijo', 'Ajeno', '2014-04-01');

-- Dos invitaciones pendientes, y son de DOS TIPOS distintos a propósito, porque el
-- CHECK `invitations_player_role_consistency` obliga:
--
--   · una de CLUB (sin jugador) para el que prueba el ascenso de rol: cambiarle el
--     rol a una invitación CON `player_id` choca con ese CHECK antes de llegar a la
--     policy (rama «rol ni jugador ni seguidor → player_id null»), así que probarlo
--     ahí daría verde por el motivo equivocado. Se descubrió ensayando este test
--     contra producción SIN la migración: saltó el 23514, no el fallo esperado.
--   · y una de TUTOR (con jugador) para el que prueba el cambio de menor, que es
--     justo donde vive el `player_id`.
insert into public.invitations (id, email, club_id, role, created_by, expires_at)
values ('a5c30000-0000-4000-8000-000000000001', 'invitado@asc.test',
        'a5c10000-0000-4000-8000-000000000001', 'entrenador_ayudante',
        'a5c00000-0000-4000-8000-000000000001', now() + interval '7 days');

insert into public.invitations (id, email, club_id, role, player_id, player_relation, created_by, expires_at)
values ('a5c30000-0000-4000-8000-000000000003', 'tutor@asc.test',
        'a5c10000-0000-4000-8000-000000000001', 'jugador',
        'a5c20000-0000-4000-8000-000000000001', 'parent',
        'a5c00000-0000-4000-8000-000000000001', now() + interval '7 days');

-- Y una de club, sin jugador, para los controles de renovación y de rol alto.
insert into public.invitations (id, email, club_id, role, created_by, expires_at)
values ('a5c30000-0000-4000-8000-000000000002', 'staff@asc.test',
        'a5c10000-0000-4000-8000-000000000001', 'entrenador_ayudante',
        'a5c00000-0000-4000-8000-000000000001', now() + interval '7 days');

-- ═════════════════════════════════════════════════════════════════════════════
-- EL INVITADO
-- ═════════════════════════════════════════════════════════════════════════════
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a5c00000-0000-4000-8000-000000000003","role":"authenticated"}';

-- [1] No se asciende el rol.
do $$
declare n int;
begin
  update public.invitations set role = 'director'
   where id = 'a5c30000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL [1]: el invitado ascendio su propia invitacion (% filas)', n;
  end if;
end $$;

-- [2] El TUTOR invitado no se cambia a otro menor. Su sesión, su fila.
set local "request.jwt.claims" = '{"sub":"a5c00000-0000-4000-8000-000000000004","role":"authenticated"}';
do $$
declare n int;
begin
  update public.invitations set player_id = 'a5c20000-0000-4000-8000-000000000002'
   where id = 'a5c30000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL [2]: el invitado se apunto al menor de otra familia (% filas)', n;
  end if;
end $$;

set local "request.jwt.claims" = '{"sub":"a5c00000-0000-4000-8000-000000000003","role":"authenticated"}';

-- [3] No se estira la caducidad.
do $$
declare n int;
begin
  update public.invitations set expires_at = now() + interval '3650 days'
   where id = 'a5c30000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'FAIL [3]: el invitado alargo su propia caducidad (% filas)', n;
  end if;
end $$;

-- [4] CONTROL — tampoco puede crearlas (esto ya era asi; si cayera, el agujero
--     seria mayor que el que cierra esta migracion).
do $$
begin
  insert into public.invitations (email, club_id, role, created_by)
  values ('invitado@asc.test', 'a5c10000-0000-4000-8000-000000000001', 'director',
          'a5c00000-0000-4000-8000-000000000003');
  raise exception 'FAIL [4a]: el invitado creo una invitacion de rol ALTO';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  insert into public.invitations (email, club_id, role, created_by)
  values ('invitado@asc.test', 'a5c10000-0000-4000-8000-000000000001', 'coordinador',
          'a5c00000-0000-4000-8000-000000000003');
  raise exception 'FAIL [4b]: el invitado creo una invitacion de rol bajo';
exception when insufficient_privilege then null;
end $$;

-- ANCLA POSITIVA — que los ceros de arriba no vengan de que la fila no existe o de
-- que este test mire donde no hay nada. Como postgres, la fila sigue EXACTA.
reset role;
do $$
declare v record;
begin
  select role, expires_at into v
    from public.invitations where id = 'a5c30000-0000-4000-8000-000000000001';
  if not found then
    raise exception 'FAIL [ancla]: la invitacion de club del fixture no existe; [1][3] no probaron nada';
  end if;
  if v.role <> 'entrenador_ayudante' or v.expires_at > now() + interval '8 days' then
    raise exception 'FAIL [ancla]: la invitacion de club cambio pese a los 0 filas (rol=%, caduca=%)',
      v.role, v.expires_at;
  end if;

  select player_id into v
    from public.invitations where id = 'a5c30000-0000-4000-8000-000000000003';
  if not found then
    raise exception 'FAIL [ancla]: la invitacion de tutor del fixture no existe; [2] no probo nada';
  end if;
  if v.player_id <> 'a5c20000-0000-4000-8000-000000000001' then
    raise exception 'FAIL [ancla]: el menor de la invitacion cambio pese a los 0 filas (player=%)', v.player_id;
  end if;
end $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- LOS GESTORES — lo que esta migracion NO puede romper
-- ═════════════════════════════════════════════════════════════════════════════

-- [5] El admin del club renueva.
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"a5c00000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  update public.invitations
     set token = gen_random_uuid(), expires_at = now() + interval '7 days'
   where id = 'a5c30000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL [5]: el admin_club ya no puede renovar (% filas)', n;
  end if;
end $$;

-- [6] El director tambien (mig 20261036000000).
set local "request.jwt.claims" = '{"sub":"a5c00000-0000-4000-8000-000000000002","role":"authenticated"}';
do $$
declare n int;
begin
  update public.invitations
     set token = gen_random_uuid(), expires_at = now() + interval '7 days'
   where id = 'a5c30000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL [6]: el director ya no puede renovar (% filas)', n;
  end if;
end $$;

-- [7] Pero el director NO la deja en rol ALTO: pasa el USING y choca con el
--     WITH CHECK → 42501, que es OTRA forma de fallar distinta de las de arriba.
do $$
begin
  update public.invitations set role = 'director'
   where id = 'a5c30000-0000-4000-8000-000000000002';
  raise exception 'FAIL [7]: un director ascendio una invitacion a rol ALTO';
exception when insufficient_privilege then null;
end $$;

-- [7b] Y el OWNER si: es suya esa decision (mismo CASE que el INSERT).
set local "request.jwt.claims" = '{"sub":"a5c00000-0000-4000-8000-000000000001","role":"authenticated"}';
do $$
declare n int;
begin
  update public.invitations set role = 'director'
   where id = 'a5c30000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL [7b]: el owner no pudo invitar a rol alto por renovacion (% filas)', n;
  end if;
end $$;

reset role;
rollback;
