-- ════════════════════════════════════════════════════════════════════════════
-- Club de capturas de la web comercial (spec docs/spec-web-comercial.md §9.3)
-- DEFINITIVO: aplica los cambios y hace COMMIT. Ejecutar SOLO después de que el
-- ensayo (`capturas-club-test.ensayo.sql`) haya terminado en «ENSAYO CORRECTO».
-- Al final enseña una tabla de verificación leída de la base ya cambiada.
--
-- Es el MISMO bloque que el ensayo, con v_ensayo = false. Un test
-- (packages/core/src/marketing-site/__tests__/capturas-club-test.test.ts)
-- comprueba que solo cambian esas líneas.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_ensayo constant boolean := false;

  -- El club y lo que NO se toca nunca.
  c_club constant uuid := 'f91b42e5-cfce-4625-9ca4-9a0764ca9f72';
  c_infantil_b constant uuid := 'af3e38c0-857b-481b-a4e3-0fe6250c35f1';
  c_alevin_a constant uuid := 'cd752f11-0023-4bc1-9d8e-5540f46433b9';
  c_alevin_b constant uuid := '03c86c3a-ef6a-42fa-ba95-f6aec282ee0e';
  c_carlos_vicente constant uuid := 'd7c2714c-7049-4ed0-baae-90eab50adf42';

  v_director uuid;
  v_coach uuid;
  v_fam_francisco uuid;
  v_fam_marta uuid;
  v_fam_lucia uuid;
  v_fam_carmen uuid;
  v_apple uuid;
  v_season uuid;
  v_ev_m2 uuid;
  v_ev_m1 uuid;
  v_ev_live uuid;
  v_conv uuid;
  v_ex_rondo uuid;
  v_ex_c21 uuid;
  v_ex_c32 uuid;
  v_ex_flex uuid;
  v_ses uuid;
  v_blk uuid;
  v_n int;
  v_txt text;
  r record;
