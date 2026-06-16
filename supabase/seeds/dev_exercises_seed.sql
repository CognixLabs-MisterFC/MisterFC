-- ─────────────────────────────────────────────────────────────────────────────
-- F11.3 — SEED DE DESARROLLO (DESECHABLE) para la biblioteca de ejercicios.
--
-- ⚠️ NO es una migración. NO lo apliques al remoto sin querer datos de prueba.
-- Son ejercicios de "usar y tirar" para poder ver el listado/filtros en el
-- preview hasta que el club cree los reales (11.6).
--
-- Idempotente: usa ids fijos (on conflict do nothing) y nombres con prefijo
-- "[SEED] " para poder borrarlos de un golpe (ver runbook al final).
--
-- Cómo elige destino: el PRIMER club existente y un admin_club de ese club como
-- autor (para los publicados). Si no hay club/admin, no hace nada (raise notice).
--
-- Por qué deshabilita el trigger: el trigger sella la auditoría con auth.uid(),
-- que es NULL fuera de una sesión de usuario, y exige Admin para crear en
-- 'published'. Como aquí sembramos varios estados a mano (incl. published y
-- rejected), lo desactivamos durante el INSERT y lo reactivamos al final. Se
-- ejecuta como owner de la tabla (SQL editor / psql con la service role).
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_club  uuid;
  v_admin uuid;
  v_coach uuid;
begin
  select c.id into v_club from public.clubs c order by c.created_at limit 1;
  if v_club is null then
    raise notice 'SEED ejercicios: no hay clubs; nada que sembrar.';
    return;
  end if;

  select m.profile_id into v_admin
    from public.memberships m
   where m.club_id = v_club and m.role = 'admin_club'
   limit 1;
  if v_admin is null then
    raise notice 'SEED ejercicios: el club % no tiene admin_club; nada que sembrar.', v_club;
    return;
  end if;

  -- Un coach (no-admin) para los estados borrador/propuesto/rechazado; si no hay,
  -- cae al admin (sigue siendo dato de prueba válido).
  select m.profile_id into v_coach
    from public.memberships m
   where m.club_id = v_club
     and m.role in ('entrenador_principal', 'entrenador_ayudante', 'coordinador')
   limit 1;
  v_coach := coalesce(v_coach, v_admin);

  alter table public.exercises disable trigger trg_exercises_validate;

  insert into public.exercises
    (id, owner_profile_id, club_id, name, description, objective,
     categories, tactical_objectives, technical_objectives,
     intensity, space_type, base_duration, status, approved_by, approved_at, rejection_reason)
  values
    -- PUBLICADOS (visibles para todo el staff) ---------------------------------
    ('d0000000-0000-4000-8000-000000000001', v_admin, v_club,
     '[SEED] Rondo 4v2', 'Rondo clásico para mantener posesión bajo presión.',
     'Mejorar la velocidad de circulación y los apoyos.',
     array['benjamin','alevin']::text[], array['posesion','lineas_de_pase']::text[], array['control','pase']::text[],
     'media', 'reducido', 15, 'published', v_admin, now(), null),

    ('d0000000-0000-4000-8000-000000000002', v_admin, v_club,
     '[SEED] Salida de balón 3+2 vs 2', 'Construcción desde portero con dos pivotes.',
     'Superar la primera línea de presión con criterio.',
     array['infantil','cadete']::text[], array['salida_de_balon','progresion']::text[], array['pase','conduccion']::text[],
     'alta', 'medio_campo', 20, 'published', v_admin, now(), null),

    ('d0000000-0000-4000-8000-000000000003', v_admin, v_club,
     '[SEED] Finalización tras centro', 'Series de centros desde banda con remate.',
     'Mejorar el timing de llegada y el remate.',
     array['cadete','juvenil','senior']::text[], array['finalizacion','centros','juego_por_bandas']::text[], array['tiro','cabeceo']::text[],
     'alta', 'medio_campo', 25, 'published', v_admin, now(), null),

    ('d0000000-0000-4000-8000-000000000004', v_admin, v_club,
     '[SEED] Conducción en zigzag', 'Circuito de conos para técnica individual.',
     'Dominio del balón en conducción y regate.',
     array['querubin','prebenjamin','benjamin']::text[], array[]::text[], array['conduccion','regate']::text[],
     'baja', 'cuarto_campo', 10, 'published', v_admin, now(), null),

    -- PROPUESTO (pendiente de aprobación del Admin: lo ve el autor y el Admin) ---
    ('d0000000-0000-4000-8000-000000000005', v_coach, v_club,
     '[SEED] Transición ofensiva 4v4+2', 'Tras robo, atacar la portería contraria con apoyos.',
     'Ataque rápido aprovechando la desorganización rival.',
     array['juvenil','senior']::text[], array['transicion_ofensiva','amplitud_y_profundidad']::text[], array['pase','conduccion']::text[],
     'alta', 'campo_completo', 20, 'proposed', null, null, null),

    -- BORRADOR (solo lo ve su autor) -------------------------------------------
    ('d0000000-0000-4000-8000-000000000006', v_coach, v_club,
     '[SEED] Presión tras pérdida (borrador)', 'Reacción inmediata tras perder el balón.',
     'Recuperar en los primeros segundos tras la pérdida.',
     array['cadete','juvenil']::text[], array['presion_tras_perdida','basculacion']::text[], array[]::text[],
     'media', 'medio_campo', 18, 'draft', null, null, null),

    -- RECHAZADO (lo ve su autor y el Admin; requiere motivo) -------------------
    ('d0000000-0000-4000-8000-000000000007', v_coach, v_club,
     '[SEED] Balón parado: córner ofensivo', 'Jugada ensayada de córner al primer palo.',
     'Generar ocasión a balón parado.',
     array['senior']::text[], array['balon_parado']::text[], array['cabeceo']::text[],
     'media', 'medio_campo', 12, 'rejected', null, null, 'Faltan los movimientos de los bloqueadores; revisar y reenviar.')
  on conflict (id) do nothing;

  alter table public.exercises enable trigger trg_exercises_validate;

  raise notice 'SEED ejercicios: sembrados en club % (admin %, coach %).', v_club, v_admin, v_coach;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- LIMPIEZA (cuando ya no quieras los datos de prueba):
--   delete from public.exercises where name like '[SEED]%';
-- ─────────────────────────────────────────────────────────────────────────────
