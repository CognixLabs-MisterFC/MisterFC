-- EL ACTA ES DEL SUPERADMIN (migración 20261122000000).
--
-- Convención del repo: BEGIN/ROLLBACK; asserts con DO + raise exception; el actor
-- se fija con `set local role authenticated` + `request.jwt.claims`.
--
-- QUÉ SE MIDE, Y POR QUÉ ASÍ
-- El trigger protege UNA columna: `events.ffcv_match_code`, el vínculo con la
-- federación. El riesgo de un test de permisos es atribuir mal el «no»: un 0
-- filas de la RLS, un CHECK que salta antes, o un actor que de todas formas no
-- podía escribir, se leen igual que «el trigger funcionó».
--
-- Por eso cada negativa va acompañada de su CONTROL POSITIVO —el mismo actor,
-- la misma fila, escribiendo OTRA columna con éxito— y se captura el SQLSTATE
-- EXACTO (42501, insufficient_privilege). Un 23514 de un CHECK ya no se
-- confunde con un acierto.
--
-- Los dos actores no son decorativos:
--   · el DIRECTOR es quien acaba de perder la importación.
--   · el ENTRENADOR es quien corrige a mano las HORAS PROVISIONALES que publica
--     la FFCV (la importación deja partidos a las 9:00 de relleno). Que su
--     trabajo siga intacto es la razón por la que el alcance es estrecho y no
--     ancho, así que va medido y no supuesto.
--
-- Casos:
--   T1.  sin sesión (superuser) se pone el acta → OK. Es la exención
--        `auth.uid() is null`, y es lo que mantiene verde la suite que ya había.
--   T2.  CONTROL POSITIVO · el ENTRENADOR corrige la HORA de un partido CON
--        acta → 1 fila. Puede escribir esa fila.
--   T3.  ese mismo entrenador cambia el ACTA → 42501. Atribuible al trigger,
--        porque T2 acaba de demostrar que la RLS le deja escribir.
--   T4.  CONTROL POSITIVO · el DIRECTOR corrige la hora → 1 fila.
--   T5.  el director PONE un acta donde no había → 42501.
--   T6.  el director QUITA el acta (desvincular) → 42501. La fila elegida no
--        tiene `ffcv_round`, así que el CHECK «round exige acta» no puede
--        adelantarse y robarle el mérito al trigger.
--   T7.  el director INSERTA un evento nuevo ya con acta → 42501.
--   T8.  el director INSERTA un evento normal sin acta → 1 fila. El trabajo de
--        siempre no se toca.
--   T9.  el SUPERADMIN pone el acta → OK. La puerta se abre a quien debe.
--   T10. la forma EXACTA del repaso (starts_at, title, location_*, opponent_name
--        y ffcv_round, sin mencionar el acta) por el entrenador → 1 fila. Esto
--        es el alcance estrecho escrito como aserto.
--   T11. un UPDATE que menciona el acta con el MISMO valor → OK: no vincula ni
--        desvincula nada.

\ir helpers/auth_users.sql

begin;

-- ── Usuarios ──────────────────────────────────────────────────────────────────
select pg_temp.new_test_user('ac7a0000-0000-4000-8000-000000000001', 'acta-director@test.local',  '{"full_name":"Directora"}'::jsonb);
select pg_temp.new_test_user('ac7a0000-0000-4000-8000-000000000002', 'acta-entrena@test.local',   '{"full_name":"Entrenador"}'::jsonb);
select pg_temp.new_test_user('ac7a0000-0000-4000-8000-000000000003', 'acta-super@test.local',     '{"full_name":"Superadmin"}'::jsonb);

insert into public.clubs (id, name, slug) values
  ('ac700000-0000-4000-8000-0000000000c1', 'Club Acta', 'club-acta');
insert into public.categories (id, club_id, name) values
  ('ac700000-0000-4000-8000-000000000ca1', 'ac700000-0000-4000-8000-0000000000c1', 'Cat Acta');
insert into public.teams (id, category_id, club_id, name, format, color, season) values
  ('ac700000-0000-4000-8000-000000000701', 'ac700000-0000-4000-8000-000000000ca1',
   'ac700000-0000-4000-8000-0000000000c1', 'Infantil A', 'F11', '#10B981', '2026-27');

insert into public.memberships (id, profile_id, club_id, role) values
  ('ac7dd000-0000-4000-8000-000000000001','ac7a0000-0000-4000-8000-000000000001','ac700000-0000-4000-8000-0000000000c1','director'),
  ('ac7dd000-0000-4000-8000-000000000002','ac7a0000-0000-4000-8000-000000000002','ac700000-0000-4000-8000-0000000000c1','entrenador_principal'),
  ('ac7dd000-0000-4000-8000-000000000003','ac7a0000-0000-4000-8000-000000000003','ac700000-0000-4000-8000-0000000000c1','director');