begin
  create temp table _resumen (orden serial, paso text, filas int) on commit drop;

  -- ── 0 · Comprobaciones previas ─────────────────────────────────────────────
  if (select id from public.clubs where slug = 'club-beta-test') is distinct from c_club then
    raise exception 'El slug club-beta-test no es el club %. No se toca nada.', c_club;
  end if;
  if (select name from public.clubs where id = c_club) = 'CF Playas El Saler' then
    raise exception 'El club ya se llama CF Playas El Saler: este script ya se aplicó.';
  end if;

  select id into v_director from auth.users where email = 'jovimib+director@gmail.com';
  select id into v_coach from auth.users where email = 'jovimib+coach7@gmail.com';
  select id into v_fam_francisco from auth.users where email = 'jovimib+jugador8@gmail.com';
  select id into v_fam_marta from auth.users where email = 'jovimib+30@gmail.com';
  select id into v_fam_lucia from auth.users where email = 'jovimib+test8@gmail.com';
  select id into v_fam_carmen from auth.users where email = 'jovimib+familia1@gmail.com';
  select id into v_apple from auth.users where email = 'jovimib+apple@gmail.com';
  if v_director is null or v_coach is null or v_fam_francisco is null or v_fam_marta is null
     or v_fam_lucia is null or v_fam_carmen is null or v_apple is null then
    raise exception 'Falta alguna de las cuentas de prueba esperadas.';
  end if;
  -- Ninguna de las cuentas que se renombran es la de Apple, la personal o la de Sergio.
  if exists (select 1 from auth.users u
              where u.id in (v_director, v_coach, v_fam_francisco, v_fam_marta, v_fam_lucia, v_fam_carmen)
                and u.email in ('jovimib+apple@gmail.com', 'jovimib@gmail.com', 'sergio@spanishprofootball.com')) then
    raise exception 'Una cuenta a renombrar es una de las que no se tocan.';
  end if;

  select id into v_season from public.seasons where club_id = c_club and status::text = 'active';
  if v_season is null then raise exception 'El club no tiene temporada activa.'; end if;

  -- ── 1 · Club: nombre y color (sigue visible en el directorio) ─────────────
  update public.clubs set name = 'CF Playas El Saler', primary_color = '#0E7490' where id = c_club;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Paso 1: % filas', v_n; end if;
  insert into _resumen (paso, filas) values ('1 · club renombrado y con color', v_n);

  -- ── 2 · Equipos activos: «Alevín» con tilde ────────────────────────────────
  update public.teams set name = replace(name, 'Alevin', 'Alevín')
   where club_id = c_club and id in (c_alevin_a, c_alevin_b) and name like 'Alevin %';
  get diagnostics v_n = row_count;
  if v_n <> 2 then raise exception 'Paso 2: % filas', v_n; end if;
  insert into _resumen (paso, filas) values ('2 · equipos con tilde', v_n);

  -- ── 3 · Jugadores de Infantil B: nombre y dos apellidos, dorsal único ──────
  --       Carlos Vicente (familia de la cuenta de Apple) NO se toca.
  update public.players p
     set first_name = v.nombre, last_name = v.apellidos, dorsal = v.dorsal,
         position_main = v.posicion,
         photo_url = case when v.quitar_foto then null else p.photo_url end
    from (values
      ('ad04d1cd-3e4d-4312-a389-693cb8841570'::uuid, 'Noah',      'Sanchis Roig',     1, 'goalkeeper', false),
      ('9e4a484c-4351-424d-8312-c82f42790a6e'::uuid, 'Marcos',    'Belda Ortiz',      2, 'defender',   true),
      ('ffac036b-582a-4afc-8761-af788dcf3f6e'::uuid, 'Mario',     'Pons Esteve',      3, 'defender',   false),
      ('c2dd4571-c9e4-49ed-867d-b6c99e64c722'::uuid, 'Pablo',     'Vidal Ramos',      4, 'defender',   false),
      ('5c2c5742-794f-40de-9edb-db93aa55c02b'::uuid, 'Juan',      'Ferrer Gil',       5, 'defender',   false),
      ('058a2256-73b5-48b2-9415-12c2dedd7ffb'::uuid, 'Pablo',     'Gómez Rubio',      6, 'defender',   false),
      ('67941878-5fab-4f17-9e5c-1d628636c4d3'::uuid, 'África',    'Navarro Pla',      7, 'midfielder', false),
      ('7c255461-6721-4b2a-8ac6-0d966e2d8890'::uuid, 'Agustín',   'Soria Peris',      8, 'midfielder', false),
      ('6bc24d6a-9a05-4528-8019-a52413fa5f03'::uuid, 'Joaquín',   'Ibáñez Martí',     9, 'forward',    false),
      ('bb2c74cf-3000-4547-8b3d-478aa95e3ae4'::uuid, 'Fran',      'Moll Sales',      11, 'midfielder', false),
      ('d290df5f-1717-4f65-9627-2e5cd4ee25f5'::uuid, 'Javi',      'Torres Caballero',12, 'midfielder', false),
      ('cfb1cd36-a56d-42c2-9436-1483912b6e37'::uuid, 'Óscar',     'Llorens Vidal',   13, 'goalkeeper', false),
      ('7c12b9d4-0e86-4bbd-be7a-7ac735a2ec6c'::uuid, 'Darío',     'Climent Ruiz',    14, 'midfielder', false),
      ('c29d5c90-475c-4998-8c74-f758e802f573'::uuid, 'Joan',      'Bosch Ferrando',  15, 'midfielder', false),
      ('8c50e4f4-5ebb-479c-9394-d1d9917713cf'::uuid, 'Leo',       'Martí Cervera',   16, 'midfielder', false),
      ('d5b3e94e-a207-4bac-b870-ce23fa26ca9f'::uuid, 'Manuel',    'Andreu Lozano',   17, 'midfielder', false),
      ('d821146c-560c-4b1a-88c3-9f90daef4516'::uuid, 'Nicolás',   'Escrivà Gil',     18, 'midfielder', false),
      ('5c2c9d32-794f-40de-9edb-db93aa55c02b'::uuid, 'Sebastián', 'Roca Puig',       19, 'midfielder', false),
      ('01079727-bc02-4d78-ac5d-8fc58c741216'::uuid, 'David',     'Mira Tortosa',    20, 'forward',    false),
      ('22551e34-298d-4796-b6c2-cb6bacf000c5'::uuid, 'Alejandro', 'Casany Peiró',    21, 'forward',    false),
      ('4e233904-aed4-4731-8933-fb7c2e0f2a77'::uuid, 'Daniel',    'Fuster Alemany',  22, 'forward',    false),
      ('b37419f4-a915-4ff0-bbf8-726bc6101e56'::uuid, 'Joel',      'Segarra Vila',    23, 'forward',    false),
      ('271743e1-0beb-4d30-9302-a1f18a92db8d'::uuid, 'Santino',   'Ribes Monzó',     24, 'forward',    false),
      ('53ec87f2-3776-4fb2-8070-0664eff68d21'::uuid, 'Mario',     'Domènech Sanz',   25, 'forward',    false),
      ('3fe6c560-2d0c-4f02-9589-0b1c1efa21e6'::uuid, 'David',     'Noguera Lillo',   26, 'forward',    false)
    ) as v(id, nombre, apellidos, dorsal, posicion, quitar_foto)
   where p.id = v.id and p.club_id = c_club and p.id <> c_carlos_vicente;
  get diagnostics v_n = row_count;
  if v_n <> 25 then raise exception 'Paso 3: % filas (esperadas 25)', v_n; end if;
  insert into _resumen (paso, filas) values ('3 · jugadores de Infantil B renombrados (Carlos Vicente intacto)', v_n);

  -- El número que enseña la plantilla del equipo es el mismo que el del jugador.
  update public.team_members tm set dorsal_in_team = p.dorsal
    from public.players p
   where tm.player_id = p.id and tm.team_id = c_infantil_b and tm.left_at is null
     and p.club_id = c_club and p.id <> c_carlos_vicente;
  get diagnostics v_n = row_count;
  if v_n <> 25 then raise exception 'Paso 3b: % filas (esperadas 25)', v_n; end if;
  insert into _resumen (paso, filas) values ('3b · dorsal en la plantilla de Infantil B', v_n);

  -- ── 4 · Nombres de futbolistas reales en los alevines ──────────────────────
  update public.players p
     set first_name = v.nombre, last_name = v.apellidos,
         photo_url = case when v.quitar_foto then null else p.photo_url end
    from (values
      ('8e99dd4a-bd7f-45fa-b575-8051ff0984ea'::uuid, 'Pau',   'Cervera Mas',    false),
      ('09b7b99b-b95e-4434-a3eb-ffc8f4c68b49'::uuid, 'Julio', 'Herrero Sanz',   false),
      ('c5d9a0b5-4f97-418f-88af-f7d343b76f42'::uuid, 'Rubén', 'Brotons Sales',  true)
    ) as v(id, nombre, apellidos, quitar_foto)
   where p.id = v.id and p.club_id = c_club;
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'Paso 4: % filas', v_n; end if;
  insert into _resumen (paso, filas) values ('4 · nombres reales de los alevines sustituidos', v_n);

  -- ── 5 · Cuentas de prueba que salen en las capturas ────────────────────────
  update public.profiles pr set full_name = v.nombre
    from (values
      (v_director,      'Elena Navarro Gil'),
      (v_coach,         'Javier Ortega Lluch'),
      (v_fam_francisco, 'Francisco Ibáñez Soler'),
      (v_fam_marta,     'Marta Ferrer Cano'),
      (v_fam_lucia,     'Lucía Gómez Bosch'),
      (v_fam_carmen,    'Carmen Belda Ortiz')
    ) as v(id, nombre)
   where pr.id = v.id;
  get diagnostics v_n = row_count;
  if v_n <> 6 then raise exception 'Paso 5: % filas', v_n; end if;
  insert into _resumen (paso, filas) values ('5 · cuentas de prueba con nombre ficticio', v_n);

  -- Marta y Lucía, familias de Juan y Pablo (Infantil B): remitentes del chat (M3).
  insert into public.player_accounts (player_id, profile_id, relation) values
    ('5c2c5742-794f-40de-9edb-db93aa55c02b', v_fam_marta, 'parent'),
    ('058a2256-73b5-48b2-9415-12c2dedd7ffb', v_fam_lucia, 'parent')
  on conflict (player_id, profile_id) do nothing;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('5b · vínculos familia nuevos (0 si ya existían)', v_n);

  -- ── 6 · Partidos que ya había: sin «Campo Fonteta», con rival ──────────────
  update public.match_callup_meta m set meeting_location = 'Campo Municipal Las Dunas'
    from public.events e
   where m.event_id = e.id and e.club_id = c_club and m.meeting_location = 'Campo Fonteta';
  get diagnostics v_n = row_count;
  if v_n < 3 then raise exception 'Paso 6: % filas con Campo Fonteta (esperadas al menos 3)', v_n; end if;
  insert into _resumen (paso, filas) values ('6 · citaciones sin Campo Fonteta', v_n);

  update public.events
     set location_name = case when location_name ilike '%fonteta%' then 'Campo Municipal Las Dunas' else location_name end,
         location_address = case when location_address ilike '%fonteta%' then null else location_address end
   where club_id = c_club and (location_name ilike '%fonteta%' or location_address ilike '%fonteta%');
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('6a · eventos con Fonteta en el lugar (0 si no había)', v_n);

  update public.events e
     set title = 'Amistoso', opponent_name = v.rival,
         location_name = 'Campo Municipal Las Dunas'
    from (values
      (c_infantil_b, '2026-08-22 16:00:00+00'::timestamptz, 'Atlètic Marjal'),
      (c_infantil_b, '2026-09-05 16:00:00+00'::timestamptz, 'CF Huerta Vella'),
      (c_alevin_a,   '2026-09-26 16:00:00+00'::timestamptz, 'UD Barraca Vella')
    ) as v(team_id, starts_at, rival)
   where e.club_id = c_club and e.team_id = v.team_id and e.starts_at = v.starts_at
     and e.type::text = 'match';
  get diagnostics v_n = row_count;
  if v_n <> 3 then raise exception 'Paso 6b: % partidos (esperados 3)', v_n; end if;
  insert into _resumen (paso, filas) values ('6b · partidos viejos con rival y lugar', v_n);

  -- El amistoso del 05-09 se quedó en directo: se cierran sus periodos y el partido.
  select e.id into v_ev_live from public.events e
   where e.club_id = c_club and e.team_id = c_infantil_b
     and e.starts_at = '2026-09-05 16:00:00+00' and e.type::text = 'match';
  update public.match_periods
     set running = false, last_started_at = null, ended = true,
         accumulated_seconds = least(accumulated_seconds, 35 * 60)
   where event_id = v_ev_live and (running or not ended);
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('6c · periodos del partido colgado, terminados', v_n);
  update public.match_state
     set status = 'closed', closed_at = '2026-09-05 17:40:00+00',
         goals_for = coalesce(goals_for, 0), goals_against = coalesce(goals_against, 0)
   where event_id = v_ev_live and status = 'live';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Paso 6d: % partidos en directo cerrados (esperado 1)', v_n; end if;
  insert into _resumen (paso, filas) values ('6d · partido del 05-09 cerrado', v_n);

  -- ── 7 · Partidos nuevos de Infantil B ──────────────────────────────────────
  --  M2/C5: jornada 5, ya pasada (el cron no avisa de partidos pasados). El directo
  --         se hace desde la app el día de las capturas.
  --  M1/M6: jornada 7, sábado 24-10. Convocatoria publicada y SIN responder.
  insert into public.events (club_id, team_id, type, title, starts_at, ends_at, created_by,
                             opponent_name, location_name, location_address)
  values (c_club, c_infantil_b, 'match', 'Liga · Jornada 5', '2026-10-10 08:00:00+00',
          '2026-10-10 09:40:00+00', v_coach, 'UD Barraca Vella', 'Campo Municipal Las Dunas',
          'Camí de les Dunes, s/n, Valencia')
  returning id into v_ev_m2;
  insert into public.events (club_id, team_id, type, title, starts_at, ends_at, created_by,
                             opponent_name, location_name, location_address)
  values (c_club, c_infantil_b, 'match', 'Liga · Jornada 7', '2026-10-24 08:00:00+00',
          '2026-10-24 09:40:00+00', v_coach, 'CD Sequiol Nou', 'Camp Municipal del Sequiol',
          'Carrer del Sequiol, 12, Valencia')
  returning id into v_ev_m1;
  insert into _resumen (paso, filas) values ('7 · partidos nuevos (jornadas 5 y 7)', 2);

  -- Publicar la convocatoria exige saber quién publica: el entrenador, solo aquí.
  perform set_config('request.jwt.claim.sub', v_coach::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);
  insert into public.match_callup_meta (event_id, meeting_at, meeting_location, published_at, published_by)
  values (v_ev_m2, '2026-10-10 07:15:00+00', 'Campo Municipal Las Dunas', now(), v_coach),
         (v_ev_m1, '2026-10-24 07:00:00+00', 'Camp Municipal del Sequiol', now(), v_coach);
  get diagnostics v_n = row_count;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  if v_n <> 2 then raise exception 'Paso 7b: % convocatorias', v_n; end if;
  insert into _resumen (paso, filas) values ('7b · convocatorias publicadas', v_n);

  -- ── 8 · Semana de sesiones de Infantil B (C3) ──────────────────────────────
  select id into v_ex_rondo from public.exercises where club_id = c_club and name = 'Rondo 4x1' and status::text = 'published';
  select id into v_ex_c21 from public.exercises where club_id = c_club and name = 'Centro 2 vs 1' and status::text = 'published';
  select id into v_ex_c32 from public.exercises where club_id = c_club and name = 'Centro 3 vs 2' and status::text = 'published';
  select id into v_ex_flex from public.exercises where club_id = c_club and name = 'Flexiones' and status::text = 'published';
  if v_ex_rondo is null or v_ex_c21 is null or v_ex_c32 is null or v_ex_flex is null then
    raise exception 'Paso 8: falta algún ejercicio publicado.';
  end if;

  v_n := 0;
  for r in
    select * from (values
      ('2026-10-20'::date, 'Finalización por bandas',  v_ex_c21),
      ('2026-10-22'::date, 'Centros y remate',         v_ex_c32),
      ('2026-10-23'::date, 'Activación prepartido',    v_ex_c21)
    ) as s(fecha, titulo, principal)
  loop
    insert into public.sessions (club_id, team_id, event_id, owner_profile_id, session_date, title, visibility)
    values (c_club, c_infantil_b,
            (select e.id from public.events e
              where e.club_id = c_club and e.team_id = c_infantil_b and e.type::text = 'training'
                and e.starts_at::date = r.fecha and e.cancelled_at is null limit 1),
            v_coach, r.fecha, r.titulo, 'staff')
    returning id into v_ses;

    insert into public.session_blocks (session_id, order_idx, block_type, title)
    values (v_ses, 0, 'calentamiento', 'Activación') returning id into v_blk;
    insert into public.session_block_exercises (block_id, exercise_id, order_idx, duration_min)
    values (v_blk, v_ex_rondo, 0, 15);

    insert into public.session_blocks (session_id, order_idx, block_type, title)
    values (v_ses, 1, 'principal', 'Parte principal') returning id into v_blk;
    insert into public.session_block_exercises (block_id, exercise_id, order_idx, duration_min)
    values (v_blk, r.principal, 0, 25), (v_blk, v_ex_c32, 1, 20);

    insert into public.session_blocks (session_id, order_idx, block_type, title)
    values (v_ses, 2, 'vuelta_a_la_calma', 'Vuelta a la calma') returning id into v_blk;
    insert into public.session_block_exercises (block_id, exercise_id, order_idx, duration_min)
    values (v_blk, v_ex_flex, 0, 10);
    v_n := v_n + 1;
  end loop;
  insert into _resumen (paso, filas) values ('8 · sesiones nuevas (20, 22 y 23 de octubre)', v_n);

  -- ── 9 · Asistencia de Infantil B en los entrenamientos pasados (M4) ────────
  insert into public.training_attendance (event_id, player_id, code, recorded_by)
  select e.id, tm.player_id,
         (case when abs(hashtext(e.id::text || tm.player_id::text)) % 9 = 0
               then 'ausente_con_aviso' else 'presente' end)::public.attendance_code,
         v_coach
    from public.events e
    join public.team_members tm
      on tm.team_id = e.team_id and tm.left_at is null and tm.joined_at <= e.starts_at::date
   where e.club_id = c_club and e.team_id = c_infantil_b and e.type::text = 'training'
     and e.cancelled_at is null
     and e.starts_at >= '2026-09-01' and e.starts_at < now()
  on conflict (event_id, player_id) do nothing;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('9 · registros de asistencia nuevos', v_n);

  -- ── 10 · Informe de desarrollo de Noah, temporada actual (C7) ──────────────
  insert into public.development_reports (club_id, player_id, season_id, team_id, period, scores,
                                          comment_overall, visibility, created_by)
  values (c_club, 'ad04d1cd-3e4d-4312-a389-693cb8841570', v_season, c_infantil_b, 'inicial',
          '{"control_orientado":7,"pase":8,"conduccion":6,"regate":5,"finalizacion":5,"primer_toque":7,
            "comprension_juego":7,"toma_decisiones":6,"ocupacion_espacios":8,"lectura_tactica":7,"juego_sin_balon":6,
            "coordinacion":7,"agilidad":8,"velocidad":6,"resistencia":7,"explosividad":7,
            "compromiso":9,"motivacion":9,"concentracion":7,"companerismo":8,"liderazgo":6,"evolucion":8}'::jsonb,
          'Buen inicio de temporada. Muy seguro en el blocaje y en el juego con los pies; tiene que ganar velocidad en las salidas.',
          'team', v_coach)
  on conflict (player_id, season_id, period) do nothing;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('10 · informe de Noah (0 si ya había uno)', v_n);

  -- ── 11 · Anuncio del club, fijado arriba ───────────────────────────────────
  insert into public.announcements (club_id, author_profile_id, title, body, pinned)
  values (c_club, v_director, 'Horarios de la temporada 2026-27',
          'Los entrenamientos de Infantil B serán martes, jueves y viernes de 18:00 a 19:30 en el Campo Municipal Las Dunas. Recordad traer agua y la equipación de entreno.',
          true);
  insert into _resumen (paso, filas) values ('11 · anuncio nuevo', 1);

  -- ── 12 · Chat de Infantil B (M3): el entrenador y tres familias ────────────
  --        Cada mensaje exige que quien escribe sea quien envía.
  select id into v_conv from public.team_conversations where team_id = c_infantil_b;
  if v_conv is null then raise exception 'Paso 12: Infantil B no tiene chat de equipo.'; end if;
  v_n := 0;
  for r in
    select * from (values
      (1, v_coach,         'Buenas, familias. El sábado jugamos fuera contra el CD Sequiol Nou. Citación a las 9:00 en su campo.'),
      (2, v_fam_francisco, 'Perfecto, Joaquín estará. ¡Gracias, Javier!'),
      (3, v_fam_marta,     '¿Llevamos la equipación blanca o la azul?'),
      (4, v_coach,         'La azul. Y que traigan agua y la sudadera del club, que a esa hora hace fresco.'),
      (5, v_fam_lucia,     'Pablo tiene médico el jueves; llegará 15 minutos tarde al entrenamiento.'),
      (6, v_coach,         'Sin problema, Lucía. Gracias por avisar.')
    ) as m(orden, remitente, texto)
    order by orden
  loop
    perform set_config('request.jwt.claim.sub', r.remitente::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', r.remitente, 'role', 'authenticated')::text, true);
    insert into public.team_messages (team_conversation_id, sender_profile_id, body, created_at)
    values (v_conv, r.remitente, r.texto, now() - make_interval(mins => (7 - r.orden) * 9));
    v_n := v_n + 1;
  end loop;
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  insert into _resumen (paso, filas) values ('12 · mensajes nuevos en el chat de Infantil B', v_n);

  -- ── Comprobaciones finales ─────────────────────────────────────────────────
  if exists (select 1 from public.players where id = c_carlos_vicente
              and (first_name <> 'Carlos' or last_name is distinct from 'Vicente')) then
    raise exception 'Carlos Vicente ha cambiado: no debía tocarse.';
  end if;
  if exists (select 1 from public.players p
               join public.team_members tm on tm.player_id = p.id
              where tm.team_id = c_infantil_b and tm.left_at is null
              group by p.dorsal having count(*) > 1 or p.dorsal is null) then
    raise exception 'Infantil B tiene dorsales repetidos o vacíos.';
  end if;
  if exists (select 1 from public.events e
               left join public.match_callup_meta m on m.event_id = e.id
              where e.club_id = c_club
                and concat_ws(' ', e.title, e.opponent_name, e.location_name, e.location_address,
                              m.meeting_location, m.meeting_address) ilike '%fonteta%') then
    raise exception 'Queda alguna mención a Fonteta en los eventos del club.';
  end if;
  if exists (select 1 from public.clubs where id = c_club and is_public is not true) then
    raise exception 'El club ha dejado de ser visible en el directorio.';
  end if;

  select string_agg(format('%s: %s', paso, filas), E'\n' order by orden) into v_txt from _resumen;
  if v_ensayo then
    raise exception E'ENSAYO CORRECTO, NADA APLICADO.\n%', v_txt;
  end if;
  raise notice E'APLICADO.\n%', v_txt;
end;
$$;

commit;

-- Verificación (solo lectura), sobre la base ya cambiada.
select 'club' as que, c.name || ' · color ' || c.primary_color || ' · visible ' || c.is_public as valor
  from public.clubs c where c.slug = 'club-beta-test'
union all
select 'Infantil B: jugadores / dorsales distintos',
       count(*) || ' / ' || count(distinct p.dorsal)
  from public.team_members tm join public.players p on p.id = tm.player_id
 where tm.team_id = 'af3e38c0-857b-481b-a4e3-0fe6250c35f1' and tm.left_at is null
union all
select 'Carlos Vicente (no se toca)', concat_ws(' ', p.first_name, p.last_name) || ' · ' || p.dorsal
  from public.players p where p.id = 'd7c2714c-7049-4ed0-baae-90eab50adf42'
union all
select 'cuenta ' || u.email, coalesce(pr.full_name, '(sin nombre)')
  from auth.users u join public.profiles pr on pr.id = u.id
 where u.email in ('jovimib+director@gmail.com', 'jovimib+coach7@gmail.com', 'jovimib+jugador8@gmail.com',
                   'jovimib+30@gmail.com', 'jovimib+test8@gmail.com', 'jovimib+familia1@gmail.com',
                   'jovimib+apple@gmail.com')
union all
select 'partido ' || to_char(e.starts_at at time zone 'Europe/Madrid', 'DD-MM HH24:MI'),
       concat_ws(' · ', e.title, e.opponent_name, case when m.published_at is not null then 'convocatoria publicada' end)
  from public.events e left join public.match_callup_meta m on m.event_id = e.id
 where e.team_id = 'af3e38c0-857b-481b-a4e3-0fe6250c35f1' and e.type::text = 'match'
union all
select 'sesiones de Infantil B del 19 al 25-10', count(*)::text
  from public.sessions s
 where s.team_id = 'af3e38c0-857b-481b-a4e3-0fe6250c35f1' and s.session_date between '2026-10-19' and '2026-10-25'
order by 1;
