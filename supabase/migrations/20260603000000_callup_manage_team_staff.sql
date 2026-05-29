-- F4 Lote B — Fix: user_can_manage_callup debe basarse en team_staff.staff_role
--
-- Bug detectado en smoke: un usuario con `memberships.role = 'entrenador_ayudante'`
-- pero `team_staff.staff_role = 'entrenador_principal'` en un team concreto
-- (caso totalmente válido per F2.6) no podía marcar Convocado/Descartado en la
-- convocatoria de un partido de SU team. El helper consultaba `memberships.role`
-- vía `user_role_in_club`, que devuelve el rol del club, no el del team.
--
-- Spec F2.6 establece que `team_staff.staff_role` es la autoridad por equipo,
-- independiente del rol del club. El helper se actualiza para reflejarlo.
--
-- Cambios:
--   1) Rama del principal: consulta team_staff directamente (staff_role,
--      left_at IS NULL, membership del user en el club del evento).
--   2) Rama del ayudante con can_manage_callups: sin cambios (sigue usando
--      user_is_staff_of_team + user_has_capability_in_club).
--   3) Rama admin/coord: sin cambios.

create or replace function public.user_can_manage_callup(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- admin/coord del club: siempre.
    public.user_role_in_club(e.club_id) in ('admin_club', 'coordinador')
    -- principal del TEAM (autoridad: team_staff.staff_role, no memberships.role).
    or (
      e.team_id is not null
      and exists (
        select 1
        from public.team_staff ts
        join public.memberships m on m.id = ts.membership_id
        where ts.team_id = e.team_id
          and ts.staff_role = 'entrenador_principal'
          and ts.left_at is null
          and m.profile_id = auth.uid()
          and m.club_id = e.club_id
      )
    )
    -- staff activo del team con capability can_manage_callups (ayudantes).
    or (
      e.team_id is not null
      and public.user_has_capability_in_club(e.club_id, 'can_manage_callups')
      and public.user_is_staff_of_team(e.team_id)
    )
    from public.events e
   where e.id = p_event_id;
$$;

comment on function public.user_can_manage_callup(uuid) is
  'F4.3 — TRUE si el user puede gestionar la convocatoria. admin/coord del club, principal del team (team_staff.staff_role, NO memberships.role), o staff del team con capability can_manage_callups.';
