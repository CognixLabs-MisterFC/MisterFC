-- Rework A · A1 EXPAND (parte 2) — trigger de denormalización de teams.
--
-- Spec: docs/specs/A.0-categorias-equipos.md §5 / §9. ADR-0017.
-- La 1ª migración (20260627000000) añadió teams.season + teams.club_id NOT NULL +
-- unique(club_id, name, season). Este trigger DERIVA esos campos de la categoría
-- (mismo patrón que match_player_stats_validate / evaluations_validate, que
-- derivan club_id/team_id del evento). Al ser BEFORE, rellena ANTES de los checks
-- de NOT NULL/CHECK/UNIQUE → los inserts existentes (alta de equipo y los 24
-- fixtures pgTAP) siguen funcionando sin pasar season/club_id, y season/club_id
-- se mantienen NOT NULL (fiel a D2/D3).
--
--   · club_id : SIEMPRE = categories.club_id (denormalización pura; sobrescribe lo
--               que venga → consistencia garantizada; categories.club_id sobrevive
--               al rework, así que esta derivación se queda para siempre).
--   · season  : solo si viene NULL → categories.season (fallback TRANSICIONAL: es
--               el comportamiento de hoy, el equipo hereda la temporada de su
--               categoría). ⚠️ En A6 CONTRACT, al borrar categories.season, hay
--               que QUITAR este fallback de season (el flujo /equipos aportará
--               siempre la season explícita). La rama de club_id se queda.

create or replace function public.teams_derive_from_category()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cat public.categories%rowtype;
begin
  select * into v_cat from public.categories where id = new.category_id;
  if not found then
    raise exception 'category_not_found' using errcode = 'foreign_key_violation';
  end if;

  new.club_id := v_cat.club_id;            -- siempre (denormalización autoritativa)

  if new.season is null then
    new.season := v_cat.season;            -- fallback transicional (QUITAR en A6)
  end if;

  return new;
end;
$$;

comment on function public.teams_derive_from_category() is
  'Rework A (A1) — deriva teams.club_id (siempre) y teams.season (fallback si NULL) desde la categoría, antes de los checks. El fallback de season lee categories.season y debe RETIRARSE en A6 CONTRACT (cuando se borra categories.season); la derivación de club_id se queda. Patrón calcado de match_player_stats_validate.';

create trigger trg_teams_derive_from_category
  before insert or update on public.teams
  for each row execute function public.teams_derive_from_category();
