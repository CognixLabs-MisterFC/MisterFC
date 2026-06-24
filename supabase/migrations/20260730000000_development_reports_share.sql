-- F13.10d — Compartir informe con la familia.
--
-- Dos ajustes de RLS de SELECT (sin tocar insert/update/delete):
--   1) development_reports: la cláusula de familia pasa de scope-equipo
--      (user_is_team_member_account) a scope-jugador (user_is_account_of_player):
--      un informe publicado (visibility='team') lo ve SOLO la familia de ESE
--      jugador, no toda la familia del equipo. Coherente con D14.
--   2) team_development_reports: la familia puede ver la valoración de equipo
--      enlazada SOLO si el informe individual de su hijo (team_report_id) está
--      publicado. Se resuelve con un helper SECURITY DEFINER (sin recursión, sin
--      abrir la RLS team-wide). No hace falta publicar la valoración de equipo
--      por separado.
--
-- Idempotente (drop policy if exists + create or replace function). No cambia el
-- esquema → no regenera tipos.

-- ── Helper: ¿el user ve esta valoración de equipo por tener un informe publicado?
create or replace function public.user_can_see_team_report_via_published(p_team_report_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.development_reports dr
    where dr.team_report_id = p_team_report_id
      and dr.visibility = 'team'
      and public.user_is_account_of_player(dr.player_id)
  );
$$;

comment on function public.user_can_see_team_report_via_published(uuid) is
  'F13.10d — TRUE si el user es cuenta de un jugador cuyo informe individual (enlazado por team_report_id) está publicado (visibility=team). Expone la valoración de equipo a esa familia sin abrir la RLS team-wide.';

grant execute on function public.user_can_see_team_report_via_published(uuid) to authenticated;

-- ── 1) development_reports: SELECT scope-jugador para familia ────────────────────
drop policy if exists development_reports_select on public.development_reports;
create policy development_reports_select on public.development_reports
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_account_of_player(player_id))
  );

-- ── 2) team_development_reports: SELECT + bloque visible vía informe publicado ───
drop policy if exists team_development_reports_select on public.team_development_reports;
create policy team_development_reports_select on public.team_development_reports
  for select to authenticated
  using (
    public.user_role_in_club(club_id) in ('admin_club', 'coordinador')
    or public.user_is_team_staff(team_id)
    or (visibility = 'team' and public.user_is_team_member_account(team_id))
    or public.user_can_see_team_report_via_published(id)
  );