-- El entrenador es staff ACTIVO del equipo: por ahí le entra `user_can_manage_event`.
insert into public.team_staff (id, team_id, membership_id, staff_role, joined_at) values
  ('ac7cc000-0000-4000-8000-000000000001','ac700000-0000-4000-8000-000000000701',
   'ac7dd000-0000-4000-8000-000000000002','entrenador_principal', date '2026-07-01');

-- El superadmin de verdad: una fila en platform_admins.
insert into public.platform_admins (profile_id) values ('ac7a0000-0000-4000-8000-000000000003');

insert into public.events (id, club_id, team_id, type, title, starts_at, created_by) values
  -- E1: el partido importado. Recibe acta en T1, sin ffcv_round (lo necesita T6).
  ('ac7ee000-0000-4000-8000-000000000001','ac700000-0000-4000-8000-0000000000c1','ac700000-0000-4000-8000-000000000701','match','J1 con hora de relleno','2026-10-18T07:00:00Z','ac7a0000-0000-4000-8000-000000000001'),
  -- E2: sin acta. Lo usan T5 y T9.
  ('ac7ee000-0000-4000-8000-000000000002','ac700000-0000-4000-8000-0000000000c1','ac700000-0000-4000-8000-000000000701','match','sin vincular','2026-10-25T14:00:00Z','ac7a0000-0000-4000-8000-000000000001'),
  -- E3: para el repaso de T10 y el no-op de T11.
  ('ac7ee000-0000-4000-8000-000000000003','ac700000-0000-4000-8000-0000000000c1','ac700000-0000-4000-8000-000000000701','match','para el repaso','2026-11-01T09:00:00Z','ac7a0000-0000-4000-8000-000000000001');

-- ══════════ T1 · sin sesión se pone el acta (la exención) ══════════
do $$
declare n int;
begin
  if auth.uid() is not null then
    raise exception 'FAIL[T1]: este bloque debía correr SIN sesión (uid=%)', auth.uid();
  end if;

  update public.events set ffcv_match_code = '26539172'
   where id = 'ac7ee000-0000-4000-8000-000000000001';
  update public.events set ffcv_match_code = '26539180'
   where id = 'ac7ee000-0000-4000-8000-000000000003';

  select count(*) into n from public.events
   where id in ('ac7ee000-0000-4000-8000-000000000001','ac7ee000-0000-4000-8000-000000000003')
     and ffcv_match_code is not null;
  if n <> 2 then
    raise exception 'FAIL[T1]: sin sesión el trigger no debía morder (con acta=%, esperaba 2)', n;
  end if;
  raise notice 'T1 ok: 2 actas puestas sin sesión';
end $$;

-- ══════════ T2 · CONTROL POSITIVO: el entrenador corrige la hora ══════════
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"ac7a0000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare n int;
begin
  update public.events set starts_at = '2026-10-18T11:30:00Z'
   where id = 'ac7ee000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T2]: el entrenador debía poder corregir la hora provisional (filas=%). Sin esto, el 42501 de T3 no sería atribuible al trigger', n;
  end if;
  raise notice 'T2 ok: el entrenador corrige la hora (1 fila)';
end $$;

-- ══════════ T3 · ese mismo entrenador NO cambia el acta ══════════
do $$
declare capturado text;
begin
  begin
    update public.events set ffcv_match_code = '99999999'
     where id = 'ac7ee000-0000-4000-8000-000000000001';
    raise exception 'FAIL[T3]: el entrenador ha cambiado el acta y no debía';
  exception when insufficient_privilege then
    capturado := '42501';
  end;
  if capturado is distinct from '42501' then
    raise exception 'FAIL[T3]: esperaba 42501 y no llegó';
  end if;
  raise notice 'T3 ok: 42501 al cambiar el acta';
end $$;

-- ══════════ T4 · CONTROL POSITIVO: el director corrige la hora ══════════
set local "request.jwt.claims" = '{"sub":"ac7a0000-0000-4000-8000-000000000001","role":"authenticated"}';

do $$
declare n int;
begin
  update public.events set starts_at = '2026-10-18T12:00:00Z'
   where id = 'ac7ee000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T4]: el director debía poder escribir esa fila (filas=%)', n;
  end if;
  raise notice 'T4 ok: el director escribe la fila (1)';
end $$;

-- ══════════ T5 · el director NO pone un acta nueva ══════════
do $$ begin
  begin
    update public.events set ffcv_match_code = '26539188'
     where id = 'ac7ee000-0000-4000-8000-000000000002';
    raise exception 'FAIL[T5]: el director ha vinculado un partido a la FFCV y no debía';
  exception when insufficient_privilege then null; end;
  raise notice 'T5 ok: 42501 al poner un acta';
