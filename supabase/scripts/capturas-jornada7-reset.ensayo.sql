-- ════════════════════════════════════════════════════════════════════════════
-- Club de capturas: la jornada 7 de Infantil B (24-10, CD Sequiol Nou) vuelve a como
-- la dejó `capturas-club-test.sql` (paso 7): el partido y su convocatoria PUBLICADA,
-- y nada más. Se empezó su directo por error durante las capturas.
--
-- ENSAYO: hace todos los cambios y los DESHACE. Al final aborta a propósito con
-- «ENSAYO CORRECTO, NADA APLICADO» y el recuento de cada paso.
--
-- El definitivo es `capturas-jornada7-reset.sql`: el MISMO bloque, con v_ensayo = false,
-- terminado en COMMIT. Un test (packages/core/src/marketing-site/__tests__/
-- capturas-club-test.test.ts) comprueba que solo cambian esas líneas.
--
-- Se borra todo lo que cuelga del partido salvo el evento y `match_callup_meta`:
-- directo (match_state), periodos, acciones, titulares, alineación (y en cascada sus
-- posiciones, notas tácticas y cambios previstos), decisiones de convocatoria,
-- respuestas de las familias, ausencias, estadísticas, valoraciones y destacados del
-- rival. Ninguna de esas tablas tiene triggers de borrado.
-- ════════════════════════════════════════════════════════════════════════════
begin;

do $$
declare
  v_ensayo constant boolean := true;

  c_club constant uuid := 'f91b42e5-cfce-4625-9ca4-9a0764ca9f72';
  c_infantil_b constant uuid := 'af3e38c0-857b-481b-a4e3-0fe6250c35f1';

  v_ev uuid;
  v_n int;
  v_estado text;
  v_txt text;
begin
  create temp table _resumen (orden serial, paso text, filas int) on commit drop;

  -- ── 0 · El partido: exactamente uno, y es el de la jornada 7 ────────────────
  select count(*) into v_n from public.events e
   where e.club_id = c_club and e.team_id = c_infantil_b and e.type::text = 'match'
     and e.starts_at = '2026-10-24 08:00:00+00';
  if v_n <> 1 then raise exception 'Paso 0: % partidos de Infantil B el 24-10 a las 10:00 (esperado 1)', v_n; end if;
  select e.id into v_ev from public.events e
   where e.club_id = c_club and e.team_id = c_infantil_b and e.type::text = 'match'
     and e.starts_at = '2026-10-24 08:00:00+00';
  if not exists (select 1 from public.events e where e.id = v_ev
                   and e.title = 'Liga · Jornada 7' and e.opponent_name = 'CD Sequiol Nou'
                   and e.cancelled_at is null) then
    raise exception 'Paso 0: el partido del 24-10 no es «Liga · Jornada 7» contra CD Sequiol Nou, o está cancelado.';
  end if;
  if not exists (select 1 from public.match_callup_meta m where m.event_id = v_ev and m.published_at is not null) then
    raise exception 'Paso 0: la jornada 7 no tiene la convocatoria publicada.';
  end if;
  select coalesce(ms.status, '(sin directo)') into v_estado
    from (select 1) x left join public.match_state ms on ms.event_id = v_ev;
  insert into _resumen (paso, filas) values ('0 · jornada 7 encontrada; estado del directo: ' || v_estado, 1);

  -- ── 1 · Directo: acciones, periodos, titulares y cabecera ───────────────────
  delete from public.match_events where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('1 · acciones del directo (goles, tarjetas…)', v_n);
  delete from public.match_periods where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('1 · periodos', v_n);
  delete from public.match_starters where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('1 · titulares del directo', v_n);
  delete from public.match_state where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('1 · directo y marcador (match_state)', v_n);

  -- ── 2 · Lo que sale del partido jugado ──────────────────────────────────────
  delete from public.match_player_stats where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('2 · estadísticas de jugadores', v_n);
  delete from public.match_rival_highlights where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('2 · destacados del rival', v_n);
  delete from public.evaluations where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('2 · valoraciones de jugadores', v_n);
  delete from public.team_evaluations where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('2 · valoración del equipo', v_n);

  -- ── 3 · Alineación y convocatoria del entrenador ────────────────────────────
  delete from public.lineups where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('3 · alineaciones (con sus posiciones en cascada)', v_n);
  delete from public.match_absences where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('3 · ausencias', v_n);
  delete from public.callup_decisions where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('3 · decisiones de convocatoria', v_n);

  -- ── 4 · Sin responder ───────────────────────────────────────────────────────
  delete from public.callup_responses where event_id = v_ev;
  get diagnostics v_n = row_count;
  insert into _resumen (paso, filas) values ('4 · respuestas de las familias', v_n);

  -- ── Comprobaciones finales ──────────────────────────────────────────────────
  if exists (select 1 from public.match_state where event_id = v_ev)
     or exists (select 1 from public.match_periods where event_id = v_ev)
     or exists (select 1 from public.match_events where event_id = v_ev)
     or exists (select 1 from public.match_starters where event_id = v_ev)
     or exists (select 1 from public.lineups where event_id = v_ev)
     or exists (select 1 from public.callup_decisions where event_id = v_ev)
     or exists (select 1 from public.callup_responses where event_id = v_ev) then
    raise exception 'Queda algo del directo, la alineación o las respuestas en la jornada 7.';
  end if;
  if not exists (select 1 from public.events e join public.match_callup_meta m on m.event_id = e.id
                  where e.id = v_ev and m.published_at is not null) then
    raise exception 'La jornada 7 ha perdido el partido o la convocatoria publicada.';
  end if;

  select string_agg(format('%s: %s', paso, filas), E'\n' order by orden) into v_txt from _resumen;
  if v_ensayo then
    raise exception E'ENSAYO CORRECTO, NADA APLICADO.\n%', v_txt;
  end if;
  raise notice E'APLICADO.\n%', v_txt;
end;
$$;

rollback;
