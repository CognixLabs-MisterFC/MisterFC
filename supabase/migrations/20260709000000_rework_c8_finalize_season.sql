-- Rework C · C8 — finalizar temporada (cierre del rollover).
--
-- Spec: docs/specs/C.0-categorias-estandar-y-rollover.md (§5 C8).
--
-- Punto de COMMIT del rollover. Hasta aquí la activa (25-26) sigue operativa y los
-- jugadores están en su equipo 25-26 (abierto) y colocados en su 26-27 (abierto,
-- C7). Finalizar es atómico (todo o nada):
--   1. Cierra las membresías ABIERTAS de los equipos de la temporada ACTIVA con
--      left_at = fecha de corte (default = límite de temporada; el admin la ajusta).
--      NO toca las membresías de la upcoming (sus equipos son de otra season).
--   2. Marca la season activa como 'finalized'.
--   3. Marca la upcoming como 'active'  (en este orden: el índice parcial
--      seasons_one_active_per_club exige demoter la vieja antes de promover).
-- Guard: exige una upcoming abierta (no se finaliza sin temporada que activar).
-- Solo admin_club. Devuelve el label de la nueva temporada activa.
--
-- Idempotencia: tras finalizar no queda upcoming → una 2ª llamada cae en el guard
-- 'no_upcoming'. No hay doble cierre posible.

create or replace function public.finalize_active_season(
  p_club_id uuid,
  p_cutoff  date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
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
  if not exists (
    select 1 from public.memberships m
     where m.club_id = p_club_id and m.profile_id = v_uid and m.role = 'admin_club'
  ) then
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
  -- (rompería team_members_left_at_check: left_at >= joined_at). Mensaje limpio.
  select max(tm.joined_at) into v_max_join
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.club_id = p_club_id and t.season = v_active and tm.left_at is null;
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

  -- 2 + 3. Demoter la activa ANTES de promover la upcoming (índice parcial).
  update public.seasons set status = 'finalized', updated_at = now()
   where club_id = p_club_id and label = v_active and status = 'active';

  update public.seasons set status = 'active', updated_at = now()
   where club_id = p_club_id and label = v_upcoming and status = 'upcoming';

  return v_upcoming;
end;
$$;

comment on function public.finalize_active_season(uuid, date) is
  'Rework C (C8) — finaliza el rollover atómicamente: cierra las membresías abiertas de la temporada activa a la fecha de corte (no toca la upcoming), marca la activa finalized y la upcoming active. Solo admin_club, exige una upcoming. Devuelve el label de la nueva activa.';
