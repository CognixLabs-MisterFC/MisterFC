-- O2 · Cierre completo del rollover (cuerpo técnico) + scope de staff robusto.
--
-- CONTEXTO (QA en dispositivo): un entrenador quedó con la asignación `team_staff`
-- VIVA (left_at null) en el equipo de la temporada PASADA (mismo nombre, otro
-- team_id) porque `finalize_active_season` cerraba `team_members` (jugadores) pero
-- NUNCA `team_staff`. Además, la RPC `user_team_ids_in_club` no filtraba por
-- temporada activa, así que ese dato caduco vaciaba la agenda del staff.
--
-- Esta migración hace DOS cosas, ambas por CREATE OR REPLACE de la definición VIVA:
--   1) finalize_active_season: además de `team_members`, cierra `team_staff` de los
--      equipos de la temporada que se finaliza (mismo criterio t.season=v_active y
--      mismo cutoff). El guard `cutoff_too_early` pasa a considerar también el
--      `joined_at` del staff (si no, cerrar staff con joined_at > cutoff violaría el
--      CHECK left_at>=joined_at con un error crudo en vez del mensaje limpio).
--   2) user_team_ids_in_club: filtra ambas ramas (jugador y staff) por la temporada
--      ACTIVA del club, para que un vínculo vivo de temporada pasada se ignore.
--
-- NORMA DE MIGRACIONES: para recrear una función se parte de su definición VIVA y se
-- deja un diff antes/después como prueba. En esta sesión NO se puede ejecutar nada
-- contra la BD (la migración la aplica Jose), así que NO se ha corrido
-- pg_get_functiondef: la "definición viva" se toma VERBATIM de la última migración
-- que (re)define cada función —finalize_active_season: 20260923000000_f14b_6…;
-- user_team_ids_in_club: 20261004000000_fix_directo_club_wide— y el único cambio es
-- el descrito arriba. El diff textual va en el PR.
--
-- NO retroactivo: no toca temporadas ya finalizadas ni datos sucios existentes.
-- Sobre el gate: NO existe una "segunda" función de superadmin; f14b_6 es un CREATE
-- OR REPLACE de la MISMA finalize_active_season (admin_club OR is_superadmin), así
-- que basta recrearla una vez: esta versión conserva ese gate intacto.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. finalize_active_season — cierra team_members Y team_staff de la activa.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_active_season(p_club_id uuid, p_cutoff date)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid       uuid := auth.uid();
  v_active    text;
  v_upcoming  text;
  v_max_join  date;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  -- Solo admin_club del club (coincide con C6/C7).
  -- F14B-6: admin_club del club O superadmin de plataforma.
  if not (public.is_superadmin() or exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  )) then
    raise exception 'forbidden' using errcode = 'P0001';
  end if;

  if p_cutoff is null then
    raise exception 'cutoff_required' using errcode = 'P0001';
  end if;

  select label into v_active from public.seasons
   where club_id = p_club_id and status = 'active' limit 1;
  if v_active is null then
    raise exception 'no_active_season' using errcode = 'P0001';
  end if;

  -- Guard: sin upcoming no hay temporada nueva que activar.
  select label into v_upcoming from public.seasons
   where club_id = p_club_id and status = 'upcoming' limit 1;
  if v_upcoming is null then
    raise exception 'no_upcoming' using errcode = 'P0001';
  end if;

  -- La fecha de corte no puede ser anterior a ninguna alta abierta de la activa
  -- (rompería el CHECK left_at >= joined_at). Se consideran jugadores (team_members)
  -- Y cuerpo técnico (team_staff), porque ahora se cierran ambos. Mensaje limpio.
  select max(j) into v_max_join
    from (
      select tm.joined_at as j
        from public.team_members tm
        join public.teams t on t.id = tm.team_id
       where t.club_id = p_club_id and t.season = v_active and tm.left_at is null
      union all
      select ts.joined_at as j
        from public.team_staff ts
        join public.teams t on t.id = ts.team_id
       where t.club_id = p_club_id and t.season = v_active and ts.left_at is null
    ) q;
  if v_max_join is not null and p_cutoff < v_max_join then
    raise exception 'cutoff_too_early' using errcode = 'P0001';
  end if;

  -- 1. Cierra las membresías abiertas de los equipos de la ACTIVA. Las de la
  --    upcoming (equipos con season = v_upcoming) no entran en el filtro.
  update public.team_members tm
     set left_at = p_cutoff
    from public.teams t
   where tm.team_id = t.id
     and t.club_id = p_club_id
     and t.season = v_active
     and tm.left_at is null;

  -- 1b. Cierra TAMBIÉN las asignaciones de cuerpo técnico abiertas de los equipos
  --     de la ACTIVA (mismo criterio y cutoff que team_members). Antes el staff
  --     quedaba vivo en el equipo saliente y contaminaba los scopes de staff.
  update public.team_staff ts
     set left_at = p_cutoff
    from public.teams t
   where ts.team_id = t.id
     and t.club_id = p_club_id
     and t.season = v_active
     and ts.left_at is null;

  -- 2 + 3. Demoter la activa ANTES de promover la upcoming (índice parcial).
  update public.seasons set status = 'finalized', updated_at = now()
   where club_id = p_club_id and label = v_active and status = 'active';

  update public.seasons set status = 'active', updated_at = now()
   where club_id = p_club_id and label = v_upcoming and status = 'upcoming';

  return v_upcoming;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. user_team_ids_in_club — equipos del usuario en un club, SOLO temporada activa.
--    (definición viva: 20261004000000_fix_directo_club_wide; único cambio: filtro
--    `t.season = <label de la activa>` en ambas ramas).
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.user_team_ids_in_club(p_club_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select distinct tm.team_id
  from public.team_members tm
  join public.player_accounts pa on pa.player_id = tm.player_id
  join public.teams t on t.id = tm.team_id
  where t.club_id = p_club_id
    and tm.left_at is null
    and pa.profile_id = auth.uid()
    and t.season = (select s.label from public.seasons s
                     where s.club_id = p_club_id and s.status = 'active' limit 1)
  union
  select distinct ts.team_id
  from public.team_staff ts
  join public.memberships m on m.id = ts.membership_id
  join public.teams t on t.id = ts.team_id
  where t.club_id = p_club_id
    and ts.left_at is null
    and m.profile_id = auth.uid()
    and t.season = (select s.label from public.seasons s
                     where s.club_id = p_club_id and s.status = 'active' limit 1);
$function$;

revoke all on function public.user_team_ids_in_club(uuid) from public;
grant execute on function public.user_team_ids_in_club(uuid) to authenticated;