end $$;

-- ══════════ T6 · el director NO quita el acta (desvincular) ══════════
do $$
declare v_round int;
begin
  -- Que el CHECK «round exige acta» no pueda adelantarse: la fila no tiene round.
  select ffcv_round into v_round from public.events
   where id = 'ac7ee000-0000-4000-8000-000000000001';
  if v_round is not null then
    raise exception 'FAIL[T6]: la fila tiene ffcv_round=%, el 42501 no sería atribuible al trigger', v_round;
  end if;
  begin
    update public.events set ffcv_match_code = null
     where id = 'ac7ee000-0000-4000-8000-000000000001';
    raise exception 'FAIL[T6]: el director ha DESVINCULADO un partido y no debía';
  exception when insufficient_privilege then null; end;
  raise notice 'T6 ok: 42501 al quitar el acta';
end $$;

-- ══════════ T7 · el director NO inserta un evento ya con acta ══════════
do $$ begin
  begin
    insert into public.events (id, club_id, team_id, type, title, starts_at, created_by, ffcv_match_code)
    values ('ac7ee000-0000-4000-8000-00000000000a','ac700000-0000-4000-8000-0000000000c1',
            'ac700000-0000-4000-8000-000000000701','match','colado con acta','2026-12-01T10:00:00Z',
            'ac7a0000-0000-4000-8000-000000000001','26539200');
    raise exception 'FAIL[T7]: ha entrado un evento con acta puesta por el director';
  exception when insufficient_privilege then null; end;
  raise notice 'T7 ok: 42501 al insertar con acta';
end $$;

-- ══════════ T8 · y SÍ inserta un evento normal (el trabajo de siempre) ══════════
do $$
declare n int;
begin
  insert into public.events (id, club_id, team_id, type, title, starts_at, created_by)
  values ('ac7ee000-0000-4000-8000-00000000000b','ac700000-0000-4000-8000-0000000000c1',
          'ac700000-0000-4000-8000-000000000701','match','amistoso a mano','2026-12-02T10:00:00Z',
          'ac7a0000-0000-4000-8000-000000000001');
  select count(*) into n from public.events where id = 'ac7ee000-0000-4000-8000-00000000000b';
  if n <> 1 then
    raise exception 'FAIL[T8]: un evento SIN acta debe entrar como siempre (filas=%)', n;
  end if;
  raise notice 'T8 ok: evento normal sin acta, 1 fila';
end $$;

-- ══════════ T9 · el superadmin SÍ pone el acta ══════════
set local "request.jwt.claims" = '{"sub":"ac7a0000-0000-4000-8000-000000000003","role":"authenticated"}';

do $$
declare n int; v_super boolean;
begin
  select public.is_superadmin() into v_super;
  if v_super is not true then
    raise exception 'FAIL[T9]: el actor no es superadmin; el resto del caso no mide nada';
  end if;
  update public.events set ffcv_match_code = '26539188'
   where id = 'ac7ee000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T9]: el superadmin debía poder vincular (filas=%)', n;
  end if;
  raise notice 'T9 ok: el superadmin vincula (1 fila)';
end $$;

-- ══════════ T10 · el REPASO, con su forma exacta, por el ENTRENADOR ══════════
set local "request.jwt.claims" = '{"sub":"ac7a0000-0000-4000-8000-000000000002","role":"authenticated"}';

do $$
declare n int;
begin
  -- Estas seis columnas son exactamente las del parche del repaso
  -- (packages/core/src/ffcv/importar.ts, COLUMNAS_DE_LA_FFCV). El acta NO está,
  -- y por eso `update of ffcv_match_code` no dispara.
  update public.events
     set starts_at = '2026-11-01T12:00:00Z',
         title = 'Jornada 1 · rival',
         location_name = 'Campo Municipal',
         location_address = 'Calle de en medio, 1',
         opponent_name = 'CF Rival',
         ffcv_round = 1
   where id = 'ac7ee000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T10]: el repaso sin tocar el acta debía pasar (filas=%). Si cae aquí, el alcance se ha vuelto ANCHO y los entrenadores no pueden corregir las horas provisionales', n;
  end if;
  raise notice 'T10 ok: el repaso pasa sin tocar el acta (1 fila)';
end $$;

-- ══════════ T11 · mencionar el acta con el MISMO valor no es vincular ══════════
do $$
declare n int;
begin
  update public.events set ffcv_match_code = '26539180'   -- el que ya tenía (T1)
   where id = 'ac7ee000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  if n <> 1 then
    raise exception 'FAIL[T11]: un no-op sobre el acta no vincula ni desvincula; debía pasar (filas=%)', n;
  end if;
  raise notice 'T11 ok: no-op sobre el acta, 1 fila';
end $$;

reset role;
rollback;
