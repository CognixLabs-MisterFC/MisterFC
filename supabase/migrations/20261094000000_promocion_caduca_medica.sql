-- ─────────────────────────────────────────────────────────────────────────────
-- La médica que abre una PROMOCIÓN caduca con el evento.
--
-- QUÉ CAMBIA, en una línea: el cuerpo técnico del equipo al que se sube un
-- jugador ve su médica desde que se crea la promoción hasta el FINAL DEL DÍA del
-- evento, y no más.
--
-- DE DÓNDE VIENE. `user_can_access_player_medical` tiene cuatro ramas, y la
-- tercera —la de `player_promotions`— era la única SIN límite temporal:
--
--     or exists (
--       select 1 from public.player_promotions pp
--       where pp.player_id = p_player_id
--         and public.user_is_staff_of_team(pp.team_id)
--     )
--
-- Las otras tres sí lo tienen. La rama del equipo base exige `tm.left_at is null`;
-- `user_is_staff_of_team` exige `ts.left_at is null` y `m.left_at is null`; la de
-- dirección pasa por `user_role_in_club`, que exige `memberships.left_at is null`.
-- Un miembro de baja queda fuera en todas. En esta, no: `player_promotions` no
-- tiene `left_at` ni fecha de fin, y la fila vive hasta que se borre el evento
-- (FK `on delete cascade`). Medido en producción el 2026-09-21: 5 promociones
-- vivas de eventos del 1 al 7 de JULIO. Dos meses y medio después, el staff de
-- aquel amistoso seguía viendo la médica de un chaval que subió a un partido.
--
-- LA REGLA. El corte es el día natural del evento en hora del club, no 24 horas
-- desde la promoción ni el instante de `starts_at`: un partido que empieza a las
-- 20:00 no puede dejar de ser consultable a las 20:01, y quien lo atiende puede
-- necesitar la alergia hasta que acaba la tarde. Redondear al final del día es la
-- versión conservadora y la que se puede explicar en una cláusula.
--
-- `Europe/Madrid` va escrito, como en `mark_holiday` (mig 20261020000000), y por
-- la misma razón: `starts_at` es `timestamptz` y el servidor corre en UTC, así que
-- sin la conversión el día se cortaría a las 02:00 de la madrugada siguiente en
-- verano. No hay zona por club en el modelo; cuando la haya, este literal y el de
-- `mark_holiday` se cambian juntos.
--
-- CÓMO SE HA HECHO: `create or replace` desde la definición VIVA del catálogo
-- (`pg_get_functiondef`), no desde el fichero de la migración que la creó. Así no
-- se pierde por el camino nada que se le hubiera añadido después, y el diff es
-- exactamente el de abajo. Se conservan firma, `stable`, `security definer`,
-- `set search_path = public`, dueño y ACL (`create or replace` no los toca).
--
-- RECUENTO DE RAMAS: 4 antes → 4 después. No se añade ni se quita ninguna vía;
-- la tercera gana una condición.
--
--   1. dirección del club (admin_club / director)          — sin tocar
--   2. staff del equipo ACTIVO del jugador                  — sin tocar
--   3. staff del equipo que lo PROMOCIONA                   — ← acotada aquí
--   4. tutor vinculado, o el jugador mayor de edad          — sin tocar
--
-- EL JOIN NO PIERDE FILAS: `player_promotions.event_id` es `not null` y tiene FK
-- a `events` con `on delete cascade`, así que todo `pp` tiene su `e`. El `join`
-- no es un filtro encubierto: el único filtro nuevo es la fecha.
--
-- QUÉ NO CAMBIA Y ES DELIBERADO:
--   · el consentimiento sigue mandando: esto es una de las dos mitades de la
--     puerta de `get_player_medical`, que además exige
--     `user_has_medical_consent_read`. Acotar la promoción no afloja nada.
--   · un evento CANCELADO (`events.cancelled_at`) sigue dando acceso hasta el
--     final de su día. Cortarlo antes es otra decisión, no esta: aquí solo se pone
--     el límite que faltaba.
--   · el resto de cosas que abre una promoción (elegibilidad, convocatoria,
--     asistencia) no pasan por esta función y no se tocan.
--
-- Alcance: SOLO `user_can_access_player_medical`. Su único llamador es
-- `get_player_medical`; ninguna policy la menciona (comprobado en el catálogo).
-- Test: supabase/tests/rls_medical_consents.sql (L10, L11, L12 y las anclas)
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.user_can_access_player_medical(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- dirección / admin del club del jugador
    public.user_is_admin_or_director(
      (select club_id from public.players where id = p_player_id)
    )
    -- staff de un equipo ACTIVO del jugador (equipo base) — scope EQUIPO
    or exists (
      select 1 from public.team_members tm
      where tm.player_id = p_player_id
        and tm.left_at is null
        and public.user_is_staff_of_team(tm.team_id)
    )
    -- staff de un equipo que lo tiene PROMOCIONADO, SOLO hasta el final del día
    -- del evento de la subida (día natural en hora del club)
    or exists (
      select 1
      from public.player_promotions pp
      join public.events e on e.id = pp.event_id
      where pp.player_id = p_player_id
        and (e.starts_at at time zone 'Europe/Madrid')::date
            >= (now() at time zone 'Europe/Madrid')::date
        and public.user_is_staff_of_team(pp.team_id)
    )
    -- tutor vinculado, o el propio jugador SI ya es mayor de edad (MN-1)
    or public.user_manages_player_sensitive(p_player_id);
$$;
