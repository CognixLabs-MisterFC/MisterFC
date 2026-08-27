-- Director-entrenador · S1b — LA BAJA CIERRA LAS ASIGNACIONES team_staff.
--
-- Sobre 20261051 (set_membership_left). Un miembro dado de baja NO debe seguir
-- figurando como staff de un equipo: sin esto, un entrenador (o director-entrenador)
-- despedido seguiría en el team_staff del equipo hasta que alguien lo quitara a mano
-- —y con Cuerpo técnico "quién trabaja cada equipo" (S1b web) aparecería ahí—.
--
-- DÓNDE: dentro de la RPC set_membership_left (SECURITY DEFINER), ÚNICO chokepoint de
-- baja (único llamador hoy: apps/web .../miembros/actions.ts). Ponerlo en el TS dejaría
-- un hueco si mañana aparece otro camino (lección RGPD). La función se recrea VERBATIM
-- desde su definición viva (pg_get_functiondef, = 20261051) con UN ÚNICO bloque añadido
-- antes de `return`. Las 6 ramas `raise exception` y la UPDATE de memberships quedan
-- idénticas.
--   · BAJA (p_left_at no nulo): cierra las team_staff ACTIVAS del target (misma fecha).
--   · REACTIVAR (p_left_at null): NO las reabre (hay que volver a asignar — decisión).
--
-- BACKFILL: cierra las asignaciones COLGANTES que ya existan (miembros de baja con
-- team_staff activo, posibles desde S1a #530), en su fecha de baja. Idempotente. A
-- fecha de esta migración: 0 filas en producción (verificado en el ensayo). Red de
-- seguridad para cuando sí las haya.
--
-- Suite pgTAP: supabase/tests/baja_cierra_team_staff.sql (los 3 casos del ensayo,
-- incluido que NO se cierra el team_staff de OTRO miembro). Ensayo BEGIN...ROLLBACK
-- contra prod verde (TEST A/B/C). Cero cambios de esquema: solo la función + el backfill.

-- ═══════════ set_membership_left — VERBATIM (20261051) + cierre team_staff en baja ═══════════
create or replace function public.set_membership_left(
  p_club_id uuid, p_target_profile_id uuid, p_left_at date, p_reason text
) returns date language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;

  -- Caller: admin_club o director del club (ACTIVO), o superadmin (A2, patrón admin_update_staff_role).
  select m.role into v_caller_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = v_uid and m.left_at is null;
  if not public.is_superadmin()
     and (v_caller_role is null or v_caller_role not in ('admin_club','director')) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  -- Guarda: nadie se da de baja a sí mismo.
  if p_target_profile_id = v_uid then
    raise exception 'cannot_leave_self' using errcode = 'P0001';
  end if;

  -- El target debe ser miembro de ESE club.
  select m.role into v_target_role
    from public.memberships m
   where m.club_id = p_club_id and m.profile_id = p_target_profile_id;
  if v_target_role is null then
    raise exception 'target_invalid' using errcode = 'P0001';
  end if;

  -- Guarda DURA: el admin_club NO se da de baja (traspasar la administración antes).
  if v_target_role = 'admin_club' then
    raise exception 'admin_immutable' using errcode = 'P0001';
  end if;

  -- A2: un DIRECTOR no puede dar de baja a un rol ALTO (otro director). Solo admin_club
  -- (o superadmin) puede sobre un director. El admin ya quedó cubierto arriba.
  if public.membership_role_is_high(v_target_role)
     and not (public.is_superadmin() or v_caller_role = 'admin_club') then
    raise exception 'forbidden_requires_admin' using errcode = 'P0001';
  end if;

  -- Baja (left_at no nulo) o reactivar (NULL → limpia la razón). Idempotente. Toca
  -- left_at/left_reason de memberships y, en BAJA, cierra team_staff activos (abajo).
  -- Nunca role ni histórico.
  update public.memberships
     set left_at = p_left_at,
         left_reason = case when p_left_at is null then null else p_reason end
   where club_id = p_club_id and profile_id = p_target_profile_id;

  -- S1b (director-entrenador): al DAR DE BAJA se CIERRAN las asignaciones team_staff
  -- ACTIVAS del miembro (fecha de baja). Sin esto seguiría figurando como staff del
  -- equipo. Al REACTIVAR (p_left_at null) NO se reabren: hay que volver a asignar.
  -- `greatest(p_left_at, ts.joined_at)`: el CHECK team_staff_check exige left_at >=
  -- joined_at; si la baja es anterior al alta de la asignación (baja retroactiva, o
  -- asignación posterior a la baja), se cierra en el joined_at para no violar el CHECK
  -- (que abortaría la baja entera). En el caso normal (baja >= alta) es la fecha de baja.
  if p_left_at is not null then
    update public.team_staff ts
       set left_at = greatest(p_left_at, ts.joined_at)
      from public.memberships m
     where m.id = ts.membership_id
       and m.club_id = p_club_id
       and m.profile_id = p_target_profile_id
       and ts.left_at is null;
  end if;

  return p_left_at;
end;
$fn$;

comment on function public.set_membership_left(uuid, uuid, date, text) is
  'Baja de miembros (Paso 4a; ampliado en S1b director-entrenador). Da de baja (left_at no nulo) o reactiva (NULL) una membership. Autorización A2: admin_club/director activos o superadmin; guardas admin_immutable/cannot_leave_self/forbidden_requires_admin. En BAJA cierra además las asignaciones team_staff ACTIVAS del miembro (misma fecha); en REACTIVAR no las reabre. La razón es nota interna, nunca visible al afectado. No toca role ni histórico.';

-- ═══════════ Backfill — cierra colgantes existentes (miembro de baja con team_staff activo) ═══════════
-- Cierra en la fecha de baja (o en el joined_at si la baja es anterior al alta, para no
-- violar team_staff_check: left_at >= joined_at). Idempotente. 0 filas en prod hoy (verificado).
update public.team_staff ts
   set left_at = greatest(m.left_at, ts.joined_at)
  from public.memberships m
 where m.id = ts.membership_id
   and m.left_at is not null
   and ts.left_at is null;
