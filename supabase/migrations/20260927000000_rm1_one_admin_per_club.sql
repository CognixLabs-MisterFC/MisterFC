-- RM-1 — Imponer "un solo admin_club por club" a nivel de DATO.
--
-- MODELO (regla dura de Jose, F1B): cada club tiene UN SOLO admin_club, y ese
-- admin ES el owner. Hoy la BD NO lo impide (solo convención de UI: invite-form
-- no ofrece admin_club, platform_invite_club_admin solo invita a clubs sin owner).
-- Esta migración lo enforce con un índice UNIQUE PARCIAL.
--
-- ALCANCE ESTRICTO: SOLO el índice. NO toca user_is_club_owner (RM-2), ni las
-- policies/RPC de gestión de roles, ni el trigger de owner (F14B-5b). El owner=admin
-- y su inmutabilidad ya vienen de F1B-0/F1B-2/F14B-5b; aquí solo falta impedir el 2º
-- admin_club.
--
-- Datos (verificado en el remoto): 0 clubs con >1 admin_club, 0 clubs con owner
-- NULL. El índice se aplica sin limpieza. Aun así, se comprueba ANTES de crearlo:
-- si algún entorno tuviera datos sucios, la migración ABORTA con mensaje claro en
-- vez de crear el índice a medias (NO se limpian datos automáticamente).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. GUARDA: abortar si YA existe algún club con más de un admin_club.
--    UNIQUE index fallaría igual, pero con un error genérico; este RAISE da un
--    mensaje accionable (qué clubs, cuántos) para limpiar a mano antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_dups int;
  v_sample text;
begin
  select count(*), string_agg(club_id::text || ' (' || n::text || ')', ', ')
    into v_dups, v_sample
  from (
    select club_id, count(*) as n
    from public.memberships
    where role = 'admin_club'
    group by club_id
    having count(*) > 1
  ) d;

  if v_dups > 0 then
    raise exception
      'RM-1 ABORTADA: % club(es) con más de un admin_club. Limpia a mano (deja el de menor created_at) antes de aplicar el unique. Clubs: %',
      v_dups, v_sample
      using errcode = 'P0001';
  end if;

  raise notice 'RM-1: 0 clubs con >1 admin_club → el índice se puede crear.';
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INFORMATIVO (no bloquea): clubs con admin_club pero owner NULL (gap histórico
--    pre-F14B-5b). En el remoto no hay ninguno; solo se avisa por NOTICE.
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_orphans int;
begin
  select count(*) into v_orphans
  from public.clubs c
  where c.owner_profile_id is null
    and exists (
      select 1 from public.memberships m
      where m.club_id = c.id and m.role = 'admin_club'
    );

  if v_orphans > 0 then
    raise notice 'RM-1 (aviso): % club(es) con admin_club pero owner NULL (gap histórico). No bloquea el unique; el trigger F14B-5b asigna owner al próximo admin_club.', v_orphans;
  else
    raise notice 'RM-1: 0 clubs con admin_club y owner NULL.';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Índice UNIQUE PARCIAL: máximo un admin_club por club. Cubre INSERT de un 2º
--    admin_club y UPDATE de una membership existente a role='admin_club'. Los
--    demás roles (director, coordinador, entrenador_*, jugador) NO se ven afectados
--    (puede haber varios de cada uno): el predicado WHERE limita el unique a
--    role='admin_club'.
-- ─────────────────────────────────────────────────────────────────────────────
create unique index memberships_one_admin_per_club
  on public.memberships (club_id)
  where role = 'admin_club';

comment on index public.memberships_one_admin_per_club is
  'RM-1 — un solo admin_club por club (regla dura de Jose: admin único = owner). '
  'Índice unique parcial: impide un 2º admin_club por INSERT o por UPDATE-a-admin_club. '
  'No afecta a los demás roles (director/coordinador/entrenador_*/jugador pueden ser varios).';
