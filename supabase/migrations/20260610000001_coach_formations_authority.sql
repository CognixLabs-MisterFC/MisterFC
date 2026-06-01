-- F6.10 Bug BB — alinear la autoridad de coach_formations con la de
-- alineaciones (user_can_manage_lineup).
--
-- Problema: la policy INSERT exigía SOLO la capability can_create_lineups. Pero
-- quien gestiona alineaciones es: admin/coord del club, el PRINCIPAL del team
-- (team_staff.staff_role, no memberships.role), o staff del team con la
-- capability. Resultado: un entrenador_principal (o incluso un admin sin la
-- capability concreta) no podía crear plantillas y la UI le ocultaba el botón.
--
-- Fix: helper a nivel de CLUB user_can_create_coach_formations(club) con la
-- misma autoridad (pero sin atarse a un evento concreto: basta ser principal de
-- ALGÚN team del club), y la policy INSERT pasa a usarlo. Aditiva.

create or replace function public.user_can_create_coach_formations(p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- admin/coord del club.
    public.user_role_in_club(p_club_id) in ('admin_club', 'coordinador')
    -- staff del club con la capability (ayudantes con can_create_lineups).
    or public.user_has_capability_in_club(p_club_id, 'can_create_lineups')
    -- principal de ALGÚN team del club (autoridad vía team_staff.staff_role).
    or exists (
      select 1
      from public.team_staff ts
      join public.memberships m on m.id = ts.membership_id
      join public.teams t on t.id = ts.team_id
      join public.categories c on c.id = t.category_id
      where ts.staff_role = 'entrenador_principal'
        and ts.left_at is null
        and m.profile_id = auth.uid()
        and m.club_id = p_club_id
        and c.club_id = p_club_id
    );
$$;

comment on function public.user_can_create_coach_formations(uuid) is
  'F6.10 — TRUE si el user puede crear plantillas de formación en el club: admin/coord, principal de algún team (team_staff), o staff con capability can_create_lineups. Misma autoridad que user_can_manage_lineup pero a nivel club.';

-- Supabase ya concede EXECUTE a authenticated por default privileges en toda
-- función nueva de public; lo hacemos explícito porque la función se invoca
-- tanto desde el rpc() del gate como desde el WITH CHECK de la policy y un
-- permission denied aquí solo se vería en smoke, no en typecheck.
grant execute on function public.user_can_create_coach_formations(uuid) to authenticated;

-- La policy INSERT pasa a usar el helper de autoridad (antes: solo capability).
drop policy coach_formations_insert on public.coach_formations;
create policy coach_formations_insert on public.coach_formations
  for insert to authenticated
  with check (
    owner_profile_id = auth.uid()
    and public.user_can_create_coach_formations(club_id)
  );
